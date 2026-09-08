const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'sigma.db');
const SIGNING_SECRET = process.env.SIG_KEY || 'sigma-local-signature';

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH, { fileMustExist: false });
db.pragma('journal_mode = WAL;');
db.pragma('foreign_keys = ON;');
db.pragma('synchronous = NORMAL;');
db.pragma('busy_timeout = 5000;');

const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schemaSql);

const additiveMigrations = [
  'ALTER TABLE users ADD COLUMN bio TEXT',
  'ALTER TABLE users ADD COLUMN banner_url TEXT',
  'ALTER TABLE spaces ADD COLUMN icon_url TEXT',
  'ALTER TABLE spaces ADD COLUMN banner_url TEXT',
  "ALTER TABLE roles ADD COLUMN color TEXT NOT NULL DEFAULT '#6366F1'",
  'ALTER TABLE roles ADD COLUMN can_manage_space INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE roles ADD COLUMN can_manage_roles INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE roles ADD COLUMN can_manage_channels INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE roles ADD COLUMN can_kick_members INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE roles ADD COLUMN can_ban_members INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE roles ADD COLUMN can_mute_members INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE roles ADD COLUMN can_dispatch_emergency_ping INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE roles ADD COLUMN mute_duration_seconds INTEGER',
];
for (const migration of additiveMigrations) {
  try {
    db.exec(migration);
  } catch (error) {
    if (!String(error.message).includes('duplicate column name')) throw error;
  }
}

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));

app.post('/api/auth/signup', (req, res) => {
  const { username, display_name, email, password, bio, avatar_url, banner_url } = req.body || {};
  if (!username || !display_name || !email || !password) return res.status(400).json({ error: 'username, display_name, email, and password are required' });
  const id = createUuid();
  const passwordHash = crypto.scryptSync(password, SIGNING_SECRET, 64).toString('hex');
  try {
    db.prepare(`INSERT INTO users (id, username, email, password_hash, display_name, bio, avatar_url, banner_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(id, username, email, passwordHash, display_name, bio || null, avatar_url || null, banner_url || null);
    return res.status(201).json({ user: db.prepare('SELECT id, username, email, display_name, bio, avatar_url, banner_url, xp, total_xp, is_cs_verified FROM users WHERE id = ?').get(id) });
  } catch (error) {
    return res.status(409).json({ error: 'Username or email already exists' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { identifier, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(identifier, identifier);
  const passwordHash = user ? crypto.scryptSync(password || '', SIGNING_SECRET, 64).toString('hex') : '';
  if (!user || !crypto.timingSafeEqual(Buffer.from(user.password_hash, 'hex'), Buffer.from(passwordHash, 'hex'))) return res.status(401).json({ error: 'Invalid credentials' });
  return res.json({ user: { id: user.id, username: user.username, email: user.email, display_name: user.display_name, bio: user.bio, avatar_url: user.avatar_url, banner_url: user.banner_url, xp: user.xp, is_cs_verified: Boolean(user.is_cs_verified) } });
});

app.get('/api/users/search', (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) return res.json({ users: [] });
  const users = db.prepare(`SELECT id, username, display_name, bio, avatar_url, banner_url, xp, is_cs_verified
    FROM users WHERE username LIKE ? OR display_name LIKE ? ORDER BY display_name LIMIT 25`).all(`%${query}%`, `%${query}%`);
  return res.json({ users });
});

app.get('/api/spaces/:spaceId/screening', (req, res) => {
  const questions = db.prepare('SELECT * FROM space_screening_questions WHERE space_id = ? ORDER BY step_order').all(req.params.spaceId);
  const options = db.prepare(`SELECT o.* FROM space_screening_options o JOIN space_screening_questions q ON q.id = o.question_id WHERE q.space_id = ? ORDER BY o.created_at`).all(req.params.spaceId);
  return res.json({ questions: questions.map((question) => ({ ...question, options: options.filter((option) => option.question_id === question.id) })) });
});

app.post('/api/spaces/:spaceId/screening/questions', (req, res) => {
  if (!requireRestPermission(req, res, 'can_manage_space')) return;
  const { question_text, step_order, options } = req.body || {};
  if (!question_text || !Array.isArray(options) || options.length === 0) return res.status(400).json({ error: 'question_text and a non-empty options array are required' });
  const questionId = createUuid();
  const insert = db.transaction(() => {
    db.prepare('INSERT INTO space_screening_questions (id, space_id, question_text, step_order) VALUES (?, ?, ?, ?)').run(questionId, req.params.spaceId, question_text, Number(step_order || 0));
    const optionStmt = db.prepare('INSERT INTO space_screening_options (id, question_id, option_text, assigned_role_id) VALUES (?, ?, ?, ?)');
    options.forEach((option) => optionStmt.run(createUuid(), questionId, option.option_text, option.assigned_role_id || null));
  });
  insert();
  return res.status(201).json({ question_id: questionId });
});

app.post('/api/spaces/:spaceId/screening/submit', (req, res) => {
  const { user_id, answers } = req.body || {};
  if (!user_id || !Array.isArray(answers) || answers.length === 0) return res.status(400).json({ error: 'user_id and answers are required' });
  const assign = db.transaction(() => {
    const roles = new Set();
    const answerStmt = db.prepare(`INSERT OR REPLACE INTO space_screening_answers (id, space_id, user_id, question_id, option_id) VALUES (?, ?, ?, ?, ?)`);
    for (const answer of answers) {
      const option = db.prepare(`SELECT o.*, q.space_id FROM space_screening_options o JOIN space_screening_questions q ON q.id = o.question_id WHERE o.id = ? AND q.space_id = ?`).get(answer.option_id, req.params.spaceId);
      if (!option) throw new Error('Invalid screening option');
      answerStmt.run(createUuid(), req.params.spaceId, user_id, option.question_id, option.id);
      if (option.assigned_role_id) roles.add(option.assigned_role_id);
    }
    db.prepare(`INSERT INTO space_members (id, space_id, user_id, role_id, joined_at, is_active) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
      ON CONFLICT(space_id, user_id) DO UPDATE SET role_id = excluded.role_id, is_active = 1`).run(createUuid(), req.params.spaceId, user_id, [...roles][0] || null);
    return [...roles];
  });
  try { return res.json({ ok: true, assigned_role_ids: assign() }); } catch (error) { return res.status(400).json({ error: error.message }); }
});

app.post('/api/spaces/:spaceId/channels', (req, res) => {
  if (!requireRestPermission(req, res, 'can_manage_channels')) return;
  const { name, type, group_id, topic, allowed_role_ids = [] } = req.body || {};
  if (!name || !['text', 'voice', 'video'].includes(type)) return res.status(400).json({ error: 'name and a valid channel type are required' });
  if (group_id && !db.prepare('SELECT id FROM channel_groups WHERE id = ? AND space_id = ?').get(group_id, req.params.spaceId)) return res.status(400).json({ error: 'group_id does not belong to this space' });
  if (db.prepare('SELECT id FROM channels WHERE space_id = ? AND name = ?').get(req.params.spaceId, name)) {
    return res.status(409).json({ error: 'A channel with this name already exists in the space' });
  }
  const id = createUuid();
  const createChannel = db.transaction(() => {
    db.prepare('INSERT INTO channels (id, space_id, group_id, name, type, topic) VALUES (?, ?, ?, ?, ?, ?)').run(id, req.params.spaceId, group_id || null, name, type, topic || null);
    const insertRole = db.prepare('INSERT INTO channel_allowed_roles (channel_id, role_id) VALUES (?, ?)');
    allowed_role_ids.forEach((roleId) => insertRole.run(id, roleId));
  });
  try { createChannel(); broadcastSpaceChange(req.params.spaceId, 'channel_created', { channel_id: id }); return res.status(201).json({ channel: db.prepare('SELECT * FROM channels WHERE id = ?').get(id), allowed_role_ids }); } catch (error) { return res.status(400).json({ error: error.message }); }
});

app.get('/api/spaces/:spaceId/channels/visible', (req, res) => {
  const { user_id } = req.query;
  const member = user_id ? db.prepare('SELECT role_id FROM space_members WHERE space_id = ? AND user_id = ? AND is_active = 1').get(req.params.spaceId, user_id) : null;
  const channels = db.prepare(`SELECT c.*, GROUP_CONCAT(car.role_id) AS allowed_role_ids FROM channels c LEFT JOIN channel_allowed_roles car ON car.channel_id = c.id WHERE c.space_id = ? GROUP BY c.id ORDER BY c.created_at`).all(req.params.spaceId);
  return res.json({ channels: channels
    .filter((channel) => !channel.allowed_role_ids || (member && channel.allowed_role_ids.split(',').includes(member.role_id)))
    .map((channel) => ({ ...channel, allowed_role_ids: channel.allowed_role_ids ? channel.allowed_role_ids.split(',') : [] })) });
});

app.get('/api/spaces/:spaceId/channel-groups', (req, res) => {
  const groups = db.prepare('SELECT * FROM channel_groups WHERE space_id = ? ORDER BY sort_order, created_at').all(req.params.spaceId);
  return res.json({ groups });
});

app.post('/api/spaces/:spaceId/channel-groups', (req, res) => {
  if (!requireRestPermission(req, res, 'can_manage_channels')) return;
  const { name, sort_order } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const id = createUuid();
    db.prepare('INSERT INTO channel_groups (id, space_id, name, sort_order) VALUES (?, ?, ?, ?)').run(id, req.params.spaceId, name, Number(sort_order || 0));
    broadcastSpaceChange(req.params.spaceId, 'channel_group_created', { group_id: id });
    return res.status(201).json({ group: db.prepare('SELECT * FROM channel_groups WHERE id = ?').get(id) });
  } catch (error) {
    return res.status(409).json({ error: 'A channel group with this name already exists in the space' });
  }
});

app.get('/api/dms/:userId/:peerId', (req, res) => {
  const messages = db.prepare(`SELECT * FROM direct_messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) ORDER BY created_at ASC`).all(req.params.userId, req.params.peerId, req.params.peerId, req.params.userId);
  return res.json({ messages });
});

app.get('/api/channels/:channelId/messages', (req, res) => {
  const channel = db.prepare('SELECT space_id FROM channels WHERE id = ?').get(req.params.channelId);
  if (!channel || !hasSpacePermission(channel.space_id, req.query.user_id, 'can_manage_space') && !db.prepare('SELECT 1 FROM space_members WHERE space_id = ? AND user_id = ? AND is_active = 1').get(channel?.space_id, req.query.user_id)) {
    return res.status(403).json({ error: 'Channel access requires active space membership' });
  }
  const messages = db.prepare('SELECT * FROM channel_messages WHERE channel_id = ? ORDER BY created_at ASC LIMIT 200').all(req.params.channelId);
  return res.json({ messages });
});

const createUuid = () => crypto.randomUUID();
const secureToken = () => crypto.randomBytes(24).toString('hex');

function signPayload(payload) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', SIGNING_SECRET).update(raw).digest('hex');
}

function signedEnvelope(payload) {
  return {
    ...payload,
    signature: signPayload(payload),
  };
}

function broadcastSpaceChange(spaceId, type, data = {}) {
  io.to(`space:${spaceId}`).emit('space:broadcast', signedEnvelope({
    space_id: spaceId,
    type,
    data,
    sent_at: new Date().toISOString(),
  }));
}

function titleCase(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(' ');
}

function toJson(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function normalizeBoolean(value) {
  return value === true || value === 1 || value === '1' ? 1 : 0;
}

function getTask(taskId) {
  return db.prepare(`
    SELECT t.*, e.space_id
    FROM event_tasks t
    JOIN space_events e ON e.id = t.event_id
    WHERE t.id = ?
  `).get(taskId);
}

function getMemberPermissions(spaceId, userId) {
  const row = db.prepare(`
    SELECT r.* FROM space_members m
    JOIN roles r ON r.id = m.role_id
    WHERE m.space_id = ? AND m.user_id = ? AND m.is_active = 1
  `).get(spaceId, userId);
  return row || {};
}

function hasSpacePermission(spaceId, userId, permission) {
  if (!spaceId || !userId) return false;
  return Boolean(getMemberPermissions(spaceId, userId)[permission]);
}

function requireRestPermission(req, res, permission) {
  const actorId = req.body?.actor_id || req.body?.user_id || req.body?.created_by || req.body?.creator_id;
  if (!hasSpacePermission(req.params.spaceId, actorId, permission)) {
    res.status(403).json({ error: `Missing permission: ${permission}` });
    return false;
  }
  return true;
}

function ensureSpaceOwners() {
  const ownerRole = db.prepare(`
    INSERT INTO roles (
      id, space_id, name, priority_level, color, can_manage_space, can_manage_roles,
      can_manage_channels, can_manage_tasks, can_manage_events, can_manage_bots,
      can_kick, can_kick_members, can_ban_members, can_mute_members,
      can_dispatch_emergency_ping, is_default, created_at
    ) VALUES (?, ?, 'Owner', 0, '#EF4444', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, CURRENT_TIMESTAMP)
    ON CONFLICT(space_id, name) DO UPDATE SET
      priority_level = 0, can_manage_space = 1, can_manage_roles = 1,
      can_manage_channels = 1, can_manage_tasks = 1, can_manage_events = 1,
      can_manage_bots = 1, can_kick = 1, can_kick_members = 1,
      can_ban_members = 1, can_mute_members = 1, can_dispatch_emergency_ping = 1
  `);
  const assignOwner = db.prepare(`
    UPDATE space_members SET role_id = (SELECT id FROM roles WHERE space_id = ? AND name = 'Owner')
    WHERE space_id = ? AND user_id = (SELECT created_by FROM spaces WHERE id = ?)
  `);
  const sync = db.transaction(() => {
    for (const space of db.prepare('SELECT id FROM spaces').all()) {
      ownerRole.run(createUuid(), space.id);
      assignOwner.run(space.id, space.id, space.id);
    }
  });
  sync();
}

ensureSpaceOwners();

function defaultPermissionsForRole(name) {
  const normalized = String(name || '').toLowerCase();
  if (normalized.includes('owner')) {
    return {
      can_manage_tasks: true,
      can_manage_events: true,
      can_manage_bots: true,
      can_kick: true,
    };
  }
  if (normalized.includes('supervisor')) {
    return {
      can_manage_tasks: true,
      can_manage_events: true,
      can_manage_bots: false,
      can_kick: false,
    };
  }
  if (normalized.includes('moderator')) {
    return {
      can_manage_tasks: true,
      can_manage_events: true,
      can_manage_bots: false,
      can_kick: true,
    };
  }
  return {
    can_manage_tasks: false,
    can_manage_events: false,
    can_manage_bots: false,
    can_kick: false,
  };
}

function requirePermission(socket, requiredFlag) {
  const permissions = socket.data?.permissions || {};
  const allowed = Boolean(permissions[requiredFlag]);
  if (!allowed) {
    socket.emit('error', {
      type: 'forbidden',
      message: `Missing permission: ${requiredFlag}`,
    });
    return false;
  }
  return true;
}

function emitTaskState(task, oldStatus, newStatus, actorId) {
  const payload = signedEnvelope({
    space_id: task.space_id,
    event_id: task.event_id,
    task_id: task.id,
    old_status: oldStatus,
    new_status: newStatus,
    actor_id: actorId,
    assignee_user_id: task.assignee_user_id,
    assignee_role_id: task.assignee_role_id,
    title: task.title,
    updated_at: new Date().toISOString(),
    source: 'server',
    proof_required: Boolean(task.proof_required),
  });

  io.to(`space:${task.space_id}`).emit('task:state_changed', payload);
  return payload;
}

function dispatchPing({ spaceId, targetUserId, createdBy, pingLevel, category, title, message, payloadJson = {}, expiresAt = null }) {
  const pingId = createUuid();
  const now = new Date().toISOString();
  const record = {
    id: pingId,
    space_id: spaceId || null,
    target_user_id: targetUserId || null,
    created_by: createdBy,
    ping_level: Number(pingLevel),
    category,
    title,
    message: message || null,
    payload_json: JSON.stringify(payloadJson),
    is_acknowledged: 0,
    acknowledged_at: null,
    expires_at: expiresAt || null,
    created_at: now,
  };

  const stmt = db.prepare(`
    INSERT INTO pings (
      id, space_id, target_user_id, created_by, ping_level, category, title, message,
      payload_json, is_acknowledged, acknowledged_at, expires_at, created_at
    ) VALUES (
      @id, @space_id, @target_user_id, @created_by, @ping_level, @category, @title, @message,
      @payload_json, @is_acknowledged, @acknowledged_at, @expires_at, @created_at
    )
  `);
  stmt.run(record);

  const payload = signedEnvelope({
    ping_id: pingId,
    space_id: spaceId || null,
    target_user_id: targetUserId || null,
    created_by: createdBy,
    ping_level: Number(pingLevel),
    category,
    title,
    message,
    payload_json: payloadJson,
    expires_at: expiresAt || null,
    created_at: now,
  });

  const room = spaceId ? `space:${spaceId}` : `user:${targetUserId}`;
  if (Number(pingLevel) >= 3) {
    io.to(room).emit('ping:dispatch', payload);
    io.to(room).emit('ping:emergency', payload);
  } else {
    io.to(room).emit('ping:dispatch', payload);
  }

  return payload;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'sigma-backend', time: new Date().toISOString() });
});

app.get('/api/spaces', (req, res) => {
  const spaces = db.prepare('SELECT * FROM spaces ORDER BY created_at DESC').all();
  res.json({ spaces });
});

app.post('/api/spaces', (req, res) => {
  const { name, description, theme_color, icon_url, banner_url, created_by, is_private, xp_stake_pool } = req.body || {};
  if (!name || !created_by) {
    return res.status(400).json({ error: 'name and created_by are required' });
  }

  const id = createUuid();
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `space-${Date.now()}`;

  const existing = db.prepare('SELECT id FROM spaces WHERE slug = ?').get(slug);
  const uniqueSlug = existing ? `${slug}-${Date.now()}` : slug;

  const insertSpace = db.prepare(`
    INSERT INTO spaces (id, name, slug, description, theme_color, icon_url, banner_url, is_private, xp_stake_pool, bandwidth_limit_mb, storage_quota_mb, created_by, created_at, updated_at)
    VALUES (@id, @name, @slug, @description, @theme_color, @icon_url, @banner_url, @is_private, @xp_stake_pool, 1024, 4096, @created_by, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  insertSpace.run({
    id,
    name,
    slug: uniqueSlug,
    description: description || null,
    theme_color: theme_color || '#4F46E5',
    icon_url: icon_url || null,
    banner_url: banner_url || null,
    is_private: Number(Boolean(is_private)) ? 1 : 0,
    xp_stake_pool: Number(xp_stake_pool || 0),
    created_by,
  });

  const memberId = createUuid();
  db.prepare(`
    INSERT INTO space_members (id, space_id, user_id, role_id, joined_at, xp_balance, local_bandwidth_quota_mb, local_storage_quota_mb, is_active)
    VALUES (@id, @space_id, @user_id, @role_id, CURRENT_TIMESTAMP, 0, 1024, 2048, 1)
  `).run({ id: memberId, space_id: id, user_id: created_by, role_id: null });

  const everyoneRoleId = createUuid();
  db.prepare(`
    INSERT INTO roles (id, space_id, name, priority_level, can_manage_tasks, can_manage_events, can_manage_bots, can_kick, is_default, created_at)
    VALUES (@id, @space_id, @name, 999, 0, 0, 0, 0, 1, CURRENT_TIMESTAMP)
  `).run({ id: everyoneRoleId, space_id: id, name: '@everyone' });
  const ownerRoleId = createUuid();
  db.prepare(`
    INSERT INTO roles (
      id, space_id, name, priority_level, color, can_manage_space, can_manage_roles,
      can_manage_channels, can_manage_tasks, can_manage_events, can_manage_bots,
      can_kick, can_kick_members, can_ban_members, can_mute_members,
      can_dispatch_emergency_ping, is_default, created_at
    ) VALUES (?, ?, 'Owner', 0, '#EF4444', 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, CURRENT_TIMESTAMP)
  `).run(ownerRoleId, id);
  db.prepare('UPDATE space_members SET role_id = ? WHERE space_id = ? AND user_id = ?').run(ownerRoleId, id, created_by);

  const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(id);
  const roles = db.prepare('SELECT * FROM roles WHERE space_id = ? ORDER BY priority_level ASC').all(id);
  const members = db.prepare('SELECT * FROM space_members WHERE space_id = ?').all(id);

  io.to(`space:${id}`).emit('space:broadcast', signedEnvelope({
    space_id: id,
    type: 'space_created',
    message: `${name} was created`,
    created_by,
    created_at: new Date().toISOString(),
    signature: signPayload({ type: 'space_created', space_id: id, created_by }),
  }));

  res.status(201).json({ space, roles, members });
});

app.get('/api/spaces/:spaceId', (req, res) => {
  const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(req.params.spaceId);
  if (!space) return res.status(404).json({ error: 'Space not found' });

  const roles = db.prepare('SELECT * FROM roles WHERE space_id = ? ORDER BY priority_level ASC').all(req.params.spaceId);
  const members = db.prepare('SELECT * FROM space_members WHERE space_id = ?').all(req.params.spaceId);
  const member = req.query.user_id ? db.prepare('SELECT role_id FROM space_members WHERE space_id = ? AND user_id = ? AND is_active = 1').get(req.params.spaceId, req.query.user_id) : null;
  const channels = db.prepare('SELECT c.*, GROUP_CONCAT(car.role_id) AS allowed_role_ids FROM channels c LEFT JOIN channel_allowed_roles car ON car.channel_id = c.id WHERE c.space_id = ? GROUP BY c.id ORDER BY c.created_at DESC').all(req.params.spaceId)
    .filter((channel) => !channel.allowed_role_ids || (member && channel.allowed_role_ids.split(',').includes(member.role_id)))
    .map((channel) => ({ ...channel, allowed_role_ids: channel.allowed_role_ids ? channel.allowed_role_ids.split(',') : [] }));
  const events = db.prepare('SELECT * FROM space_events WHERE space_id = ? ORDER BY start_at DESC').all(req.params.spaceId);
  const tasks = db.prepare(`SELECT t.*, e.space_id FROM event_tasks t JOIN space_events e ON e.id = t.event_id WHERE e.space_id = ? ORDER BY t.updated_at DESC`).all(req.params.spaceId);

  const groups = db.prepare('SELECT * FROM channel_groups WHERE space_id = ? ORDER BY sort_order, created_at').all(req.params.spaceId);
  res.json({ space, roles, members, channels, groups, events, tasks });
});

app.post('/api/spaces/:spaceId/roles', (req, res) => {
  if (!requireRestPermission(req, res, 'can_manage_roles')) return;
  const { name, color, priority_level, mute_duration_seconds, ...permissions } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  const id = createUuid();
  const roleRow = {
    id,
    space_id: req.params.spaceId,
    name: titleCase(name),
    priority_level: Number(priority_level ?? 99),
    color: color || '#6366F1',
    can_manage_space: normalizeBoolean(permissions.can_manage_space),
    can_manage_roles: normalizeBoolean(permissions.can_manage_roles),
    can_manage_channels: normalizeBoolean(permissions.can_manage_channels),
    can_manage_tasks: normalizeBoolean(permissions.can_manage_tasks),
    can_manage_events: normalizeBoolean(permissions.can_manage_events),
    can_manage_bots: normalizeBoolean(permissions.can_manage_bots),
    can_kick: normalizeBoolean(permissions.can_kick),
    can_kick_members: normalizeBoolean(permissions.can_kick_members),
    can_ban_members: normalizeBoolean(permissions.can_ban_members),
    can_mute_members: normalizeBoolean(permissions.can_mute_members),
    can_dispatch_emergency_ping: normalizeBoolean(permissions.can_dispatch_emergency_ping),
    mute_duration_seconds: mute_duration_seconds ? Number(mute_duration_seconds) : null,
    is_default: 0,
  };

  const stmt = db.prepare(`
    INSERT INTO roles (id, space_id, name, priority_level, color, can_manage_space, can_manage_roles, can_manage_channels, can_manage_tasks, can_manage_events, can_manage_bots, can_kick, can_kick_members, can_ban_members, can_mute_members, can_dispatch_emergency_ping, mute_duration_seconds, is_default, created_at)
    VALUES (@id, @space_id, @name, @priority_level, @color, @can_manage_space, @can_manage_roles, @can_manage_channels, @can_manage_tasks, @can_manage_events, @can_manage_bots, @can_kick, @can_kick_members, @can_ban_members, @can_mute_members, @can_dispatch_emergency_ping, @mute_duration_seconds, @is_default, CURRENT_TIMESTAMP)
  `);
  stmt.run(roleRow);

  broadcastSpaceChange(req.params.spaceId, 'role_created', { role_id: id });

  res.status(201).json({ role: roleRow });
});

app.post('/api/spaces/:spaceId/members', (req, res) => {
  const { user_id, role_id, actor_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  if (!hasSpacePermission(req.params.spaceId, actor_id, 'can_manage_space')) return res.status(403).json({ error: 'Missing permission: can_manage_space' });

  const existing = db.prepare('SELECT id FROM space_members WHERE space_id = ? AND user_id = ?').get(req.params.spaceId, user_id);
  if (existing) {
    db.prepare('UPDATE space_members SET role_id = ?, is_active = 1 WHERE space_id = ? AND user_id = ?').run(role_id || null, req.params.spaceId, user_id);
    return res.json({ ok: true, updated: true });
  }

  const id = createUuid();
  db.prepare(`
    INSERT INTO space_members (id, space_id, user_id, role_id, joined_at, xp_balance, local_bandwidth_quota_mb, local_storage_quota_mb, is_active)
    VALUES (@id, @space_id, @user_id, @role_id, CURRENT_TIMESTAMP, 0, 1024, 2048, 1)
  `).run({ id, space_id: req.params.spaceId, user_id, role_id: role_id || null });

  broadcastSpaceChange(req.params.spaceId, 'member_added', { user_id, role_id: role_id || null });

  res.status(201).json({ ok: true, member_id: id });
});

app.post('/api/spaces/:spaceId/events', (req, res) => {
  if (!requireRestPermission(req, res, 'can_manage_events')) return;
  const { creator_id, title, description, event_type, is_virtual, location, start_at, end_at } = req.body || {};
  if (!creator_id || !title || !event_type || !start_at) {
    return res.status(400).json({ error: 'creator_id, title, event_type, and start_at are required' });
  }

  const id = createUuid();
  db.prepare(`
    INSERT INTO space_events (id, space_id, creator_id, title, description, event_type, is_virtual, location, start_at, end_at, status, created_at, updated_at)
    VALUES (@id, @space_id, @creator_id, @title, @description, @event_type, @is_virtual, @location, @start_at, @end_at, 'scheduled', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run({
    id,
    space_id: req.params.spaceId,
    creator_id,
    title,
    description: description || null,
    event_type,
    is_virtual: Number(Boolean(is_virtual)) ? 1 : 0,
    location: location || null,
    start_at,
    end_at: end_at || null,
  });

  broadcastSpaceChange(req.params.spaceId, 'event_created', { event_id: id });

  res.status(201).json({ event_id: id });
});

app.post('/api/spaces/:spaceId/tasks', (req, res) => {
  if (!requireRestPermission(req, res, 'can_manage_tasks')) return;
  const { event_id, created_by, title, description, assignee_user_id, assignee_role_id, due_at, proof_required } = req.body || {};
  if (!event_id || !created_by || !title) {
    return res.status(400).json({ error: 'event_id, created_by, and title are required' });
  }

  const taskId = createUuid();
  const stmt = db.prepare(`
    INSERT INTO event_tasks (id, event_id, created_by, title, description, assignee_user_id, assignee_role_id, due_at, status, proof_required, created_at, updated_at)
    VALUES (@id, @event_id, @created_by, @title, @description, @assignee_user_id, @assignee_role_id, @due_at, 'pending', @proof_required, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  stmt.run({
    id: taskId,
    event_id,
    created_by,
    title,
    description: description || null,
    assignee_user_id: assignee_user_id || null,
    assignee_role_id: assignee_role_id || null,
    due_at: due_at || null,
    proof_required: Number(Boolean(proof_required !== false)) ? 1 : 0,
  });

  broadcastSpaceChange(req.params.spaceId, 'task_created', { task_id: taskId });

  const task = db.prepare('SELECT * FROM event_tasks WHERE id = ?').get(taskId);
  res.status(201).json({ task });
});

app.post('/api/tasks/:taskId/assign', (req, res) => {
  const { assignee_user_id, assignee_role_id, actor_id } = req.body || {};
  if (!assignee_user_id && !assignee_role_id) {
    return res.status(400).json({ error: 'assignee_user_id or assignee_role_id is required' });
  }

  const task = db.prepare('SELECT * FROM event_tasks WHERE id = ?').get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (!hasSpacePermission(task.space_id, actor_id, 'can_manage_tasks')) return res.status(403).json({ error: 'Missing permission: can_manage_tasks' });

  db.prepare(`
    UPDATE event_tasks
    SET assignee_user_id = @assignee_user_id, assignee_role_id = @assignee_role_id, status = 'assigned', updated_at = CURRENT_TIMESTAMP
    WHERE id = @task_id
  `).run({
    task_id: req.params.taskId,
    assignee_user_id: assignee_user_id || null,
    assignee_role_id: assignee_role_id || null,
  });

  const updatedTask = db.prepare('SELECT * FROM event_tasks WHERE id = ?').get(req.params.taskId);
  emitTaskState(updatedTask, 'pending', 'assigned', actor_id || 'server');
  res.json({ task: updatedTask });
});

app.post('/api/tasks/:taskId/proofs', (req, res) => {
  const { user_id, text_note, attachments = [] } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });

  const task = db.prepare('SELECT * FROM event_tasks WHERE id = ?').get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const proofId = createUuid();
  db.prepare(`
    INSERT INTO task_proofs (id, task_id, submitted_by, text_note, status, reviewed_by, reviewed_at, created_at)
    VALUES (@id, @task_id, @submitted_by, @text_note, 'pending', NULL, NULL, CURRENT_TIMESTAMP)
  `).run({
    id: proofId,
    task_id: req.params.taskId,
    submitted_by: user_id,
    text_note: text_note || null,
  });

  for (const attachment of attachments) {
    const fileId = createUuid();
    db.prepare(`
      INSERT INTO file_attachments (id, task_id, event_id, uploader_id, original_name, storage_path, mime_type, size_bytes, checksum_sha256, created_at)
      VALUES (@id, @task_id, @event_id, @uploader_id, @original_name, @storage_path, @mime_type, @size_bytes, @checksum_sha256, CURRENT_TIMESTAMP)
    `).run({
      id: fileId,
      task_id: req.params.taskId,
      event_id: task.event_id,
      uploader_id: user_id,
      original_name: attachment.original_name || 'attachment',
      storage_path: attachment.storage_path || '/local/attachment',
      mime_type: attachment.mime_type || 'application/octet-stream',
      size_bytes: Number(attachment.size_bytes || 0),
      checksum_sha256: attachment.checksum_sha256 || null,
    });
  }

  db.prepare(`UPDATE event_tasks SET status = 'submitted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(req.params.taskId);

  const updatedTask = db.prepare('SELECT * FROM event_tasks WHERE id = ?').get(req.params.taskId);
  emitTaskState(updatedTask, updatedTask.status === 'in_progress' ? 'in_progress' : 'pending', 'submitted', user_id);

  io.to(`space:${task.space_id || 'unknown'}`).emit('task:proof_submitted', signedEnvelope({
    space_id: task.space_id || 'unknown',
    task_id: req.params.taskId,
    submitted_by: user_id,
    note: text_note || null,
    attachment_ids: attachments.map((attachment) => attachment.id || attachment.original_name || 'attachment'),
    submitted_at: new Date().toISOString(),
  }));

  res.status(201).json({ ok: true, task_id: req.params.taskId, proof_id: proofId });
});

app.post('/api/bots/register', (req, res) => {
  const { space_id, bot_name, permissions, webhook_url, owner_user_id } = req.body || {};
  if (!space_id || !bot_name || !webhook_url || !owner_user_id) {
    return res.status(400).json({ error: 'space_id, bot_name, webhook_url, and owner_user_id are required' });
  }
  if (!hasSpacePermission(space_id, owner_user_id, 'can_manage_bots')) return res.status(403).json({ error: 'Missing permission: can_manage_bots' });

  const botId = createUuid();
  const verificationToken = secureToken();
  const permissionsJson = JSON.stringify(Array.isArray(permissions) ? permissions : []);
  const existing = db.prepare('SELECT id FROM space_bots WHERE space_id = ? AND bot_name = ?').get(space_id, bot_name);
  if (existing) return res.status(409).json({ error: 'Bot already exists in this space' });

  db.prepare(`
    INSERT INTO space_bots (id, space_id, bot_name, owner_user_id, permissions_json, webhook_url, api_token_hash, verification_token, is_verified, verified_by, verified_at, created_at, updated_at)
    VALUES (@id, @space_id, @bot_name, @owner_user_id, @permissions_json, @webhook_url, NULL, @verification_token, 0, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run({
    id: botId,
    space_id,
    bot_name,
    owner_user_id,
    permissions_json: permissionsJson,
    webhook_url,
    verification_token: verificationToken,
  });

  res.status(201).json({
    bot_id: botId,
    verification_url: `http://localhost:${PORT}/api/bots/verify?token=${verificationToken}`,
    status: 'pending_verification',
    token: verificationToken,
  });
});

app.get('/api/bots/verify', (req, res) => {
  const token = req.query.token;
  if (!token || typeof token !== 'string') {
    return res.status(400).send('<h1>Bot verification failed</h1><p>Missing verification token.</p>');
  }

  const record = db.prepare('SELECT * FROM space_bots WHERE verification_token = ?').get(token);
  if (!record) return res.status(404).send('<h1>Bot not found</h1><p>The verification token is invalid.</p>');
  if (record.is_verified === 1) return res.status(200).send(`<h1>Bot already verified</h1><p>${record.bot_name}</p>`);

  const apiToken = secureToken();
  const apiTokenHash = crypto.createHash('sha256').update(apiToken).digest('hex');
  db.prepare(`
    UPDATE space_bots
    SET is_verified = 1, api_token_hash = @api_token_hash, verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ api_token_hash: apiTokenHash, id: record.id });

  io.to(`space:${record.space_id}`).emit('bot:verified', signedEnvelope({
    space_id: record.space_id,
    bot_id: record.id,
    bot_name: record.bot_name,
    verified_at: new Date().toISOString(),
    api_token_ready: true,
    websocket_enabled: true,
  }));

  return res.status(200).send(`
    <html>
      <body style="font-family: sans-serif; padding: 32px;">
        <h1>Bot verified</h1>
        <p>${record.bot_name} has been approved for the space.</p>
        <p><strong>API token:</strong> ${apiToken}</p>
      </body>
    </html>
  `);
});

io.on('connection', (socket) => {
  socket.on('join:space', (payload = {}) => {
    const { space_id, user_id } = payload;
    if (!space_id) {
      socket.emit('error', { type: 'validation', message: 'space_id is required' });
      return;
    }
    if (!user_id || !db.prepare('SELECT 1 FROM space_members WHERE space_id = ? AND user_id = ? AND is_active = 1').get(space_id, user_id)) {
      socket.emit('error', { type: 'forbidden', message: 'You are not an active member of this space' });
      return;
    }
    socket.join(`space:${space_id}`);
    socket.data.space_id = space_id;
    socket.data.user_id = user_id;
    socket.data.permissions = getMemberPermissions(space_id, user_id);
    if (user_id) socket.join(`user:${user_id}`);
    socket.emit('joined:space', { space_id, connected: true });
  });

  socket.on('join:channel', (payload = {}) => {
    const { channel_id, user_id } = payload;
    const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channel_id);
    if (!channel) return socket.emit('error', { type: 'not_found', message: 'Channel not found' });
    if (!user_id || !db.prepare('SELECT 1 FROM space_members WHERE space_id = ? AND user_id = ? AND is_active = 1').get(channel.space_id, user_id)) {
      return socket.emit('error', { type: 'forbidden', message: 'You are not an active member of this space' });
    }
    const role = db.prepare('SELECT role_id FROM space_members WHERE space_id = ? AND user_id = ? AND is_active = 1').get(channel.space_id, user_id);
    const allowed = db.prepare('SELECT 1 FROM channel_allowed_roles WHERE channel_id = ? LIMIT 1').get(channel_id);
    if (allowed && !db.prepare('SELECT 1 FROM channel_allowed_roles WHERE channel_id = ? AND role_id = ?').get(channel_id, role?.role_id)) {
      return socket.emit('error', { type: 'forbidden', message: 'Your role cannot access this channel' });
    }
    socket.join(`channel:${channel_id}`);
    socket.data.user_id = user_id;
    socket.data.space_id = channel.space_id;
    socket.emit('joined:channel', { channel_id, space_id: channel.space_id });
  });

  socket.on('channel:send_message', (payload = {}) => {
    const { channel_id, sender_id, body, attachment_url } = payload;
    const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channel_id);
    if (!channel || !body && !attachment_url || socket.data.user_id !== sender_id) {
      return socket.emit('error', { type: 'validation', message: 'Valid channel, sender, and message content are required' });
    }
    if (!socket.rooms.has(`channel:${channel_id}`)) return socket.emit('error', { type: 'forbidden', message: 'Join this channel before sending messages' });
    const id = createUuid();
    db.prepare('INSERT INTO channel_messages (id, channel_id, sender_id, body, attachment_url) VALUES (?, ?, ?, ?, ?)').run(id, channel_id, sender_id, body || null, attachment_url || null);
    const message = db.prepare('SELECT * FROM channel_messages WHERE id = ?').get(id);
    io.to(`channel:${channel_id}`).emit('channel:message', message);
  });

  socket.on('join:voice', (payload = {}) => {
    const { channel_id, user_id } = payload;
    const channel = db.prepare("SELECT * FROM channels WHERE id = ? AND type = 'voice'").get(channel_id);
    if (!channel || socket.data.user_id !== user_id || !socket.rooms.has(`channel:${channel_id}`)) return socket.emit('error', { type: 'forbidden', message: 'Join a voice channel as an authenticated member first' });
    socket.join(`voice:${channel_id}`);
    io.to(`voice:${channel_id}`).emit('voice:presence', { channel_id, user_id, active: true });
  });

  socket.on('leave:voice', (payload = {}) => {
    const { channel_id, user_id } = payload;
    socket.leave(`voice:${channel_id}`);
    io.to(`voice:${channel_id}`).emit('voice:presence', { channel_id, user_id, active: false });
  });

  socket.on('dm:send', (payload = {}) => {
    const { sender_id, receiver_id, body, attachment_url } = payload;
    if (!sender_id || !receiver_id || (!body && !attachment_url)) return socket.emit('error', { type: 'validation', message: 'sender_id, receiver_id, and body or attachment_url are required' });
    if (socket.data.user_id !== sender_id) return socket.emit('error', { type: 'forbidden', message: 'Sender identity does not match the connected user' });
    const id = createUuid();
    db.prepare('INSERT INTO direct_messages (id, sender_id, receiver_id, body, attachment_url, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)').run(id, sender_id, receiver_id, body || null, attachment_url || null);
    const message = db.prepare('SELECT * FROM direct_messages WHERE id = ?').get(id);
    io.to(`user:${sender_id}`).to(`user:${receiver_id}`).emit('dm:message', message);
    const mentionPattern = /((?:!!|!)?@|s@)([a-zA-Z0-9_.-]+)/g;
    for (const match of String(body || '').matchAll(mentionPattern)) {
      const level = match[1] === 's@' ? 0 : match[1] === '@' ? 1 : match[1] === '!@' ? 2 : 3;
      const target = db.prepare('SELECT id FROM users WHERE username = ?').get(match[2]);
      if (target) dispatchPing({ targetUserId: target.id, createdBy: sender_id, pingLevel: level, category: 'manual', title: `Mention from ${sender_id}`, message: body, payloadJson: { message_id: id, mention: match[0] } });
    }
  });

  socket.on('task:assign', (payload = {}) => {
    const { task_id, assignee_user_id, assignee_role_id, actor_id } = payload;
    if (!task_id || (!assignee_user_id && !assignee_role_id)) {
      socket.emit('error', { type: 'validation', message: 'task_id and an assignee are required' });
      return;
    }

    if (!requirePermission(socket, 'can_manage_tasks')) {
      return;
    }

    const task = db.prepare('SELECT * FROM event_tasks WHERE id = ?').get(task_id);
    if (!task) {
      socket.emit('error', { type: 'not_found', message: 'Task not found' });
      return;
    }

    db.prepare(`
      UPDATE event_tasks
      SET assignee_user_id = @assignee_user_id,
          assignee_role_id = @assignee_role_id,
          status = 'assigned',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @task_id
    `).run({
      task_id,
      assignee_user_id: assignee_user_id || null,
      assignee_role_id: assignee_role_id || null,
    });

    const updatedTask = db.prepare('SELECT * FROM event_tasks WHERE id = ?').get(task_id);
    emitTaskState(updatedTask, 'pending', 'assigned', actor_id || socket.id);
    socket.emit('task:assigned', { task_id, task: updatedTask });
  });

  socket.on('task:update_status', (payload = {}) => {
    const { task_id, new_status, actor_id } = payload;
    if (!task_id || !new_status) {
      socket.emit('error', { type: 'validation', message: 'task_id and new_status are required' });
      return;
    }

    const task = db.prepare('SELECT * FROM event_tasks WHERE id = ?').get(task_id);
    if (!task) {
      socket.emit('error', { type: 'not_found', message: 'Task not found' });
      return;
    }
    if (task.assignee_user_id !== socket.data.user_id && !requirePermission(socket, 'can_manage_tasks')) return;

    const previousStatus = task.status;
    db.prepare(`UPDATE event_tasks SET status = @new_status, updated_at = CURRENT_TIMESTAMP WHERE id = @task_id`).run({
      task_id,
      new_status,
    });

    const updatedTask = db.prepare('SELECT * FROM event_tasks WHERE id = ?').get(task_id);
    emitTaskState(updatedTask, previousStatus, new_status, actor_id || socket.id);
    socket.emit('task:status_updated', { task_id, status: new_status, updated_at: new Date().toISOString() });
  });

  socket.on('task:submit_proof', (payload = {}) => {
    const { task_id, user_id, text_note, attachments = [] } = payload;
    if (!task_id || !user_id) {
      socket.emit('error', { type: 'validation', message: 'task_id and user_id are required' });
      return;
    }

    const task = db.prepare('SELECT * FROM event_tasks WHERE id = ?').get(task_id);
    if (!task) {
      socket.emit('error', { type: 'not_found', message: 'Task not found' });
      return;
    }
    if (socket.data.user_id !== user_id) {
      socket.emit('error', { type: 'forbidden', message: 'Submitter identity does not match the connected user' });
      return;
    }
    if (task.assignee_user_id && task.assignee_user_id !== user_id && !requirePermission(socket, 'can_manage_tasks')) return;

    const proofId = createUuid();
    db.prepare(`INSERT INTO task_proofs (id, task_id, submitted_by, text_note, status, created_at) VALUES (@id, @task_id, @submitted_by, @text_note, 'pending', CURRENT_TIMESTAMP)`).run({
      id: proofId,
      task_id: task_id,
      submitted_by: user_id,
      text_note: text_note || null,
    });

    for (const attachment of attachments) {
      const fileId = createUuid();
      db.prepare(`INSERT INTO file_attachments (id, task_id, event_id, uploader_id, original_name, storage_path, mime_type, size_bytes, created_at) VALUES (@id, @task_id, @event_id, @uploader_id, @original_name, @storage_path, @mime_type, @size_bytes, CURRENT_TIMESTAMP)`).run({
        id: fileId,
        task_id: task_id,
        event_id: task.event_id,
        uploader_id: user_id,
        original_name: attachment.original_name || 'attachment',
        storage_path: attachment.storage_path || '/local/uploads',
        mime_type: attachment.mime_type || 'application/octet-stream',
        size_bytes: Number(attachment.size_bytes || 0),
      });
    }

    db.prepare(`UPDATE event_tasks SET status = 'submitted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(task_id);
    const updatedTask = db.prepare('SELECT * FROM event_tasks WHERE id = ?').get(task_id);
    emitTaskState(updatedTask, 'in_progress', 'submitted', user_id);
    socket.emit('task:submitted', { task_id, status: 'submitted' });
  });

  socket.on('ping:dispatch', (payload = {}) => {
    const { space_id, target_user_id, created_by, ping_level, category, title, message, payload_json = {}, expires_at } = payload;
    if (!created_by || !title || !category || ping_level === undefined) {
      socket.emit('error', { type: 'validation', message: 'created_by, title, category, and ping_level are required' });
      return;
    }
    if (space_id && (!socket.data.user_id || socket.data.space_id !== space_id)) {
      socket.emit('error', { type: 'forbidden', message: 'Join the target space before dispatching a ping' });
      return;
    }
    if (socket.data.user_id !== created_by) {
      socket.emit('error', { type: 'forbidden', message: 'Creator identity does not match the connected user' });
      return;
    }
    if (Number(ping_level) >= 3 && !requirePermission(socket, 'can_dispatch_emergency_ping')) return;

    const dispatched = dispatchPing({
      spaceId: space_id || null,
      targetUserId: target_user_id || null,
      createdBy: created_by,
      pingLevel,
      category,
      title,
      message,
      payloadJson: payload_json,
      expiresAt: expires_at || null,
    });

    socket.emit('ping:dispatch_ack', dispatched);
  });

  socket.on('ping:acknowledge', (payload = {}) => {
    const { ping_id, user_id } = payload;
    if (!ping_id || !user_id) {
      socket.emit('error', { type: 'validation', message: 'ping_id and user_id are required' });
      return;
    }
    db.prepare(`UPDATE pings SET is_acknowledged = 1, acknowledged_at = CURRENT_TIMESTAMP WHERE id = @ping_id AND target_user_id = @user_id`).run({ ping_id, user_id });
    socket.emit('ping:acknowledged', { ping_id, user_id, acknowledged_at: new Date().toISOString() });
  });

  socket.on('space:broadcast', (payload = {}) => {
    const { space_id, user_id, text, message, type = 'announcement' } = payload;
    if (!space_id || (!text && !message)) {
      socket.emit('error', { type: 'validation', message: 'space_id and text/message are required' });
      return;
    }

    const envelope = signedEnvelope({
      space_id,
      user_id: user_id || socket.id,
      type,
      text: text || message,
      sent_at: new Date().toISOString(),
    });

    io.to(`space:${space_id}`).emit('space:broadcast', envelope);
  });

  socket.on('bot:register', (payload = {}) => {
    const { space_id, bot_name, permissions, webhook_url, owner_user_id } = payload;
    if (!space_id || !bot_name || !webhook_url || !owner_user_id) {
      socket.emit('error', { type: 'validation', message: 'space_id, bot_name, webhook_url, and owner_user_id are required' });
      return;
    }
    if (socket.data.user_id !== owner_user_id || socket.data.space_id !== space_id || !requirePermission(socket, 'can_manage_bots')) return;

    const verificationToken = secureToken();
    const botId = createUuid();
    db.prepare(`
      INSERT INTO space_bots (id, space_id, bot_name, owner_user_id, permissions_json, webhook_url, verification_token, is_verified, created_at, updated_at)
      VALUES (@id, @space_id, @bot_name, @owner_user_id, @permissions_json, @webhook_url, @verification_token, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run({
      id: botId,
      space_id,
      bot_name,
      owner_user_id,
      permissions_json: JSON.stringify(permissions || []),
      webhook_url,
      verification_token: verificationToken,
    });

    socket.emit('bot:registration_pending', {
      bot_id: botId,
      verification_url: `http://localhost:${PORT}/api/bots/verify?token=${verificationToken}`,
    });
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on http://0.0.0.0:${PORT}`);
});
