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

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));

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
  const { name, description, theme_color, created_by, is_private, xp_stake_pool } = req.body || {};
  if (!name || !created_by) {
    return res.status(400).json({ error: 'name and created_by are required' });
  }

  const id = createUuid();
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `space-${Date.now()}`;

  const existing = db.prepare('SELECT id FROM spaces WHERE slug = ?').get(slug);
  const uniqueSlug = existing ? `${slug}-${Date.now()}` : slug;

  const insertSpace = db.prepare(`
    INSERT INTO spaces (id, name, slug, description, theme_color, is_private, xp_stake_pool, bandwidth_limit_mb, storage_quota_mb, created_by, created_at, updated_at)
    VALUES (@id, @name, @slug, @description, @theme_color, @is_private, @xp_stake_pool, 1024, 4096, @created_by, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  insertSpace.run({
    id,
    name,
    slug: uniqueSlug,
    description: description || null,
    theme_color: theme_color || '#4F46E5',
    is_private: Number(Boolean(is_private)) ? 1 : 0,
    xp_stake_pool: Number(xp_stake_pool || 0),
    created_by,
  });

  const memberId = createUuid();
  db.prepare(`
    INSERT INTO space_members (id, space_id, user_id, role_id, joined_at, xp_balance, local_bandwidth_quota_mb, local_storage_quota_mb, is_active)
    VALUES (@id, @space_id, @user_id, @role_id, CURRENT_TIMESTAMP, 0, 1024, 2048, 1)
  `).run({ id: memberId, space_id: id, user_id: created_by, role_id: null });

  const ownerRoleId = createUuid();
  db.prepare(`
    INSERT INTO roles (id, space_id, name, priority_level, can_manage_tasks, can_manage_events, can_manage_bots, can_kick, is_default, created_at)
    VALUES (@id, @space_id, @name, 1, 1, 1, 1, 1, 1, CURRENT_TIMESTAMP)
  `).run({ id: ownerRoleId, space_id: id, name: 'Owner' });

  db.prepare('UPDATE space_members SET role_id = ? WHERE space_id = ? AND user_id = ?').run(ownerRoleId, id, created_by);

  const supervisorRoleId = createUuid();
  db.prepare(`
    INSERT INTO roles (id, space_id, name, priority_level, can_manage_tasks, can_manage_events, can_manage_bots, can_kick, is_default, created_at)
    VALUES (@id, @space_id, @name, 3, 1, 1, 0, 0, 0, CURRENT_TIMESTAMP)
  `).run({ id: supervisorRoleId, space_id: id, name: 'Supervisor' });

  const memberRoleId = createUuid();
  db.prepare(`
    INSERT INTO roles (id, space_id, name, priority_level, can_manage_tasks, can_manage_events, can_manage_bots, can_kick, is_default, created_at)
    VALUES (@id, @space_id, @name, 10, 0, 0, 0, 0, 1, CURRENT_TIMESTAMP)
  `).run({ id: memberRoleId, space_id: id, name: 'Member' });

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
  const channels = db.prepare('SELECT * FROM channels WHERE space_id = ? ORDER BY created_at DESC').all(req.params.spaceId);
  const events = db.prepare('SELECT * FROM space_events WHERE space_id = ? ORDER BY start_at DESC').all(req.params.spaceId);

  res.json({ space, roles, members, channels, events });
});

app.post('/api/spaces/:spaceId/roles', (req, res) => {
  const { name, priority_level, can_manage_tasks, can_manage_events, can_manage_bots, can_kick } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });

  const id = createUuid();
  const defaults = defaultPermissionsForRole(name);
  const roleRow = {
    id,
    space_id: req.params.spaceId,
    name: titleCase(name),
    priority_level: Number(priority_level ?? 99),
    can_manage_tasks: Number(Boolean(can_manage_tasks ?? defaults.can_manage_tasks)),
    can_manage_events: Number(Boolean(can_manage_events ?? defaults.can_manage_events)),
    can_manage_bots: Number(Boolean(can_manage_bots ?? defaults.can_manage_bots)),
    can_kick: Number(Boolean(can_kick ?? defaults.can_kick)),
    is_default: 0,
  };

  const stmt = db.prepare(`
    INSERT INTO roles (id, space_id, name, priority_level, can_manage_tasks, can_manage_events, can_manage_bots, can_kick, is_default, created_at)
    VALUES (@id, @space_id, @name, @priority_level, @can_manage_tasks, @can_manage_events, @can_manage_bots, @can_kick, @is_default, CURRENT_TIMESTAMP)
  `);
  stmt.run(roleRow);

  res.status(201).json({ role: roleRow });
});

app.post('/api/spaces/:spaceId/members', (req, res) => {
  const { user_id, role_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });

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

  res.status(201).json({ ok: true, member_id: id });
});

app.post('/api/spaces/:spaceId/events', (req, res) => {
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

  res.status(201).json({ event_id: id });
});

app.post('/api/spaces/:spaceId/tasks', (req, res) => {
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
    const { space_id } = payload;
    if (!space_id) {
      socket.emit('error', { type: 'validation', message: 'space_id is required' });
      return;
    }
    socket.join(`space:${space_id}`);
    socket.data.space_id = space_id;
    socket.emit('joined:space', { space_id, connected: true });
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
