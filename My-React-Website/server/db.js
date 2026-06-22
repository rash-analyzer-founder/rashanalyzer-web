const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const DATA_DIR = path.join(__dirname, 'data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const dbPath = path.join(DATA_DIR, 'auth.db')
const db = new Database(dbPath)

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    displayName TEXT NOT NULL,
    publicSigningKeyJwk TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    refreshToken TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    jwtId TEXT NOT NULL,
    expiresAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    text TEXT,
    audioUrl TEXT,
    timestamp INTEGER NOT NULL,
    channelId TEXT,
    spaceId TEXT
  );
  CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    ownerId TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (ownerId) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS space_members (
    spaceId TEXT NOT NULL,
    userId TEXT NOT NULL,
    role TEXT DEFAULT 'member',
    joinedAt INTEGER NOT NULL,
    PRIMARY KEY (spaceId, userId),
    FOREIGN KEY (spaceId) REFERENCES spaces(id),
    FOREIGN KEY (userId) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS space_channels (
    id TEXT PRIMARY KEY,
    spaceId TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'subchannel',
    createdAt INTEGER NOT NULL,
    FOREIGN KEY (spaceId) REFERENCES spaces(id)
  );
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    uploaderId TEXT NOT NULL,
    fileName TEXT NOT NULL,
    fileUrl TEXT NOT NULL,
    fileType TEXT,
    fileSize INTEGER,
    spaceId TEXT,
    channelId TEXT,
    createdAt INTEGER NOT NULL,
    FOREIGN KEY (uploaderId) REFERENCES users(id),
    FOREIGN KEY (spaceId) REFERENCES spaces(id),
    FOREIGN KEY (channelId) REFERENCES space_channels(id)
  );
  CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    channelId TEXT NOT NULL,
    title TEXT NOT NULL,
    createdBy TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    FOREIGN KEY (channelId) REFERENCES space_channels(id),
    FOREIGN KEY (createdBy) REFERENCES users(id)
  );
`)

const getUserByUsername = (username) => {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    publicSigningKeyJwk: JSON.parse(row.publicSigningKeyJwk),
  }
}

const createUser = (user) => {
  const stmt = db.prepare('INSERT INTO users (id, username, displayName, publicSigningKeyJwk) VALUES (?, ?, ?, ?)')
  return stmt.run(user.id, user.username, user.displayName, JSON.stringify(user.publicSigningKeyJwk))
}

const saveSession = (session) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO sessions (refreshToken, userId, jwtId, expiresAt) VALUES (?, ?, ?, ?)')
  return stmt.run(session.refreshToken, session.userId, session.jwtId, session.expiresAt)
}

const getSession = (refreshToken) => {
  return db.prepare('SELECT * FROM sessions WHERE refreshToken = ?').get(refreshToken)
}

const deleteSessionByJwtId = (jwtId) => {
  const stmt = db.prepare('DELETE FROM sessions WHERE jwtId = ?')
  return stmt.run(jwtId)
}

const deleteSessionByToken = (refreshToken) => {
  const stmt = db.prepare('DELETE FROM sessions WHERE refreshToken = ?')
  return stmt.run(refreshToken)
}

const getUserById = (id) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    publicSigningKeyJwk: JSON.parse(row.publicSigningKeyJwk),
  }
}

const saveMessage = (message) => {
  const stmt = db.prepare('INSERT INTO messages (id, uid, name, email, text, audioUrl, timestamp, channelId, spaceId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  return stmt.run(message.id, message.uid, message.name, message.email, message.text || null, message.audioUrl || null, message.timestamp, message.channelId || null, message.spaceId || null)
}

const getMessages = () => {
  return db.prepare('SELECT * FROM messages ORDER BY timestamp ASC').all()
}

const createSpace = (space) => {
  const stmt = db.prepare('INSERT INTO spaces (id, name, description, ownerId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)')
  return stmt.run(space.id, space.name, space.description || null, space.ownerId, space.createdAt, space.updatedAt)
}

const getSpaceById = (spaceId) => {
  const row = db.prepare('SELECT * FROM spaces WHERE id = ?').get(spaceId)
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.ownerId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

const getSpacesByUserId = (userId) => {
  return db.prepare('SELECT s.* FROM spaces s INNER JOIN space_members sm ON s.id = sm.spaceId WHERE sm.userId = ?').all(userId)
}

const addSpaceMember = (spaceId, userId, role = 'member') => {
  const stmt = db.prepare('INSERT OR REPLACE INTO space_members (spaceId, userId, role, joinedAt) VALUES (?, ?, ?, ?)')
  return stmt.run(spaceId, userId, role, Date.now())
}

const removeSpaceMember = (spaceId, userId) => {
  const stmt = db.prepare('DELETE FROM space_members WHERE spaceId = ? AND userId = ?')
  return stmt.run(spaceId, userId)
}

const getSpaceMembers = (spaceId) => {
  return db.prepare('SELECT sm.*, u.username, u.displayName FROM space_members sm INNER JOIN users u ON sm.userId = u.id WHERE sm.spaceId = ?').all(spaceId)
}

const createSpaceChannel = (channel) => {
  const stmt = db.prepare('INSERT INTO space_channels (id, spaceId, name, type, createdAt) VALUES (?, ?, ?, ?, ?)')
  return stmt.run(channel.id, channel.spaceId, channel.name, channel.type || 'subchannel', channel.createdAt)
}

const getSpaceChannels = (spaceId) => {
  return db.prepare('SELECT * FROM space_channels WHERE spaceId = ? ORDER BY createdAt ASC').all(spaceId)
}

const saveFile = (file) => {
  const stmt = db.prepare('INSERT INTO files (id, uploaderId, fileName, fileUrl, fileType, fileSize, spaceId, channelId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  return stmt.run(file.id, file.uploaderId, file.fileName, file.fileUrl, file.fileType || null, file.fileSize || null, file.spaceId || null, file.channelId || null, file.createdAt)
}

const getFilesByChannel = (channelId) => {
  return db.prepare('SELECT * FROM files WHERE channelId = ? ORDER BY createdAt DESC').all(channelId)
}

const getFilesBySpace = (spaceId) => {
  return db.prepare('SELECT * FROM files WHERE spaceId = ? ORDER BY createdAt DESC').all(spaceId)
}

module.exports = {
  db,
  getUserByUsername,
  getUserById,
  createUser,
  saveSession,
  getSession,
  deleteSessionByJwtId,
  deleteSessionByToken,
  saveMessage,
  getMessages,
  createSpace,
  getSpaceById,
  getSpacesByUserId,
  addSpaceMember,
  removeSpaceMember,
  getSpaceMembers,
  createSpaceChannel,
  getSpaceChannels,
  saveFile,
  getFilesByChannel,
  getFilesBySpace,
}
