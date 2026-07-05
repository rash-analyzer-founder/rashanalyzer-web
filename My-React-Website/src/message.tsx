import { useState, useEffect, useRef } from "react"
import "./message.css"
import { db, collection, onSnapshot, query, orderBy, where } from "./firebase.js"
import notificationSound from "../assets/mixkit-message-pop-alert-2354.mp3"

const MESSAGE_CACHE_KEY_PREFIX = "chat-messages-cache"
const SERVER_BASE = typeof window !== "undefined" && window.location.hostname ? `http://${window.location.hostname}:4000` : "http://localhost:4000"

const fetchServerMessages = async (accessToken, channelId = "global") => {
  if (!accessToken) return []
  const url = `${SERVER_BASE}/api/v1/messages?channelId=${encodeURIComponent(channelId)}`
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
  if (!resp.ok) {
    throw new Error('Server message fetch failed')
  }
  return resp.json()
}

function Message({ userId, pendingMessages = [], accessToken, encryptionKey, channelId = "global" }) {
    const cacheKey = `${MESSAGE_CACHE_KEY_PREFIX}:${channelId}`
    const [messages, setMessages] = useState(() => {
        if (typeof window === "undefined") return []
        try {
            const saved = localStorage.getItem(cacheKey)
            return saved ? JSON.parse(saved) : []
        } catch (error) {
            console.warn("Failed to load cached chat messages:", error)
            return []
        }
    });
    const [isOffline, setIsOffline] = useState(typeof navigator !== "undefined" ? !navigator.onLine : false)
    const messagesEndRef = useRef(null);
    const audioRef = useRef(null);
    const previousMessageCountRef = useRef(messages.length);

    useEffect(() => {
        audioRef.current = new Audio(notificationSound)
    }, [])

    useEffect(() => {
        const updateOnlineStatus = () => setIsOffline(!navigator.onLine)
        window.addEventListener("online", updateOnlineStatus)
        window.addEventListener("offline", updateOnlineStatus)
        return () => {
            window.removeEventListener("online", updateOnlineStatus)
            window.removeEventListener("offline", updateOnlineStatus)
        }
    }, [])

    useEffect(() => {
        let unsubscribe = null
        const loadServerMessages = async () => {
            try {
                        const serverMessages = await fetchServerMessages(accessToken, channelId)
                setMessages(serverMessages)
                localStorage.setItem(cacheKey, JSON.stringify(serverMessages))
            } catch (error) {
                console.warn("Server message fetch failed, falling back to Firestore:", error)
                subscribeFirestore()
            }
        }

        const subscribeFirestore = () => {
            const q = query(collection(db, "messages"), where("channelId", "==", channelId), orderBy("timestamp", "asc"));
            unsubscribe = onSnapshot(q, (snapshot) => {
                const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                const newMessages = []
                const hexToBuffer = (hex) => {
                    const bytes = new Uint8Array(hex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)))
                    return bytes.buffer
                }

                const tryDecrypt = async (msg) => {
                    if (!msg.encrypted) return msg
                    if (!encryptionKey) {
                        return { ...msg, text: '[encrypted]' }
                    }
                    try {
                        const iv = new Uint8Array(hexToBuffer(msg.iv))
                        const ciphertext = hexToBuffer(msg.ciphertext)
                        const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, encryptionKey, ciphertext)
                        const obj = JSON.parse(new TextDecoder().decode(decrypted))
                        return { ...msg, ...obj }
                    } catch (err) {
                        console.warn('Failed to decrypt message', err)
                        return { ...msg, text: '[encrypted]' }
                    }
                }

                const decryptAll = async () => {
                    for (const d of docs) {
                        // preserve order while decrypting
                        // eslint-disable-next-line no-await-in-loop
                        const dec = await tryDecrypt(d)
                        newMessages.push(dec)
                    }
                    setMessages(newMessages)
                    try {
                        localStorage.setItem(cacheKey, JSON.stringify(newMessages))
                    } catch (error) {
                        console.warn("Failed to persist cached chat messages:", error)
                    }
                }

                decryptAll()

                if (newMessages.length > previousMessageCountRef.current) {
                    const latestMessage = newMessages[newMessages.length - 1];
                    if (latestMessage.uid !== userId) {
                        audioRef.current?.play().catch(() => {
                            // Ignore play failures if browser blocks autoplay until interaction
                        });
                    }
                }
                previousMessageCountRef.current = newMessages.length;
            }, (error) => {
                console.warn("Firestore snapshot error, continuing with cached messages:", error)
            });
        }

        if (accessToken) {
            loadServerMessages()
        } else {
            subscribeFirestore()
        }

        return () => {
            if (unsubscribe) unsubscribe()
        }
    }, [userId, accessToken, encryptionKey, channelId]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, pendingMessages]);

    return (
        <div className="messages-container">
            {isOffline && (
                <div className="message-offline-banner">
                    Offline mode: showing cached messages and queued local messages.
                </div>
            )}
            {messages.length === 0 ? (
                <div className="message-empty">No messages yet...</div>
            ) : (
                messages.map((message) => {
                    const isSelf = message.uid && message.uid === userId
                    return (
                        <div
                            key={message.id}
                            className={`message-bubble ${isSelf ? "bubble-self" : "bubble-other"}`}
                        >
                            {message.name && <div className="message-meta">{message.name}</div>}
                            {message.text ? <p>{message.text}</p> : <p className="message-empty-text">Voice message</p>}
                            {message.audioUrl && (
                              <audio controls className="message-audio" src={message.audioUrl} />
                            )}
                        </div>
                    )
                })
            )}
            {pendingMessages.length > 0 && (
                pendingMessages.map((message) => (
                    <div
                        key={message.id}
                        className="message-bubble bubble-self message-pending"
                    >
                        {message.name && <div className="message-meta">{message.name} (pending)</div>}
                        <p>{message.text}</p>
                    </div>
                ))
            )}
            <div ref={messagesEndRef} />
        </div>
    )
}

export default Message;