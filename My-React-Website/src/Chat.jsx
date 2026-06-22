import { useEffect, useState, useRef } from "react"
import Message from "./message.jsx"
import Textbox from "./textbox.jsx"
import "./chat.css"
import chatIcon from "../assets/chat.png"
import { auth, collection, addDoc, db, logout, onAuthStateChanged, serverTimestamp, signInWithGoogle, doc, setDoc, deleteDoc, onSnapshot, storage, storageRef, uploadBytes, getDownloadURL } from "./firebase.js"

const OFFLINE_QUEUE_KEY = "chat-offline-queue"
const LOCAL_ACCOUNTS_KEY = "chat-local-accounts"
const LOCAL_SESSION_KEY = "chat-local-session"
const CHANNELS_STORAGE_KEY = "chat-channels"
const CHANNEL_SELECTION_KEY = "chat-current-channel"
const EXPLORE_SPACES_KEY = "chat-explore-spaces"

const DEFAULT_EXPLORE_SPACES = [
  {
    id: "space:creative-hub",
    name: "Creative Hub",
    description: "Open space for ideas, projects, and co-working.",
  },
  {
    id: "space:game-lounge",
    name: "Game Lounge",
    description: "Casual chat, events, and social links.",
  },
  {
    id: "space:security-lab",
    name: "Security Lab",
    description: "Discuss encryption, privacy, and secure collaboration.",
  },
]

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const hexFromBuffer = (buffer) => {
  const bytes = new Uint8Array(buffer)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")
}

const bufferFromHex = (hex) => {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)))
  return bytes.buffer
}

const normalizeUsername = (username) => username.trim().toLowerCase()
const DB_NAME = "chat-auth-db"
const DB_ACCOUNT_STORE = "accounts"

const openAccountDb = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DB_ACCOUNT_STORE)) {
        db.createObjectStore(DB_ACCOUNT_STORE, { keyPath: "username" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

const getAccount = async (username) => {
  const db = await openAccountDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_ACCOUNT_STORE, "readonly")
    const store = tx.objectStore(DB_ACCOUNT_STORE)
    const request = store.get(username)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

const saveAccount = async (account) => {
  const db = await openAccountDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_ACCOUNT_STORE, "readwrite")
    const store = tx.objectStore(DB_ACCOUNT_STORE)
    const request = store.put(account)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

const saveLocalSession = (session) => {
  try {
    sessionStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session))
  } catch (error) {
    console.warn("Failed to save session:", error)
  }
}

const clearLocalSession = () => {
  sessionStorage.removeItem(LOCAL_SESSION_KEY)
}

const loadLocalSession = () => {
  try {
    const saved = sessionStorage.getItem(LOCAL_SESSION_KEY)
    return saved ? JSON.parse(saved) : null
  } catch (error) {
    console.warn("Failed to load session:", error)
    return null
  }
}

const deriveKeyAndHash = async (password, saltHex) => {
  const salt = bufferFromHex(saltHex)
  const baseKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  )
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 150000,
      hash: "SHA-256",
    },
    baseKey,
    256
  )
  const hashHex = hexFromBuffer(derivedBits)
  const key = await crypto.subtle.importKey(
    "raw",
    derivedBits,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  )
  return { key, hashHex }
}

const encryptProfileData = async (key, profile) => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    textEncoder.encode(JSON.stringify(profile))
  )
  return {
    iv: hexFromBuffer(iv),
    ciphertext: hexFromBuffer(ciphertext),
  }
}

const decryptProfileData = async (key, ivHex, ciphertextHex) => {
  const iv = new Uint8Array(bufferFromHex(ivHex))
  const ciphertext = bufferFromHex(ciphertextHex)
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext)
  return JSON.parse(textDecoder.decode(decrypted))
}

const generateRsaKeyPair = async () => {
  return crypto.subtle.generateKey(
    {
      name: "RSA-PSS",
      modulusLength: 4096,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  )
}

const exportKeyJwk = async (key) => {
  return crypto.subtle.exportKey("jwk", key)
}

const importPrivateRsaKey = async (jwk) => {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "RSA-PSS",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  )
}

const base64FromBuffer = (buffer) => {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

const bufferFromBase64 = (b64) => {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

const importAesKeyFromRawBase64 = async (b64) => {
  const buf = bufferFromBase64(b64)
  return crypto.subtle.importKey("raw", buf, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
}

const encryptMessagePayload = async (aesKey, payloadObj) => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = textEncoder.encode(JSON.stringify(payloadObj))
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plaintext)
  return {
    encrypted: true,
    encVersion: 1,
    iv: hexFromBuffer(iv),
    ciphertext: hexFromBuffer(ciphertext),
  }
}

const signPayloadWithPrivateKey = async (privateKey, payloadObj) => {
  const payloadJson = JSON.stringify(payloadObj)
  const payloadBytes = textEncoder.encode(payloadJson)
  const signature = await crypto.subtle.sign({ name: "RSA-PSS", saltLength: 32 }, privateKey, payloadBytes)
  return {
    signatureBase64: base64FromBuffer(signature),
    signedPayloadBase64: base64FromBuffer(payloadBytes),
  }
}

const SERVER_BASE = typeof window !== 'undefined' && window.location.hostname ? `http://${window.location.hostname}:4000` : 'http://localhost:4000'

const registerWithServer = async (username, displayName, publicSigningKeyJwk) => {
  try {
    const resp = await fetch(`${SERVER_BASE}/api/v1/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName, publicSigningKeyJwk }),
    })
    return resp.status === 201
  } catch (err) {
    console.warn('Register with server failed', err)
    return false
  }
}

const requestChallenge = async (username) => {
  const resp = await fetch(`${SERVER_BASE}/api/v1/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  })
  if (!resp.ok) throw new Error('challenge request failed')
  return resp.json()
}

const verifyWithServer = async (username, challengeId, signatureBase64, signedPayloadBase64) => {
  const resp = await fetch(`${SERVER_BASE}/api/v1/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, challengeId, signature: signatureBase64, signedPayload: signedPayloadBase64 }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || 'verify failed')
  }
  return resp.json()
}

const sendMessageViaServer = async (messagePayload, token) => {
  if (!token) throw new Error('Missing access token')
  const resp = await fetch(`${SERVER_BASE}/api/v1/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(messagePayload),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || 'server message send failed')
  }
  return resp.json()
}

const refreshServerAuth = async () => {
  try {
    const resp = await fetch(`${SERVER_BASE}/api/v1/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!resp.ok) return null
    return resp.json()
  } catch (error) {
    console.warn('Failed to refresh server auth:', error)
    return null
  }
}

const supportsPasswordCredentials = () => {
  return typeof navigator !== "undefined" && "credentials" in navigator && typeof PasswordCredential !== "undefined"
}

const getStoredPasswordCredential = async () => {
  if (!supportsPasswordCredentials()) return null
  try {
    return await navigator.credentials.get({ password: true, mediation: "silent" })
  } catch (error) {
    console.warn("Password credential retrieval failed:", error)
    return null
  }
}

const storePasswordCredential = async (username, password) => {
  if (!supportsPasswordCredentials()) return false
  try {
    const credential = new PasswordCredential({ id: username, password })
    await navigator.credentials.store(credential)
    return true
  } catch (error) {
    console.warn("Saving password credential failed:", error)
    return false
  }
}

const getInitials = (value) => {
  if (!value) return "?"
  const parts = value.trim().split(" ").filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function Chat() {
  const [user, setUser] = useState(null)
  const [accessToken, setAccessToken] = useState(null)
  const [serverAuthStatus, setServerAuthStatus] = useState(null)
  const [serverAuthMessage, setServerAuthMessage] = useState(null)
  const [showAccessToken, setShowAccessToken] = useState(false)
  const [authError, setAuthError] = useState(null)
  const [typingUsers, setTypingUsers] = useState([])
  const [offlineQueue, setOfflineQueue] = useState([])
  const [showLocalAuth, setShowLocalAuth] = useState(false)
  const [localAuthMode, setLocalAuthMode] = useState("login")
  const [localForm, setLocalForm] = useState({ username: "", password: "", displayName: "", photoURL: "" })
  const [localAuthError, setLocalAuthError] = useState(null)
  const [localPrivateKey, setLocalPrivateKey] = useState(null)
  const [localMessageKey, setLocalMessageKey] = useState(null)
  const [channels, setChannels] = useState([{ id: "global", name: "Global Chat", type: "global", members: [] }])
  const [currentChannelId, setCurrentChannelId] = useState("global")
  const [exploreSpaces, setExploreSpaces] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_EXPLORE_SPACES
    try {
      const saved = localStorage.getItem(EXPLORE_SPACES_KEY)
      return saved ? JSON.parse(saved) : DEFAULT_EXPLORE_SPACES
    } catch (error) {
      console.warn("Failed to load explore spaces:", error)
      return DEFAULT_EXPLORE_SPACES
    }
  })
  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const [showCreator, setShowCreator] = useState(false)
  const [createMode, setCreateMode] = useState("dm")
  const [newDmTarget, setNewDmTarget] = useState("")
  const [newGroupName, setNewGroupName] = useState("")
  const [newGroupMembers, setNewGroupMembers] = useState("")
  const [newSubChannelName, setNewSubChannelName] = useState("")
  const [inviteInput, setInviteInput] = useState("")
  const [invitees, setInvitees] = useState([])
  const [channelError, setChannelError] = useState(null)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (authUser) => {
      if (authUser) {
        setUser({
          uid: authUser.uid,
          displayName: authUser.displayName || authUser.email,
          email: authUser.email,
          photoURL: authUser.photoURL,
          local: false,
        })
      } else {
        const savedSession = loadLocalSession()
        setUser(savedSession)
      }
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!user?.local || accessToken) return

    const refresh = async () => {
      const refreshed = await refreshServerAuth()
      if (refreshed?.accessToken) {
        setAccessToken(refreshed.accessToken)
        setServerAuthStatus('refreshed')
        setServerAuthMessage('Server access token refreshed.')
      } else {
        setServerAuthStatus('unverified')
        setServerAuthMessage('No server token available; using local chat fallback.')
      }
    }
    refresh()
  }, [user, accessToken])

  useEffect(() => {
    try {
      const savedQueue = localStorage.getItem(OFFLINE_QUEUE_KEY)
      if (savedQueue) {
        setOfflineQueue(JSON.parse(savedQueue))
      }
    } catch (error) {
      console.warn("Failed to load offline chat queue:", error)
    }

    const handleOnline = async () => {
      await flushOfflineQueue()
    }

    window.addEventListener("online", handleOnline)
    return () => window.removeEventListener("online", handleOnline)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(offlineQueue))
    } catch (error) {
      console.warn("Failed to persist offline chat queue:", error)
    }
  }, [offlineQueue])

  useEffect(() => {
    if (navigator.onLine && offlineQueue.length && user) {
      flushOfflineQueue()
    }
  }, [offlineQueue, user])

  useEffect(() => {
    try {
      localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(channels))
    } catch (error) {
      console.warn("Failed to persist chat channels:", error)
    }
  }, [channels])

  useEffect(() => {
    try {
      localStorage.setItem(CHANNEL_SELECTION_KEY, currentChannelId)
    } catch (error) {
      console.warn("Failed to persist current channel:", error)
    }
  }, [currentChannelId])

  useEffect(() => {
    try {
      localStorage.setItem(EXPLORE_SPACES_KEY, JSON.stringify(exploreSpaces))
    } catch (error) {
      console.warn("Failed to persist explore spaces:", error)
    }
  }, [exploreSpaces])

  useEffect(() => {
    const savedChannels = localStorage.getItem(CHANNELS_STORAGE_KEY)
    if (savedChannels) {
      try {
        const parsed = JSON.parse(savedChannels)
        if (Array.isArray(parsed) && parsed.length) {
          setChannels(parsed)
        }
      } catch (error) {
        console.warn("Failed to load saved channels:", error)
      }
    }

    const savedChannelId = localStorage.getItem(CHANNEL_SELECTION_KEY)
    if (savedChannelId) {
      setCurrentChannelId(savedChannelId)
    }

    const clickHandler = (event) => {
      if (!menuRef.current?.contains(event.target)) {
        setProfileMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", clickHandler)
    return () => document.removeEventListener("mousedown", clickHandler)
  }, [])

  const flushOfflineQueue = async () => {
    if (!offlineQueue.length || !user) return

    const remainingQueue = []
    for (const offlineMessage of offlineQueue) {
      try {
        const messagePayload = {
          text: offlineMessage.text,
          timestamp: serverTimestamp(),
          uid: offlineMessage.uid,
          name: offlineMessage.name,
          email: offlineMessage.email,
          offlineLocalTimestamp: offlineMessage.localTimestamp,
        }
        if (localMessageKey) {
          const encrypted = await encryptMessagePayload(localMessageKey, messagePayload)
          await addDoc(collection(db, "messages"), { ...encrypted, uid: messagePayload.uid, timestamp: serverTimestamp() })
        } else {
          await addDoc(collection(db, "messages"), messagePayload)
        }
      } catch (error) {
        console.warn("Failed to flush offline message, keeping in queue:", error)
        remainingQueue.push(offlineMessage)
      }
    }
    setOfflineQueue(remainingQueue)
  }

  const saveOfflineMessage = (messagePayload) => {
    setOfflineQueue((prevQueue) => [
      ...prevQueue,
      {
        ...messagePayload,
        localTimestamp: Date.now(),
        id: `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    ])
  }

  useEffect(() => {
    if (!user) return
    const typingRef = collection(db, "typing")
    const unsubscribe = onSnapshot(typingRef, (snapshot) => {
      const typing = snapshot.docs
        .map((doc) => doc.data().name)
        .filter((name) => name !== (user.displayName || user.email))
      setTypingUsers(typing)
    })
    return unsubscribe
  }, [user])

  const handleTyping = async (isTyping) => {
    if (!user) return
    const typingDoc = doc(db, "typing", user.uid)
    if (isTyping) {
      await setDoc(typingDoc, { name: user.displayName || user.email, timestamp: serverTimestamp() })
    } else {
      await deleteDoc(typingDoc)
    }
  }

  const handleLogin = async () => {
    try {
      setAuthError(null)
      await signInWithGoogle()
    } catch (error) {
      console.error("Google sign-in failed:", error)
      setAuthError(error.message || "Google sign-in failed")
    }
  }

  const handleLogout = async () => {
    setProfileMenuOpen(false)
    if (user?.local) {
      clearLocalSession()
      setUser(null)
      setLocalPrivateKey(null)
      setAccessToken(null)
      setServerAuthStatus(null)
      setServerAuthMessage(null)
      setShowAccessToken(false)
      return
    }

    try {
      await logout()
    } catch (error) {
      console.error("Sign out failed:", error)
    }
  }

  const handleLocalAuthChange = (field, value) => {
    setLocalForm((prev) => ({ ...prev, [field]: value }))
    setLocalAuthError(null)
  }

  const handleBrowserCredentialSignIn = async () => {
    const cred = await getStoredPasswordCredential()
    if (!cred || !cred.id || !cred.password) {
      setLocalAuthError("No saved browser credential available.")
      return
    }
    setLocalForm((prev) => ({ ...prev, username: cred.id, password: cred.password }))
    setLocalAuthMode("login")
    await handleLocalAuthSubmit()
  }

  const saveBrowserCredential = async (username, password) => {
    if (!supportsPasswordCredentials()) return
    await storePasswordCredential(username, password)
  }

  const getCurrentChannel = () => {
    return channels.find((channel) => channel.id === currentChannelId) || channels[0]
  }

  const getJoinedSpaceIds = () => {
    return channels.filter((channel) => channel.type === "space").map((space) => space.id)
  }

  const getSpaceSubchannels = (spaceId) => {
    return channels.filter((channel) => channel.parentId === spaceId)
  }

  const getSidebarChannels = () => {
    return channels.filter((channel) => ["global", "dm", "group"].includes(channel.type))
  }

  const addChannel = (channel) => {
    setChannels((prev) => {
      const existing = prev.find((item) => item.id === channel.id)
      if (existing) return prev
      return [...prev, channel]
    })
    setCurrentChannelId(channel.id)
  }

  const joinSpace = (space) => {
    const hasSpace = channels.some((channel) => channel.id === space.id)
    if (hasSpace) {
      const generalChannel = channels.find(
        (channel) => channel.spaceId === space.id && channel.type === "space-subchannel"
      )
      setCurrentChannelId(generalChannel?.id || space.id)
      return
    }

    const defaultSubchannelId = `${space.id}:general`
    addChannel({ id: space.id, name: space.name, type: "space", members: [], description: space.description })
    addChannel({
      id: defaultSubchannelId,
      name: "General",
      type: "space-subchannel",
      parentId: space.id,
      spaceId: space.id,
      members: [],
    })
    setCurrentChannelId(defaultSubchannelId)
  }

  const createSpaceSubchannel = () => {
    setChannelError(null)
    const current = getCurrentChannel()
    const parentSpaceId = current?.type === "space" ? current.id : current?.spaceId
    if (!parentSpaceId) {
      setChannelError("Select a space before creating subchannels.")
      return
    }
    const name = newSubChannelName.trim()
    if (!name) {
      setChannelError("Enter a sub-channel name.")
      return
    }
    const subchannelId = `${parentSpaceId}:${name.toLowerCase().replace(/\s+/g, "-")}:${Date.now()}`
    addChannel({
      id: subchannelId,
      name,
      type: "space-subchannel",
      parentId: parentSpaceId,
      spaceId: parentSpaceId,
      members: current.members || [],
    })
    setNewSubChannelName("")
  }

  const addInvitee = () => {
    const invite = inviteInput.trim()
    if (!invite) return
    const normalized = normalizeUsername(invite)
    if (invitees.includes(normalized)) return
    setInvitees((prev) => [...prev, normalized])
    setInviteInput("")
  }

  const removeInvitee = (invite) => {
    setInvitees((prev) => prev.filter((item) => item !== invite))
  }

  const createDmChannel = () => {
    setChannelError(null)
    if (!user) {
      setChannelError("Sign in to create DMs.")
      return
    }
    const target = invitees.length > 0 ? invitees[0] : normalizeUsername(newDmTarget)
    if (!target) {
      setChannelError("Enter a username or email for the DM.")
      return
    }
    if (target === normalizeUsername(user.email) || target === normalizeUsername(user.displayName)) {
      setChannelError("You cannot DM yourself.")
      return
    }
    const members = [normalizeUsername(user.email), target].sort()
    const channelId = `dm:${members.join("|")}`
    addChannel({ id: channelId, name: `DM with ${target}`, type: "dm", members })
    setNewDmTarget("")
    setInvitees([])
    setInviteInput("")
  }

  const createGroupChannel = () => {
    setChannelError(null)
    if (!user) {
      setChannelError("Sign in to create groups.")
      return
    }
    const name = newGroupName.trim()
    const members = newGroupMembers
      .split(",")
      .map((member) => normalizeUsername(member))
      .filter(Boolean)
    if (!name) {
      setChannelError("Enter a group name.")
      return
    }
    if (!members.length) {
      setChannelError("Add at least one group member.")
      return
    }
    const allMembers = Array.from(new Set([normalizeUsername(user.email), ...members])).sort()
    const safeName = name.toLowerCase().replace(/\s+/g, "-")
    const channelId = `group:${safeName}:${Date.now()}`
    addChannel({ id: channelId, name: `Group: ${name}`, type: "group", members: allMembers })
    setNewGroupName("")
    setNewGroupMembers("")
  }

  const createSpaceChannel = () => {
    setChannelError(null)
    if (!user) {
      setChannelError("Sign in to create spaces.")
      return
    }
    const name = newGroupName.trim()
    const members = invitees.map((invite) => normalizeUsername(invite))
    if (!name) {
      setChannelError("Enter a space name.")
      return
    }
    if (!members.length) {
      setChannelError("Invite at least one member to the space.")
      return
    }
    const allMembers = Array.from(new Set([normalizeUsername(user.email), ...members])).sort()
    const safeName = name.toLowerCase().replace(/\s+/g, "-")
    const spaceId = `space:${safeName}:${Date.now()}`
    const generalSubchannelId = `${spaceId}:general`
    addChannel({
      id: spaceId,
      name: `Space: ${name}`,
      type: "space",
      members: allMembers,
      description: `Space for ${name}`,
    })
    addChannel({
      id: generalSubchannelId,
      name: "General",
      type: "space-subchannel",
      parentId: spaceId,
      spaceId,
      members: allMembers,
    })
    setNewGroupName("")
    setInvitees([])
    setInviteInput("")
    setCurrentChannelId(generalSubchannelId)
    setExploreSpaces((prev) => [
      ...prev.filter((space) => space.id !== spaceId),
      { id: spaceId, name: `Space: ${name}`, description: `Private space created by ${user.displayName || user.email}` },
    ])
  }

  const handleLocalAuthSubmit = async () => {
    setLocalAuthError(null)
    const username = normalizeUsername(localForm.username)
    const password = localForm.password

    if (!username || !password) {
      setLocalAuthError("Username and password are required.")
      return
    }

    const account = await getAccount(username)
    if (localAuthMode === "login") {
      if (!account) {
        setLocalAuthError("User not found.")
        return
      }

      try {
        const { key, hashHex } = await deriveKeyAndHash(password, account.salt)
        if (hashHex !== account.passwordHash) {
          setLocalAuthError("Invalid password.")
          return
        }

        const profile = await decryptProfileData(key, account.profile.iv, account.profile.ciphertext)
        const privateJwk = await decryptProfileData(key, account.privateKey.iv, account.privateKey.ciphertext)
        const importedPrivateKey = await importPrivateRsaKey(privateJwk)
        // try to restore per-user message AES key (if present)
        if (account.messageKey) {
          try {
            const mkObj = await decryptProfileData(key, account.messageKey.iv, account.messageKey.ciphertext)
            if (mkObj?.k) {
              const aesKey = await importAesKeyFromRawBase64(mkObj.k)
              setLocalMessageKey(aesKey)
            }
          } catch (err) {
            console.warn('Failed to decrypt message key for account:', err)
          }
        }

        // perform server challenge->sign->verify flow
        let serverVerified = false
        try {
          const challenge = await requestChallenge(username)
          const payload = { challengeId: challenge.challengeId, nonce: challenge.nonce, username, ts: Date.now() }
          const { signatureBase64, signedPayloadBase64 } = await signPayloadWithPrivateKey(importedPrivateKey, payload)
          const verifyResult = await verifyWithServer(username, challenge.challengeId, signatureBase64, signedPayloadBase64)
          setAccessToken(verifyResult.accessToken)
          setServerAuthStatus('verified')
          setServerAuthMessage('Server authentication succeeded.')
          serverVerified = true
        } catch (err) {
          console.warn('Server verification failed, falling back to local session', err)
          setServerAuthStatus('unverified')
          setServerAuthMessage('Server verification failed; using local chat fallback.')
        }

        const localUser = {
          uid: `local-${username}`,
          username,
          displayName: profile.displayName || username,
          email: `${username}@local`,
          photoURL: profile.photoURL || "",
          local: true,
          publicKey: account.publicKey,
          serverVerified,
        }
        saveLocalSession(localUser)
        setLocalPrivateKey(importedPrivateKey)
        setUser(localUser)
        await saveBrowserCredential(username, password)
        setShowLocalAuth(false)
        setLocalForm({ username: "", password: "", displayName: "", photoURL: "" })
      } catch (error) {
        console.error("Local login failed:", error)
        setLocalAuthError("Could not decrypt account. Check your username and password.")
      }
      return
    }

    if (!localForm.displayName) {
      setLocalAuthError("Display name is required for account creation.")
      return
    }

    if (account) {
      setLocalAuthError("That username already exists.")
      return
    }

    try {
      const salt = crypto.getRandomValues(new Uint8Array(16))
      const saltHex = hexFromBuffer(salt)
      const { key, hashHex } = await deriveKeyAndHash(password, saltHex)
      const profileCipher = await encryptProfileData(key, {
        displayName: localForm.displayName,
        photoURL: localForm.photoURL,
      })

      const keyPair = await generateRsaKeyPair()
      const publicKeyJwk = await exportKeyJwk(keyPair.publicKey)
      const privateKeyJwk = await exportKeyJwk(keyPair.privateKey)
      const privateKeyCipher = await encryptProfileData(key, privateKeyJwk)

      // generate per-user AES key for message encryption and store it encrypted with the same password-derived key
      const messageKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])
      const messageKeyRaw = await crypto.subtle.exportKey("raw", messageKey)
      const messageKeyB64 = base64FromBuffer(messageKeyRaw)
      const messageKeyCipher = await encryptProfileData(key, { k: messageKeyB64 })

      await saveAccount({
        username,
        salt: saltHex,
        passwordHash: hashHex,
        profile: profileCipher,
        publicKey: publicKeyJwk,
        privateKey: privateKeyCipher,
        messageKey: messageKeyCipher,
      })

      const localUser = {
        uid: `local-${username}`,
        username,
        displayName: localForm.displayName,
        email: `${username}@local`,
        photoURL: localForm.photoURL || "",
        local: true,
        publicKey: publicKeyJwk,
      }
      saveLocalSession(localUser)
      setLocalPrivateKey(keyPair.privateKey)
      setLocalMessageKey(messageKey)
      setUser(localUser)
      await saveBrowserCredential(username, password)
      try {
        const ok = await registerWithServer(username, localForm.displayName, publicKeyJwk)
        if (ok) {
          setServerAuthStatus('registered')
          setServerAuthMessage('Server registration succeeded.')
        } else {
          setServerAuthStatus('unverified')
          setServerAuthMessage('Registered locally; server registration failed.')
        }
      } catch (err) {
        console.warn('Server registration error', err)
        setServerAuthStatus('unverified')
        setServerAuthMessage('Registered locally; server registration error.')
      }
      setShowLocalAuth(false)
      setLocalForm({ username: "", password: "", displayName: "", photoURL: "" })
    } catch (error) {
      console.error("Local registration failed:", error)
      setLocalAuthError("Unable to create your account. Please try again.")
    }
  }

  const handleSend = async (messageText) => {
    if (!messageText || !user) return

    const channel = getCurrentChannel()
    const spaceId = channel?.type === "space" ? channel.id : channel?.spaceId || null
    const messagePayload = {
      channelId: channel?.id || "global",
      channelType: channel?.type || "global",
      channelName: channel?.name || "Global Chat",
      spaceId,
      text: messageText,
      uid: user.uid,
      name: user.displayName || user.email,
      email: user.email,
    }

    try {
      if (accessToken) {
        await sendMessageViaServer(messagePayload, accessToken)
        console.log('Chat: sent message through auth server')
      } else {
        if (localMessageKey) {
          const encrypted = await encryptMessagePayload(localMessageKey, messagePayload)
          const docRef = await addDoc(collection(db, "messages"), { ...encrypted, uid: messagePayload.uid, timestamp: serverTimestamp() })
          console.log("Chat: saved encrypted message to Firestore", docRef.id)
        } else {
          const docRef = await addDoc(collection(db, "messages"), {
            ...messagePayload,
            timestamp: serverTimestamp(),
          })
          console.log("Chat: saved message to Firestore", docRef.id)
        }
      }
      handleTyping(false)
    } catch (error) {
      console.warn("Failed to send message online, saving offline:", error)
      saveOfflineMessage(messagePayload)
      handleTyping(false)
    }
  }

  const handleSendVoice = async (audioBlob) => {
    if (!audioBlob || !user) return false

    try {
      const fileName = `voiceMessages/${user.uid}_${Date.now()}.webm`
      const storageReference = storageRef(storage, fileName)
      await uploadBytes(storageReference, audioBlob, { contentType: audioBlob.type || "audio/webm" })
      const audioUrl = await getDownloadURL(storageReference)

      const current = getCurrentChannel()
      const spaceId = current?.type === "space" ? current.id : current?.spaceId || null
      const voicePayload = {
        channelId: current?.id || "global",
        channelType: current?.type || "global",
        channelName: current?.name || "Global Chat",
        spaceId,
        text: "",
        audioUrl,
        uid: user.uid,
        name: user.displayName || user.email,
        email: user.email,
      }

      if (localMessageKey) {
        const encrypted = await encryptMessagePayload(localMessageKey, voicePayload)
        await addDoc(collection(db, "messages"), { ...encrypted, uid: voicePayload.uid, timestamp: serverTimestamp() })
      } else {
        await addDoc(collection(db, "messages"), voicePayload)
      }
      handleTyping(false)
      return true
    } catch (error) {
      console.error("Failed to send voice message:", error)
      return false
    }
  }

  const currentChannel = getCurrentChannel()
  const currentSpace = currentChannel?.type === "space"
    ? currentChannel
    : currentChannel?.type === "space-subchannel"
      ? channels.find((channel) => channel.id === currentChannel.spaceId)
      : null

  return (
    <div className="chat-app">
      <header className="chat-header">
        <div className="chat-title">
          <img src={chatIcon} alt="Chat" height="50px" width="50px" />Chat
        </div>
        <div className="chat-actions">
          {user ? (
            <div className="profile-area" ref={menuRef}>
              <button className="profile-button" onClick={() => setProfileMenuOpen((prev) => !prev)}>
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || "Profile"} />
                ) : (
                  <span className="profile-initials">{getInitials(user.displayName)}</span>
                )}
              </button>
              {profileMenuOpen && (
                <div className="profile-menu">
                  <div className="profile-menu-user">
                    {user.photoURL ? (
                      <img src={user.photoURL} alt="Profile" />
                    ) : (
                      <div className="profile-avatar-fallback">{getInitials(user.displayName)}</div>
                    )}
                    <div>
                      <strong>{user.displayName}</strong>
                      <span>{user.local ? `@${user.username}` : user.email}</span>
                    </div>
                  </div>
                  <button className="profile-menu-signout" onClick={handleLogout}>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="auth-controls">
              <button className="auth-button" onClick={handleLogin}>
                Sign in with Google
              </button>
              <button
                className="auth-button auth-button-secondary"
                onClick={() => {
                  setShowLocalAuth(true)
                  setLocalAuthMode("login")
                  setLocalAuthError(null)
                }}
              >
                Local login / register
              </button>
            </div>
          )}
        </div>
      </header>

      {showLocalAuth && !user && (
        <div className="auth-panel">
          <div className="auth-toggle">
            <button
              type="button"
              className={localAuthMode === "login" ? "active" : ""}
              onClick={() => {
                setLocalAuthMode("login")
                setLocalAuthError(null)
              }}
            >
              Login
            </button>
            <button
              type="button"
              className={localAuthMode === "register" ? "active" : ""}
              onClick={() => {
                setLocalAuthMode("register")
                setLocalAuthError(null)
              }}
            >
              Register
            </button>
          </div>
          {localAuthError && <div className="auth-error">{localAuthError}</div>}
          <div className="auth-form">
            <div className="auth-field">
              <label htmlFor="local-username">Username</label>
              <input
                id="local-username"
                type="text"
                value={localForm.username}
                onChange={(event) => handleLocalAuthChange("username", event.target.value)}
                placeholder="username"
              />
            </div>
            {localAuthMode === "register" && (
              <>
                <div className="auth-field">
                  <label htmlFor="local-displayname">Display name</label>
                  <input
                    id="local-displayname"
                    type="text"
                    value={localForm.displayName}
                    onChange={(event) => handleLocalAuthChange("displayName", event.target.value)}
                    placeholder="Your visible name"
                  />
                </div>
                <div className="auth-field">
                  <label htmlFor="local-profilepic">Profile picture URL</label>
                  <input
                    id="local-profilepic"
                    type="url"
                    value={localForm.photoURL}
                    onChange={(event) => handleLocalAuthChange("photoURL", event.target.value)}
                    placeholder="https://example.com/avatar.jpg"
                  />
                </div>
              </>
            )}
            <div className="auth-field">
              <label htmlFor="local-password">Password</label>
              <input
                id="local-password"
                type="password"
                value={localForm.password}
                onChange={(event) => handleLocalAuthChange("password", event.target.value)}
                placeholder="secret password"
              />
            </div>
            <button className="auth-submit" type="button" onClick={handleLocalAuthSubmit}>
              {localAuthMode === "login" ? "Sign in" : "Create account"}
            </button>
            {supportsPasswordCredentials() && localAuthMode === "login" && (
              <button
                className="auth-submit auth-submit-secondary"
                type="button"
                onClick={handleBrowserCredentialSignIn}
              >
                Sign in with saved browser credential
              </button>
            )}
            {(serverAuthStatus || serverAuthMessage) && (
              <div className="server-auth-status">
                <strong>Server auth:</strong> {serverAuthStatus || 'unknown'}
                <div>{serverAuthMessage}</div>
                {accessToken && (
                  <button
                    type="button"
                    className="auth-submit auth-submit-secondary"
                    onClick={() => setShowAccessToken((prev) => !prev)}
                  >
                    {showAccessToken ? 'Hide token' : 'Show token'}
                  </button>
                )}
                {showAccessToken && accessToken && (
                  <pre className="auth-token">{accessToken}</pre>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="channel-panel">
        <button
          type="button"
          className="panel-toggle"
          onClick={() => setSidePanelOpen((prev) => !prev)}
        >
          {sidePanelOpen ? "Hide channels" : "Show channels"}
        </button>
      </div>

      <div className={`side-panel ${sidePanelOpen ? "open" : ""}`}>
        <div className="side-panel-header">
          <div>
            <strong>Channels</strong>
            <p className="panel-subtitle">Switch, invite, or create new chats</p>
          </div>
          <button type="button" className="panel-close" onClick={() => setSidePanelOpen(false)}>
            Close
          </button>
        </div>

        <div className="channel-bar">
          {getSidebarChannels().map((channel) => (
            <button
              key={channel.id}
              type="button"
              className={`channel-button ${channel.id === currentChannelId ? "active" : ""}`}
              onClick={() => {
                setCurrentChannelId(channel.id)
                setSidePanelOpen(false)
              }}
            >
              {channel.name}
            </button>
          ))}
        </div>

        <div className="joined-spaces">
          <div className="section-heading">Joined spaces</div>
          {channels.filter((channel) => channel.type === "space").length === 0 ? (
            <div className="section-empty">No joined spaces yet. Join one from Explore.</div>
          ) : (
            channels
              .filter((channel) => channel.type === "space")
              .map((space) => (
                <div key={space.id} className="space-panel">
                  <button
                    type="button"
                    className={`channel-button ${space.id === currentChannelId || currentSpace?.id === space.id ? "active" : ""}`}
                    onClick={() => {
                      setCurrentChannelId(space.id)
                      setSidePanelOpen(false)
                    }}
                  >
                    {space.name}
                  </button>
                  <div className="space-subchannel-list">
                    {getSpaceSubchannels(space.id).map((subchannel) => (
                      <button
                        key={subchannel.id}
                        type="button"
                        className={`channel-button ${subchannel.id === currentChannelId ? "active" : ""}`}
                        onClick={() => {
                          setCurrentChannelId(subchannel.id)
                          setSidePanelOpen(false)
                        }}
                      >
                        {subchannel.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))
          )}
        </div>

        {currentSpace && (
          <div className="space-subchannel-creation">
            <div className="section-heading">Create sub-channel in {currentSpace.name}</div>
            <div className="channel-creator-row">
              <input
                type="text"
                value={newSubChannelName}
                onChange={(event) => setNewSubChannelName(event.target.value)}
                placeholder="New sub-channel name"
              />
              <button type="button" className="channel-action" onClick={createSpaceSubchannel}>
                Add sub-channel
              </button>
            </div>
          </div>
        )}

        <div className="explore-spaces">
          <div className="section-heading">Explore spaces</div>
          {exploreSpaces.map((space) => {
            const isJoined = channels.some((channel) => channel.id === space.id)
            return (
              <div key={space.id} className="space-card">
                <div>
                  <strong>{space.name}</strong>
                  <p>{space.description}</p>
                </div>
                <button
                  type="button"
                  className="channel-action"
                  onClick={() => joinSpace(space)}
                >
                  {isJoined ? "Open" : "Join"}
                </button>
              </div>
            )
          })}
        </div>

        <div className="creator-toggle-row">
          <span className="creator-label">Create chat</span>
          <button type="button" className="channel-action" onClick={() => setShowCreator((prev) => !prev)}>
            {showCreator ? "Hide" : "New"}
          </button>
        </div>

        {showCreator && (
          <div className="channel-creator">
            <div className="channel-type-selector">
              {[
                { id: "dm", label: "DM" },
                { id: "group", label: "Group" },
                { id: "space", label: "Space" },
              ].map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={`channel-button ${createMode === option.id ? "active" : ""}`}
                  onClick={() => {
                    setCreateMode(option.id)
                    setChannelError(null)
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {createMode === "dm" && (
              <>
                <div className="channel-creator-row">
                  <input
                    type="text"
                    value={newDmTarget}
                    onChange={(event) => setNewDmTarget(event.target.value)}
                    placeholder="DM username or email"
                  />
                  <button type="button" className="channel-action" onClick={createDmChannel}>
                    Start DM
                  </button>
                </div>
                <div className="channel-creator-row">
                  <input
                    type="text"
                    value={inviteInput}
                    onChange={(event) => setInviteInput(event.target.value)}
                    placeholder="Add DM invitee"
                  />
                  <button type="button" className="channel-action" onClick={addInvitee}>
                    Add invite
                  </button>
                </div>
              </>
            )}

            {(createMode === "group" || createMode === "space") && (
              <>
                <div className="channel-creator-row">
                  <input
                    type="text"
                    value={newGroupName}
                    onChange={(event) => setNewGroupName(event.target.value)}
                    placeholder={createMode === "group" ? "Group name" : "Space name"}
                  />
                </div>
                <div className="channel-creator-row">
                  <input
                    type="text"
                    value={inviteInput}
                    onChange={(event) => setInviteInput(event.target.value)}
                    placeholder="Add member email or username"
                  />
                  <button type="button" className="channel-action" onClick={addInvitee}>
                    Add invite
                  </button>
                </div>
                {createMode === "group" && (
                  <div className="channel-creator-row">
                    <input
                      type="text"
                      value={newGroupMembers}
                      onChange={(event) => setNewGroupMembers(event.target.value)}
                      placeholder="Group members: comma-separated"
                    />
                  </div>
                )}
                <div className="channel-creator-row">
                  <button
                    type="button"
                    className="channel-action"
                    onClick={createMode === "group" ? createGroupChannel : createSpaceChannel}
                  >
                    {createMode === "group" ? "Create group" : "Create space"}
                  </button>
                </div>
              </>
            )}

            {invitees.length > 0 && (
              <div className="invite-list">
                {invitees.map((invite) => (
                  <div key={invite} className="invite-chip">
                    {invite}
                    <button type="button" onClick={() => removeInvitee(invite)}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {channelError && <div className="auth-error">{channelError}</div>}
          </div>
        )}
      </div>

      <div className="message-list">
        <Message userId={user?.uid} pendingMessages={offlineQueue} accessToken={accessToken} encryptionKey={localMessageKey} channelId={currentChannelId} />
        {typingUsers.length > 0 && (
          <div className="typing-indicator">
            {typingUsers.join(", ")} {typingUsers.length === 1 ? "is" : "are"} typing...
          </div>
        )}
      </div>

      {authError && <div className="auth-error">{authError}</div>}

      <Textbox
        onSubmit={handleSend}
        onVoiceSubmit={handleSendVoice}
        onTyping={handleTyping}
        disabled={!user}
        placeholder={user ? "Type a message..." : "Sign in to chat"}
      />
    </div>
  )
}
export default Chat
