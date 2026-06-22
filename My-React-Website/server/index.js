require('dotenv').config()
const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { v4: uuidv4 } = require('uuid')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const https = require('https')
const { importJWK, exportSPKI } = require('jose')
const jwt = require('jsonwebtoken')
const {
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
} = require('./db')

const PORT = process.env.PORT || 4000
const ACCESS_TOKEN_EXPIRES = parseInt(process.env.ACCESS_TOKEN_EXPIRES_SECONDS || '900', 10) // seconds
const REFRESH_TOKEN_EXPIRES = parseInt(process.env.REFRESH_TOKEN_EXPIRES_SECONDS || '604800', 10) // seconds
const HTTPS_KEY_PATH = process.env.HTTPS_KEY_PATH || null
const HTTPS_CERT_PATH = process.env.HTTPS_CERT_PATH || null

let serverSigningKeyPem = process.env.JWT_PRIVATE_KEY_PEM || null
if (!serverSigningKeyPem && process.env.JWT_PRIVATE_KEY_PATH) {
  serverSigningKeyPem = fs.readFileSync(path.resolve(process.env.JWT_PRIVATE_KEY_PATH), 'utf8')
}
if (!serverSigningKeyPem) {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  serverSigningKeyPem = privateKey.export({ type: 'pkcs1', format: 'pem' })
  console.log('Generated ephemeral server signing key (dev only)')
}

const app = express()
app.use(cors({ origin: true, credentials: true }))
app.use(express.json())
app.use(cookieParser())

function nowPlusSeconds(s) {
  return Date.now() + s * 1000
}

async function publicJwkToPem(jwk) {
  if (!jwk || jwk.kty !== 'RSA') throw new Error('Only RSA public keys supported in this demo')
  const key = await importJWK(jwk, 'PS256')
  const spki = await exportSPKI(key)
  return spki
}

function verifyRsaPssSignature(pemPublicKey, payloadBuffer, signatureBuffer) {
  const verify = crypto.createVerify('sha256')
  verify.update(payloadBuffer)
  verify.end()
  return verify.verify(
    {
      key: pemPublicKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    },
    signatureBuffer
  )
}

app.post('/api/v1/register', async (req, res) => {
  try {
    const { username, displayName, publicSigningKeyJwk } = req.body
    if (!username || !publicSigningKeyJwk) return res.status(400).json({ error: 'username and publicSigningKeyJwk required' })
    const uname = String(username).toLowerCase()
    if (getUserByUsername(uname)) return res.status(409).json({ error: 'username exists' })
    if (publicSigningKeyJwk.kty !== 'RSA') return res.status(400).json({ error: 'Only RSA keys supported (demo)' })
    const id = uuidv4()
    createUser({ id, username: uname, displayName: displayName || uname, publicSigningKeyJwk })
    return res.status(201).json({ userId: id })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'server error' })
  }
})

app.post('/api/v1/challenge', (req, res) => {
  const { username } = req.body
  if (!username) return res.status(400).json({ error: 'username required' })
  const uname = String(username).toLowerCase()
  const user = getUserByUsername(uname)
  if (!user) return res.status(404).json({ error: 'user not found' })
  const nonce = crypto.randomBytes(32).toString('base64')
  const challengeId = uuidv4()
  const expiresAt = nowPlusSeconds(300)
  const challenge = { username: uname, nonce, expiresAt, attempts: 0 }
  // store short-lived challenges in memory
  if (!app.locals.challenges) app.locals.challenges = new Map()
  app.locals.challenges.set(challengeId, challenge)
  return res.json({ challengeId, nonce, expiresAt: new Date(expiresAt).toISOString() })
})

app.post('/api/v1/verify', async (req, res) => {
  try {
    const { username, challengeId, signature, signedPayload } = req.body
    if (!username || !challengeId || !signature || !signedPayload) return res.status(400).json({ error: 'missing fields' })
    const uname = String(username).toLowerCase()
    const user = getUserByUsername(uname)
    if (!user) return res.status(404).json({ error: 'user not found' })
    const challenge = app.locals.challenges?.get(challengeId)
    if (!challenge || challenge.username !== uname) return res.status(410).json({ error: 'challenge not found or expired' })
    if (Date.now() > challenge.expiresAt) {
      app.locals.challenges.delete(challengeId)
      return res.status(410).json({ error: 'challenge expired' })
    }

    const pem = await publicJwkToPem(user.publicSigningKeyJwk)
    const payloadBuffer = Buffer.from(signedPayload, 'base64')
    const signatureBuffer = Buffer.from(signature, 'base64')
    const ok = verifyRsaPssSignature(pem, payloadBuffer, signatureBuffer)
    if (!ok) {
      challenge.attempts += 1
      if (challenge.attempts > 5) app.locals.challenges.delete(challengeId)
      return res.status(401).json({ error: 'invalid signature' })
    }

    let parsed = null
    try {
      parsed = JSON.parse(Buffer.from(payloadBuffer).toString('utf8'))
    } catch (err) {
      parsed = null
    }
    if (!parsed || parsed.challengeId !== challengeId || parsed.nonce !== challenge.nonce || parsed.username !== uname) {
      return res.status(400).json({ error: 'signed payload mismatch' })
    }

    const jwtId = uuidv4()
    const accessToken = jwt.sign(
      { sub: user.id, username: user.username, displayName: user.displayName, auth_method: 'key-signature' },
      serverSigningKeyPem,
      { algorithm: 'PS256', expiresIn: ACCESS_TOKEN_EXPIRES, jwtid: jwtId }
    )

    const refreshToken = uuidv4()
    const refreshExpiresAt = nowPlusSeconds(REFRESH_TOKEN_EXPIRES)
    saveSession({ refreshToken, userId: user.id, jwtId, expiresAt: refreshExpiresAt })
    app.locals.challenges.delete(challengeId)

    res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: false, sameSite: 'lax', maxAge: REFRESH_TOKEN_EXPIRES * 1000 })
    return res.json({ accessToken, expiresIn: ACCESS_TOKEN_EXPIRES })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'server error' })
  }
})

app.post('/api/v1/refresh', (req, res) => {
  const refreshToken = req.cookies.refreshToken
  if (!refreshToken) return res.status(401).json({ error: 'no refresh token' })
  const session = getSession(refreshToken)
  if (!session || Date.now() > session.expiresAt) return res.status(401).json({ error: 'invalid refresh' })
  const userEntry = getUserById(session.userId)
  if (!userEntry) return res.status(401).json({ error: 'user not found' })
  const jwtId = uuidv4()
  const accessToken = jwt.sign(
    { sub: userEntry.id, username: userEntry.username, displayName: userEntry.displayName },
    serverSigningKeyPem,
    { algorithm: 'PS256', expiresIn: ACCESS_TOKEN_EXPIRES, jwtid: jwtId }
  )
  return res.json({ accessToken, expiresIn: ACCESS_TOKEN_EXPIRES })
})

app.post('/api/v1/message', (req, res) => {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing authorization' })
  const token = auth.slice(7)
  try {
    const payload = jwt.verify(token, serverSigningKeyPem, { algorithms: ['PS256'] })
    const { text, uid, name, email, audioUrl } = req.body
    if (!text && !audioUrl) return res.status(400).json({ error: 'message text or audioUrl required' })
    const id = uuidv4()
    const timestamp = Date.now()
    saveMessage({ id, uid, name, email, text, audioUrl, timestamp })
    return res.status(201).json({ id, timestamp: new Date(timestamp).toISOString(), sender: payload.username })
  } catch (err) {
    return res.status(401).json({ error: 'invalid access token' })
  }
})

app.get('/api/v1/messages', (req, res) => {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing authorization' })
  const token = auth.slice(7)
  try {
    jwt.verify(token, serverSigningKeyPem, { algorithms: ['PS256'] })
    const messages = getMessages()
    return res.json(messages.map((message) => ({
      ...message,
      timestamp: new Date(message.timestamp).toISOString(),
    })))
  } catch (err) {
    return res.status(401).json({ error: 'invalid access token' })
  }
})

// Space management endpoints
app.post('/api/v1/space', (req, res) => {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing authorization' })
  const token = auth.slice(7)
  try {
    const payload = jwt.verify(token, serverSigningKeyPem, { algorithms: ['PS256'] })
    const { name, description } = req.body
    if (!name) return res.status(400).json({ error: 'space name required' })
    
    const spaceId = uuidv4()
    const now = Date.now()
    createSpace({ id: spaceId, name, description, ownerId: payload.sub, createdAt: now, updatedAt: now })
    
    // Add creator as space owner
    addSpaceMember(spaceId, payload.sub, 'owner')
    
    // Create default General channel
    const generalChannelId = uuidv4()
    createSpaceChannel({ id: generalChannelId, spaceId, name: 'General', type: 'subchannel', createdAt: now })
    
    return res.status(201).json({ id: spaceId, name, description, ownerId: payload.sub, createdAt: now, updatedAt: now })
  } catch (err) {
    console.error(err)
    return res.status(401).json({ error: 'invalid access token' })
  }
})

app.get('/api/v1/spaces', (req, res) => {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing authorization' })
  const token = auth.slice(7)
  try {
    const payload = jwt.verify(token, serverSigningKeyPem, { algorithms: ['PS256'] })
    const spaces = getSpacesByUserId(payload.sub)
    return res.json(spaces.map((s) => ({
      ...s,
      createdAt: new Date(s.createdAt).toISOString(),
      updatedAt: new Date(s.updatedAt).toISOString(),
    })))
  } catch (err) {
    return res.status(401).json({ error: 'invalid access token' })
  }
})

app.get('/api/v1/space/:spaceId', (req, res) => {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing authorization' })
  const token = auth.slice(7)
  try {
    jwt.verify(token, serverSigningKeyPem, { algorithms: ['PS256'] })
    const space = getSpaceById(req.params.spaceId)
    if (!space) return res.status(404).json({ error: 'space not found' })
    const channels = getSpaceChannels(req.params.spaceId)
    const members = getSpaceMembers(req.params.spaceId)
    return res.json({
      ...space,
      createdAt: new Date(space.createdAt).toISOString(),
      updatedAt: new Date(space.updatedAt).toISOString(),
      channels: channels.map((c) => ({ ...c, createdAt: new Date(c.createdAt).toISOString() })),
      members: members.map((m) => ({ userId: m.userId, username: m.username, displayName: m.displayName, role: m.role, joinedAt: new Date(m.joinedAt).toISOString() })),
    })
  } catch (err) {
    return res.status(401).json({ error: 'invalid access token' })
  }
})

app.post('/api/v1/space/:spaceId/members', (req, res) => {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing authorization' })
  const token = auth.slice(7)
  try {
    const payload = jwt.verify(token, serverSigningKeyPem, { algorithms: ['PS256'] })
    const { userId, role } = req.body
    if (!userId) return res.status(400).json({ error: 'userId required' })
    
    const space = getSpaceById(req.params.spaceId)
    if (!space) return res.status(404).json({ error: 'space not found' })
    
    addSpaceMember(req.params.spaceId, userId, role || 'member')
    return res.status(201).json({ ok: true })
  } catch (err) {
    console.error(err)
    return res.status(401).json({ error: 'invalid access token' })
  }
})

app.delete('/api/v1/space/:spaceId/members/:userId', (req, res) => {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing authorization' })
  const token = auth.slice(7)
  try {
    const payload = jwt.verify(token, serverSigningKeyPem, { algorithms: ['PS256'] })
    const { spaceId, userId } = req.params
    
    const space = getSpaceById(spaceId)
    if (!space) return res.status(404).json({ error: 'space not found' })
    
    // Only allow user to remove themselves or space owner to remove anyone
    if (userId !== payload.sub && space.ownerId !== payload.sub) {
      return res.status(403).json({ error: 'forbidden' })
    }
    
    removeSpaceMember(spaceId, userId)
    return res.json({ ok: true })
  } catch (err) {
    console.error(err)
    return res.status(401).json({ error: 'invalid access token' })
  }
})

app.post('/api/v1/space/:spaceId/channels', (req, res) => {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing authorization' })
  const token = auth.slice(7)
  try {
    jwt.verify(token, serverSigningKeyPem, { algorithms: ['PS256'] })
    const { name } = req.body
    if (!name) return res.status(400).json({ error: 'channel name required' })
    
    const space = getSpaceById(req.params.spaceId)
    if (!space) return res.status(404).json({ error: 'space not found' })
    
    const channelId = uuidv4()
    const now = Date.now()
    createSpaceChannel({ id: channelId, spaceId: req.params.spaceId, name, type: 'subchannel', createdAt: now })
    
    return res.status(201).json({ id: channelId, spaceId: req.params.spaceId, name, type: 'subchannel', createdAt: new Date(now).toISOString() })
  } catch (err) {
    console.error(err)
    return res.status(401).json({ error: 'invalid access token' })
  }
})

app.post('/api/v1/revoke', (req, res) => {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'unauthorized' })
  const token = auth.slice(7)
  try {
    const payload = jwt.verify(token, serverSigningKeyPem, { algorithms: ['PS256'] })
    const { username } = payload
    const { username: targetUsername, target, id } = req.body
    if (!targetUsername || targetUsername !== username) return res.status(403).json({ error: 'forbidden' })
    if (target === 'session') {
      deleteSessionByJwtId(id)
      return res.json({ ok: true })
    }
    if (target === 'key') {
      const userEntry = getUserByUsername(username)
      if (userEntry) {
        // For demo, revoke by clearing the stored public key
        const stmt = require('./db').db.prepare('UPDATE users SET publicSigningKeyJwk = ? WHERE username = ?')
        stmt.run(JSON.stringify(null), username)
      }
      return res.json({ ok: true })
    }
    return res.status(400).json({ error: 'bad request' })
  } catch (err) {
    return res.status(401).json({ error: 'invalid token' })
  }
})

app.get('/api/v1/user/:username/pubkey', (req, res) => {
  const uname = String(req.params.username).toLowerCase()
  const user = getUserByUsername(uname)
  if (!user) return res.status(404).json({ error: 'not found' })
  return res.json({ publicSigningKeyJwk: user.publicSigningKeyJwk, status: 'active' })
})

if (HTTPS_KEY_PATH && HTTPS_CERT_PATH) {
  const httpsOptions = {
    key: fs.readFileSync(path.resolve(HTTPS_KEY_PATH)),
    cert: fs.readFileSync(path.resolve(HTTPS_CERT_PATH)),
  }
  https.createServer(httpsOptions, app).listen(PORT, () => {
    console.log(`Auth server listening on https://localhost:${PORT}`)
  })
} else {
  app.listen(PORT, () => {
    console.log(`Auth server listening on http://localhost:${PORT}`)
  })
}

