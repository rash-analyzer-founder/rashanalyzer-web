PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  bio TEXT,
  avatar_url TEXT,
  banner_url TEXT,
  xp INTEGER NOT NULL DEFAULT 0,
  total_xp INTEGER NOT NULL DEFAULT 0,
  local_rank INTEGER NOT NULL DEFAULT 0,
  preferred_ping_level INTEGER NOT NULL DEFAULT 1 CHECK (preferred_ping_level BETWEEN 0 AND 3),
  is_cs_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_cs_verified IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  theme_color TEXT,
  icon_url TEXT,
  banner_url TEXT,
  is_private INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0, 1)),
  xp_stake_pool INTEGER NOT NULL DEFAULT 0,
  bandwidth_limit_mb INTEGER NOT NULL DEFAULT 1024,
  storage_quota_mb INTEGER NOT NULL DEFAULT 4096,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  name TEXT NOT NULL,
  priority_level INTEGER NOT NULL CHECK (priority_level >= 0),
  can_manage_tasks INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_tasks IN (0, 1)),
  can_manage_events INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_events IN (0, 1)),
  can_manage_bots INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_bots IN (0, 1)),
  can_kick INTEGER NOT NULL DEFAULT 0 CHECK (can_kick IN (0, 1)),
  color TEXT NOT NULL DEFAULT '#6366F1',
  can_manage_space INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_space IN (0, 1)),
  can_manage_roles INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_roles IN (0, 1)),
  can_manage_channels INTEGER NOT NULL DEFAULT 0 CHECK (can_manage_channels IN (0, 1)),
  can_kick_members INTEGER NOT NULL DEFAULT 0 CHECK (can_kick_members IN (0, 1)),
  can_ban_members INTEGER NOT NULL DEFAULT 0 CHECK (can_ban_members IN (0, 1)),
  can_mute_members INTEGER NOT NULL DEFAULT 0 CHECK (can_mute_members IN (0, 1)),
  can_dispatch_emergency_ping INTEGER NOT NULL DEFAULT 0 CHECK (can_dispatch_emergency_ping IN (0, 1)),
  mute_duration_seconds INTEGER,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(space_id, name),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS space_members (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role_id TEXT,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  xp_balance INTEGER NOT NULL DEFAULT 0,
  local_bandwidth_quota_mb INTEGER NOT NULL DEFAULT 1024,
  local_storage_quota_mb INTEGER NOT NULL DEFAULT 2048,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  UNIQUE(space_id, user_id),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS channel_groups (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(space_id, name),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  group_id TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text', 'voice', 'video')),
  topic TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(space_id, name),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES channel_groups(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS channel_allowed_roles (
  channel_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (channel_id, role_id),
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channel_groups (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(space_id, name),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS space_screening_questions (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  step_order INTEGER NOT NULL CHECK (step_order >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(space_id, step_order),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS space_screening_options (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  option_text TEXT NOT NULL,
  assigned_role_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (question_id) REFERENCES space_screening_questions(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_role_id) REFERENCES roles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS space_screening_answers (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(space_id, user_id, question_id),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES space_screening_questions(id) ON DELETE CASCADE,
  FOREIGN KEY (option_id) REFERENCES space_screening_options(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS space_invites (
  token TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  expires_at TEXT,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  body TEXT,
  attachment_url TEXT,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channel_messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  body TEXT,
  attachment_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS space_events (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('lab', 'sports', 'competition', 'celebration', 'custom')),
  is_virtual INTEGER NOT NULL DEFAULT 0 CHECK (is_virtual IN (0, 1)),
  location TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_tasks (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  assignee_user_id TEXT,
  assignee_role_id TEXT,
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'in_progress', 'submitted', 'approved', 'rejected', 'blocked')),
  proof_required INTEGER NOT NULL DEFAULT 1 CHECK (proof_required IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((assignee_user_id IS NOT NULL) <> (assignee_role_id IS NOT NULL)),
  FOREIGN KEY (event_id) REFERENCES space_events(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (assignee_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (assignee_role_id) REFERENCES roles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS file_attachments (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  event_id TEXT,
  uploader_id TEXT NOT NULL,
  original_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  checksum_sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES event_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES space_events(id) ON DELETE CASCADE,
  FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pings (
  id TEXT PRIMARY KEY,
  space_id TEXT,
  target_user_id TEXT,
  created_by TEXT NOT NULL,
  ping_level INTEGER NOT NULL CHECK (ping_level BETWEEN 0 AND 3),
  category TEXT NOT NULL CHECK (category IN ('task', 'event', 'system', 'bot', 'manual')),
  title TEXT NOT NULL,
  message TEXT,
  payload_json TEXT,
  is_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (is_acknowledged IN (0, 1)),
  acknowledged_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS space_bots (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  bot_name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  permissions_json TEXT NOT NULL,
  webhook_url TEXT NOT NULL,
  api_token_hash TEXT,
  verification_token TEXT,
  is_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0, 1)),
  verified_by TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(space_id, bot_name),
  FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS task_proofs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  submitted_by TEXT NOT NULL,
  text_note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES event_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_roles_space_priority ON roles(space_id, priority_level);
CREATE INDEX IF NOT EXISTS idx_space_members_space_user ON space_members(space_id, user_id);
CREATE INDEX IF NOT EXISTS idx_channels_space_group ON channels(space_id, group_id);
CREATE INDEX IF NOT EXISTS idx_events_space_time ON space_events(space_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_tasks_event_status ON event_tasks(event_id, status);
CREATE INDEX IF NOT EXISTS idx_task_proofs_task ON task_proofs(task_id, status);
CREATE INDEX IF NOT EXISTS idx_pings_target_created ON pings(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_space_bots_verification ON space_bots(verification_token, is_verified);
CREATE INDEX IF NOT EXISTS idx_screening_questions_space ON space_screening_questions(space_id, step_order);
CREATE INDEX IF NOT EXISTS idx_screening_options_question ON space_screening_options(question_id);
CREATE INDEX IF NOT EXISTS idx_channel_allowed_roles_role ON channel_allowed_roles(role_id, channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_groups_space_order ON channel_groups(space_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_direct_messages_pair ON direct_messages(sender_id, receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_messages_history ON channel_messages(channel_id, created_at ASC);

CREATE VIEW IF NOT EXISTS task_assignments AS
SELECT
  t.id AS task_id,
  t.event_id,
  t.title,
  t.status,
  t.assignee_user_id,
  t.assignee_role_id,
  u.username AS assignee_username,
  r.name AS assignee_role_name
FROM event_tasks t
LEFT JOIN users u ON u.id = t.assignee_user_id
LEFT JOIN roles r ON r.id = t.assignee_role_id;
