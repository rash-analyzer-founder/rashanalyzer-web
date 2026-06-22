import { useState, useEffect, useRef } from "react"
import "./textbox.css"
import sendIcon from "../assets/send.png"
import micIcon from "../assets/Mic.png"

function Textbox({ onSubmit, onVoiceSubmit, onTyping, placeholder = "Type a message...", disabled = false }) {
  const [value, setValue] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [audioBlob, setAudioBlob] = useState(null)
  const [audioUrl, setAudioUrl] = useState(null)
  const [recordError, setRecordError] = useState(null)
  const pendingVoiceSendRef = useRef(false)
  const mediaStreamRef = useRef(null)
  const recorderRef = useRef(null)

  const handleChange = (event) => {
    setValue(event.target.value)
    if (!isTyping) {
      setIsTyping(true)
      onTyping?.(true)
    }
  }

  useEffect(() => {
    if (isTyping) {
      const timer = setTimeout(() => {
        setIsTyping(false)
        onTyping?.(false)
      }, 1000) // Stop typing after 1 second of inactivity
      return () => clearTimeout(timer)
    }
  }, [value, isTyping, onTyping])

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop())
      }
    }
  }, [audioUrl])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (disabled) return

    if (isRecording) {
      recorderRef.current?.stop()
      setIsRecording(false)
      pendingVoiceSendRef.current = true
      return
    }

    if (audioBlob) {
      const sent = await handleSendVoice(audioBlob)
      if (sent) {
        setIsTyping(false)
        onTyping?.(false)
      }
      return
    }

    const trimmed = value.trim()
    if (!trimmed) return

    onSubmit?.(trimmed)
    setValue("")
    setIsTyping(false)
    onTyping?.(false)
  }

  const handleRecordClick = async () => {
    if (disabled) return

    if (audioBlob) {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
        setAudioUrl(null)
      }
      setAudioBlob(null)
    }

    if (disabled) return

    if (isRecording) {
      recorderRef.current?.stop()
      setIsRecording(false)
      return
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setRecordError("Audio recording is not supported by this browser.")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      const recorder = new MediaRecorder(stream)
      const chunks = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data)
        }
      }

      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" })
        const url = URL.createObjectURL(blob)
        setAudioBlob(blob)
        setAudioUrl(url)

        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => track.stop())
          mediaStreamRef.current = null
        }

        if (pendingVoiceSendRef.current) {
          pendingVoiceSendRef.current = false
          await handleSendVoice(blob)
          setIsTyping(false)
          onTyping?.(false)
        }
      }

      recorder.start()
      recorderRef.current = recorder
      setIsRecording(true)
      setRecordError(null)
    } catch (error) {
      console.error("Voice recording error:", error)
      setRecordError("Unable to access microphone. Please allow access.")
    }
  }

  const handleSendVoice = async (blob = audioBlob) => {
    if (!blob || disabled) return false

    try {
      const success = await onVoiceSubmit?.(blob)
      if (!success) {
        throw new Error("Voice send failed")
      }
      pendingVoiceSendRef.current = false
      setAudioBlob(null)
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
        setAudioUrl(null)
      }
      setIsRecording(false)
      return true
    } catch (error) {
      console.error("Failed to send voice message from Textbox:", error)
      setRecordError("Voice message failed to send.")
      return false
    }
  }

  const handleCancelRecording = () => {
    setIsRecording(false)
    pendingVoiceSendRef.current = false
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop()
    }
    setAudioBlob(null)
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
      setAudioUrl(null)
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
    }
  }

  return (
    <form className="textbox-form" onSubmit={handleSubmit}>
      <div className="textbox-input-group">
        <input
          className="textbox-input"
          type="text"
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          aria-label="Message input"
          disabled={disabled}
        />
        <button
          type="button"
          className={`textbox-mic-button ${isRecording ? "recording" : ""}`}
          onClick={handleRecordClick}
          disabled={disabled}
          aria-label={isRecording ? "Stop recording" : "Start recording"}
        >
          <img src={micIcon} alt="Mic" className="textbox-mic-icon" />
        </button>
        <button type="submit" className="textbox-send" disabled={disabled}>
          <img src={sendIcon} alt="Send" className="textbox-send-icon" />
        </button>
      </div>

      {audioBlob && (
        <div className="textbox-voice-preview">
          <audio controls src={audioUrl} className="textbox-audio-player" />
          <span className="textbox-voice-label">Recorded voice ready. Press send to upload.</span>
          <button type="button" className="textbox-cancel" onClick={handleCancelRecording}>
            Cancel
          </button>
        </div>
      )}
      {recordError && <div className="textbox-error">{recordError}</div>}
    </form>
  )
}

export default Textbox;
