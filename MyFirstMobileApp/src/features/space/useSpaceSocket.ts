import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

import { usePingEngine } from '@/hooks/usePingEngine';

import type {
  PingLevel,
  PingPayload,
  SpaceTask,
  TaskProofPayload,
} from './space.types';

export interface SpaceSocketOptions {
  serverUrl?: string;
  spaceId?: string;
  userId?: string;
  enabled?: boolean;
  onTaskStateChanged?: (task: SpaceTask, meta: { old_status?: string; new_status?: string; actor_id?: string }) => void;
  onEmergencyPing?: (ping: PingPayload) => void;
  onBotVerified?: (payload: Record<string, unknown>) => void;
}

export interface SpaceSocketViewModel {
  socket: Socket | null;
  connected: boolean;
  connecting: boolean;
  error?: string;
  spaceId?: string;
  tasks: SpaceTask[];
  pings: PingPayload[];
  joinSpace: (nextSpaceId: string) => void;
  submitProof: (payload: TaskProofPayload) => void;
  acknowledgePing: (pingId: string) => void;
  registerBot: (payload: {
    space_id: string;
    bot_name: string;
    permissions: string[];
    webhook_url: string;
    owner_user_id: string;
  }) => void;
  emitTaskStatusUpdate: (taskId: string, nextStatus: string, actorId?: string) => void;
}

const DEFAULT_URL = 'http://localhost:3000';

export function useSpaceSocket(options: SpaceSocketOptions = {}): SpaceSocketViewModel {
  const {
    serverUrl = DEFAULT_URL,
    spaceId,
    userId,
    enabled = true,
    onTaskStateChanged,
    onEmergencyPing,
    onBotVerified,
  } = options;

  const socketRef = useRef<Socket | null>(null);
  const { triggerLocalPing } = usePingEngine();

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [activeSpaceId, setActiveSpaceId] = useState<string | undefined>(spaceId);
  const [tasks, setTasks] = useState<SpaceTask[]>([]);
  const [pings, setPings] = useState<PingPayload[]>([]);

  const socket = useMemo(() => {
    if (!enabled) return null;

    const nextSocket = io(serverUrl, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 500,
    });

    socketRef.current = nextSocket;
    return nextSocket;
  }, [enabled, serverUrl]);

  useEffect(() => {
    if (!socket) return;

    setConnecting(true);
    setError(undefined);

    const handleConnect = () => {
      setConnected(true);
      setConnecting(false);
      setError(undefined);

      if (activeSpaceId) {
        socket.emit('join:space', { space_id: activeSpaceId });
      }
    };

    const handleDisconnect = () => {
      setConnected(false);
      setConnecting(false);
    };

    const handleError = (payload: { message?: string; type?: string }) => {
      setError(payload?.message || payload?.type || 'Socket error');
    };

    const handleTaskStateChanged = (payload: any) => {
      const task: SpaceTask = {
        id: payload.task_id,
        event_id: payload.event_id,
        title: payload.title,
        status: payload.new_status,
        assignee_user_id: payload.assignee_user_id,
        assignee_role_id: payload.assignee_role_id,
        proof_required: Boolean(payload.proof_required),
        updated_at: payload.updated_at,
      };

      setTasks((current) => {
        const index = current.findIndex((entry) => entry.id === task.id);
        if (index >= 0) {
          const next = [...current];
          next[index] = task;
          return next;
        }

        return [task, ...current];
      });

      if (onTaskStateChanged) {
        onTaskStateChanged(task, {
          old_status: payload.old_status,
          new_status: payload.new_status,
          actor_id: payload.actor_id,
        });
      }
    };

    const handlePingCreated = (payload: PingPayload) => {
      setPings((current) => [payload, ...current]);

      if (payload.ping_level !== undefined) {
        triggerLocalPing(payload.ping_level as PingLevel, payload);
      }
    };

    const handleEmergencyPing = (payload: PingPayload) => {
      setPings((current) => [payload, ...current]);
      triggerLocalPing(3, payload);

      if (onEmergencyPing) {
        onEmergencyPing(payload);
      }
    };

    const handleBotVerified = (payload: Record<string, unknown>) => {
      if (onBotVerified) {
        onBotVerified(payload);
      }
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('error', handleError);
    socket.on('task:state_changed', handleTaskStateChanged);
    socket.on('task:proof_submitted', (payload) => {
      setTasks((current) => current.map((task) => (task.id === payload.task_id ? { ...task, status: 'submitted', updated_at: payload.submitted_at } : task)));
    });
    socket.on('ping:created', handlePingCreated);
    socket.on('ping:emergency', handleEmergencyPing);
    socket.on('bot:verified', handleBotVerified);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('error', handleError);
      socket.off('task:state_changed', handleTaskStateChanged);
      socket.off('ping:created', handlePingCreated);
      socket.off('ping:emergency', handleEmergencyPing);
      socket.off('bot:verified', handleBotVerified);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [activeSpaceId, onBotVerified, onEmergencyPing, onTaskStateChanged, socket, triggerLocalPing]);

  useEffect(() => {
    if (!socket || !spaceId) return;
    setActiveSpaceId(spaceId);
    socket.emit('join:space', { space_id: spaceId });
  }, [socket, spaceId]);

  const joinSpace = useCallback(
    (nextSpaceId: string) => {
      setActiveSpaceId(nextSpaceId);
      if (socketRef.current) {
        socketRef.current.emit('join:space', { space_id: nextSpaceId });
      }
    },
    []
  );

  const submitProof = useCallback(
    (payload: TaskProofPayload) => {
      if (!socketRef.current) return;
      socketRef.current.emit('task:submit_proof', {
        ...payload,
        user_id: payload.user_id || userId,
      });
    },
    [userId]
  );

  const acknowledgePing = useCallback(
    (pingId: string) => {
      if (!socketRef.current || !userId) return;
      socketRef.current.emit('ping:acknowledge', {
        ping_id: pingId,
        user_id: userId,
      });
    },
    [userId]
  );

  const registerBot = useCallback(
    (payload: {
      space_id: string;
      bot_name: string;
      permissions: string[];
      webhook_url: string;
      owner_user_id: string;
    }) => {
      if (!socketRef.current) return;
      socketRef.current.emit('bot:register', payload);
    },
    []
  );

  const emitTaskStatusUpdate = useCallback(
    (taskId: string, nextStatus: string, actorId?: string) => {
      if (!socketRef.current) return;
      socketRef.current.emit('task:update_status', {
        task_id: taskId,
        new_status: nextStatus,
        actor_id: actorId || userId,
      });
    },
    [userId]
  );

  return {
    socket: socketRef.current,
    connected,
    connecting,
    error,
    spaceId: activeSpaceId,
    tasks,
    pings,
    joinSpace,
    submitProof,
    acknowledgePing,
    registerBot,
    emitTaskStatusUpdate,
  };
}
