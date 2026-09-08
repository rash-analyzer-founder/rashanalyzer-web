import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

import { usePingEngine } from '@/hooks/usePingEngine';
import type { ChannelMessage, DirectMessage, PingLevel, PingPayload, SpaceTask, TaskProofPayload } from './space.types';

export interface SpaceSocketOptions {
  serverUrl?: string;
  spaceId?: string;
  userId?: string;
  enabled?: boolean;
  onTaskStateChanged?: (task: SpaceTask, meta: { old_status?: string; new_status?: string; actor_id?: string }) => void;
  onEmergencyPing?: (ping: PingPayload) => void;
  onPing?: (ping: PingPayload) => void;
  onBotVerified?: (payload: Record<string, unknown>) => void;
  onSpaceBroadcast?: (payload: Record<string, unknown>) => void;
}

export interface SpaceSocketViewModel {
  socket: Socket | null;
  connected: boolean;
  connecting: boolean;
  error?: string;
  spaceId?: string;
  tasks: SpaceTask[];
  pings: PingPayload[];
  messages: DirectMessage[];
  channelMessages: ChannelMessage[];
  joinSpace: (nextSpaceId: string) => void;
  joinChannel: (channelId: string) => void;
  submitProof: (payload: TaskProofPayload) => void;
  submitScreening: (answers: Array<{ question_id: string; option_id: string }>) => Promise<void>;
  acknowledgePing: (pingId: string) => void;
  dispatchPing: (payload: Omit<PingPayload, 'ping_id' | 'created_at'>) => void;
  sendDirectMessage: (receiverId: string, body?: string, attachmentUrl?: string) => void;
  sendChannelMessage: (channelId: string, body?: string, attachmentUrl?: string) => void;
  joinVoice: (channelId: string) => void;
  leaveVoice: (channelId: string) => void;
  registerBot: (payload: { space_id: string; bot_name: string; permissions: string[]; webhook_url: string; owner_user_id: string }) => void;
  emitTaskStatusUpdate: (taskId: string, nextStatus: string, actorId?: string) => void;
}

const DEFAULT_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:3000';

export function useSpaceSocket(options: SpaceSocketOptions = {}): SpaceSocketViewModel {
  const { serverUrl = DEFAULT_URL, spaceId, userId, enabled = true, onTaskStateChanged, onEmergencyPing, onPing, onBotVerified, onSpaceBroadcast } = options;
  const socketRef = useRef<Socket | null>(null);
  const { triggerLocalPing } = usePingEngine();
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>();
  const [activeSpaceId, setActiveSpaceId] = useState(spaceId);
  const [tasks, setTasks] = useState<SpaceTask[]>([]);
  const [pings, setPings] = useState<PingPayload[]>([]);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [channelMessages, setChannelMessages] = useState<ChannelMessage[]>([]);

  const socket = useMemo(() => {
    if (!enabled) return null;
    const nextSocket = io(serverUrl, { transports: ['websocket'], reconnection: true, reconnectionAttempts: 10, reconnectionDelay: 500 });
    socketRef.current = nextSocket;
    return nextSocket;
  }, [enabled, serverUrl]);

  useEffect(() => {
    if (!socket) return;
    setConnecting(true);
    const handleConnect = () => { setConnected(true); setConnecting(false); if (activeSpaceId) socket.emit('join:space', { space_id: activeSpaceId, user_id: userId }); };
    const handleDisconnect = () => { setConnected(false); setConnecting(false); };
    const handleError = (payload: { message?: string; type?: string }) => setError(payload?.message || payload?.type || 'Socket error');
    const handleTaskStateChanged = (payload: any) => {
      const task: SpaceTask = { id: payload.task_id, event_id: payload.event_id, title: payload.title, status: payload.new_status, assignee_user_id: payload.assignee_user_id, assignee_role_id: payload.assignee_role_id, proof_required: Boolean(payload.proof_required), updated_at: payload.updated_at };
      setTasks((current) => { const index = current.findIndex((entry) => entry.id === task.id); if (index < 0) return [task, ...current]; const next = [...current]; next[index] = task; return next; });
      onTaskStateChanged?.(task, { old_status: payload.old_status, new_status: payload.new_status, actor_id: payload.actor_id });
    };
    const handlePing = (payload: PingPayload) => { setPings((current) => [payload, ...current]); triggerLocalPing(payload.ping_level as PingLevel, payload); onPing?.(payload); if (payload.ping_level === 3) onEmergencyPing?.(payload); };
    const handleDmMessage = (payload: DirectMessage) => setMessages((current) => [...current, payload]);
    const handleChannelMessage = (payload: ChannelMessage) => setChannelMessages((current) => current.some((message) => message.id === payload.id) ? current : [...current, payload]);
    const handleBotVerified = (payload: Record<string, unknown>) => onBotVerified?.(payload);
    const handleSpaceBroadcast = (payload: Record<string, unknown>) => onSpaceBroadcast?.(payload);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('error', handleError);
    socket.on('task:state_changed', handleTaskStateChanged);
    socket.on('task:proof_submitted', (payload) => setTasks((current) => current.map((task) => task.id === payload.task_id ? { ...task, status: 'submitted', updated_at: payload.submitted_at } : task)));
    socket.on('ping:dispatch', handlePing);
    socket.on('ping:emergency', handlePing);
    socket.on('dm:message', handleDmMessage);
    socket.on('channel:message', handleChannelMessage);
    socket.on('bot:verified', handleBotVerified);
    socket.on('space:broadcast', handleSpaceBroadcast);
    return () => { socket.removeAllListeners(); socket.disconnect(); socketRef.current = null; };
  }, [activeSpaceId, onBotVerified, onEmergencyPing, onPing, onSpaceBroadcast, onTaskStateChanged, socket, triggerLocalPing, userId]);

  useEffect(() => { if (socket && spaceId) { setActiveSpaceId(spaceId); socket.emit('join:space', { space_id: spaceId, user_id: userId }); } }, [socket, spaceId, userId]);
  const joinSpace = useCallback((nextSpaceId: string) => { setActiveSpaceId(nextSpaceId); socketRef.current?.emit('join:space', { space_id: nextSpaceId, user_id: userId }); }, [userId]);
  const joinChannel = useCallback((channelId: string) => { if (userId) socketRef.current?.emit('join:channel', { channel_id: channelId, user_id: userId }); }, [userId]);
  const submitProof = useCallback((payload: TaskProofPayload) => socketRef.current?.emit('task:submit_proof', { ...payload, user_id: payload.user_id || userId }), [userId]);
  const acknowledgePing = useCallback((pingId: string) => { if (userId) socketRef.current?.emit('ping:acknowledge', { ping_id: pingId, user_id: userId }); }, [userId]);
  const dispatchPing = useCallback((payload: Omit<PingPayload, 'ping_id' | 'created_at'>) => socketRef.current?.emit('ping:dispatch', { ...payload, created_by: payload.created_by || userId }), [userId]);
  const sendDirectMessage = useCallback((receiverId: string, body?: string, attachmentUrl?: string) => { if (userId) socketRef.current?.emit('dm:send', { sender_id: userId, receiver_id: receiverId, body, attachment_url: attachmentUrl }); }, [userId]);
  const sendChannelMessage = useCallback((channelId: string, body?: string, attachmentUrl?: string) => { if (userId) socketRef.current?.emit('channel:send_message', { channel_id: channelId, sender_id: userId, body, attachment_url: attachmentUrl }); }, [userId]);
  const joinVoice = useCallback((channelId: string) => { if (userId) socketRef.current?.emit('join:voice', { channel_id: channelId, user_id: userId }); }, [userId]);
  const leaveVoice = useCallback((channelId: string) => { if (userId) socketRef.current?.emit('leave:voice', { channel_id: channelId, user_id: userId }); }, [userId]);
  const registerBot = useCallback((payload: { space_id: string; bot_name: string; permissions: string[]; webhook_url: string; owner_user_id: string }) => socketRef.current?.emit('bot:register', payload), []);
  const emitTaskStatusUpdate = useCallback((taskId: string, nextStatus: string, actorId?: string) => socketRef.current?.emit('task:update_status', { task_id: taskId, new_status: nextStatus, actor_id: actorId || userId }), [userId]);
  const submitScreening = useCallback(async (answers: Array<{ question_id: string; option_id: string }>) => { if (!activeSpaceId || !userId) return; const response = await fetch(`${serverUrl}/api/spaces/${activeSpaceId}/screening/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, answers }) }); if (!response.ok) throw new Error('Screening submission failed'); }, [activeSpaceId, serverUrl, userId]);

  return { socket: socketRef.current, connected, connecting, error, spaceId: activeSpaceId, tasks, pings, messages, channelMessages, joinSpace, joinChannel, submitProof, submitScreening, acknowledgePing, dispatchPing, sendDirectMessage, sendChannelMessage, joinVoice, leaveVoice, registerBot, emitTaskStatusUpdate };
}
