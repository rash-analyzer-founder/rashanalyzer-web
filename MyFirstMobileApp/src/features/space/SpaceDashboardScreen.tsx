import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSpaceSocket } from './useSpaceSocket';
import type { PingLevel, PingPayload, SpaceRole, SpaceTask, TaskStatus } from './space.types';

const mockRoles: SpaceRole[] = [
  {
    id: 'role-ops',
    name: 'Operator',
    priority_level: 1,
    can_manage_tasks: true,
    can_manage_events: false,
    can_manage_bots: false,
    can_kick: false,
  },
  {
    id: 'role-supervisor',
    name: 'Supervisor',
    priority_level: 2,
    can_manage_tasks: true,
    can_manage_events: true,
    can_manage_bots: true,
    can_kick: true,
  },
  {
    id: 'role-member',
    name: 'Member',
    priority_level: 3,
    can_manage_tasks: false,
    can_manage_events: false,
    can_manage_bots: false,
    can_kick: false,
  },
];

const mockTasks: SpaceTask[] = [
  {
    id: 'task-1',
    event_id: 'event-1',
    title: 'Inspect Solvothermal Step',
    description: 'Verify pressure and solution balance.',
    status: 'pending',
    assignee_user_id: 'user-1',
    proof_required: true,
    updated_at: new Date().toISOString(),
  },
  {
    id: 'task-2',
    event_id: 'event-1',
    title: 'Review Material Batch',
    description: 'Check sample integrity and log metrics.',
    status: 'assigned',
    assignee_user_id: 'user-2',
    proof_required: true,
    updated_at: new Date().toISOString(),
  },
  {
    id: 'task-3',
    event_id: 'event-1',
    title: 'Run Spectral Check',
    description: 'Validate baseline output before handoff.',
    status: 'in_progress',
    assignee_user_id: 'user-3',
    proof_required: true,
    updated_at: new Date().toISOString(),
  },
  {
    id: 'task-4',
    event_id: 'event-1',
    title: 'Submit Progress Proof',
    description: 'Attach notes and dataset screenshot.',
    status: 'submitted',
    assignee_user_id: 'user-4',
    proof_required: true,
    updated_at: new Date().toISOString(),
  },
  {
    id: 'task-5',
    event_id: 'event-1',
    title: 'Approve Final Signoff',
    description: 'Supervisor acceptance and release.',
    status: 'approved',
    assignee_user_id: 'user-5',
    proof_required: false,
    updated_at: new Date().toISOString(),
  },
];

const channelSeed = [
  { id: 'ch-1', name: 'lab-ops', type: 'text', active: true },
  { id: 'ch-2', name: 'safety-brief', type: 'voice', active: true },
  { id: 'ch-3', name: 'demo-room', type: 'video', active: false },
  { id: 'ch-4', name: 'method-notes', type: 'text', active: true },
];

const pingMeta: Record<PingLevel, { label: string; accent: string; chip: string; note: string }> = {
  0: { label: 'Meh', accent: '#6366F1', chip: '#1E293B', note: 'Quiet update' },
  1: { label: 'Normal', accent: '#F59E0B', chip: '#2C1A00', note: 'Task update' },
  2: { label: 'Urgent', accent: '#6366F1', chip: '#211B4C', note: 'Role or bot action' },
  3: { label: 'Emergency', accent: '#EF4444', chip: '#3B0C0C', note: 'Override active' },
};

const statusStyles: Record<TaskStatus, { chip: string; text: string; dot: string }> = {
  pending: { chip: '#1E293B', text: '#E2E8F0', dot: '#94A3B8' },
  assigned: { chip: '#1E293B', text: '#C4B5FD', dot: '#8B5CF6' },
  in_progress: { chip: '#2C1A00', text: '#FBBF24', dot: '#F59E0B' },
  submitted: { chip: '#0F172A', text: '#A7F3D0', dot: '#10B981' },
  approved: { chip: '#052E2B', text: '#6EE7B7', dot: '#10B981' },
  rejected: { chip: '#3F1D1D', text: '#FCA5A5', dot: '#EF4444' },
  blocked: { chip: '#3B0C0C', text: '#FCA5A5', dot: '#EF4444' },
};

export default function SpaceDashboardScreen() {
  const [tab, setTab] = useState<'overview' | 'roles' | 'tasks' | 'pings'>('overview');
  const [banner, setBanner] = useState<PingPayload | null>({
    ping_id: 'ping-demo',
    space_id: 'space-lab',
    created_by: 'lead-1',
    ping_level: 1,
    category: 'task',
    title: 'Task update',
    message: 'Material prep is in progress',
    created_at: new Date().toISOString(),
  });

  const socket = useSpaceSocket({
    serverUrl: 'http://192.168.1.10:3000',
    spaceId: 'space-lab',
    userId: 'user-1',
    enabled: true,
    onEmergencyPing: (payload) => setBanner(payload),
    onTaskStateChanged: (_task, meta) => {
      setBanner({
        ping_id: `ping-${Date.now()}`,
        space_id: 'space-lab',
        created_by: meta.actor_id || 'system',
        ping_level: 1,
        title: 'Task update',
        message: `${meta.new_status || 'updated'} · ${meta.old_status || 'pending'}`,
        category: 'task',
        created_at: new Date().toISOString(),
      });
    },
  });

  const groupedTasks = useMemo(() => {
    const groups: Record<TaskStatus, SpaceTask[]> = {
      pending: [],
      assigned: [],
      in_progress: [],
      submitted: [],
      approved: [],
      rejected: [],
      blocked: [],
    };

    for (const task of socket.tasks.length ? socket.tasks : mockTasks) {
      groups[task.status].push(task);
    }

    return groups;
  }, [socket.tasks]);

  const activePing = banner ?? null;
  const pingLevel = activePing?.ping_level ?? 0;
  const pingStyle = pingMeta[pingLevel];

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scroller} showsVerticalScrollIndicator={false}>
        {activePing && (
          <View
            style={[
              styles.pingBanner,
              { backgroundColor: pingLevel === 3 ? '#3B0C0C' : pingLevel === 2 ? '#211B4C' : pingLevel === 1 ? '#2C1A00' : '#111827' },
              pingLevel === 3 && styles.pingEmergency,
            ]}
          >
            <View style={[styles.pingBadge, { backgroundColor: pingStyle.chip, borderColor: pingStyle.accent }]}> 
              <Text style={styles.pingBadgeText}>{pingStyle.label}</Text>
            </View>
            <View style={styles.pingContent}>
              <Text style={styles.pingTitle}>{activePing.title}</Text>
              <Text style={styles.pingMessage}>{activePing.message || 'System update'}</Text>
            </View>
            {pingLevel === 3 && (
              <View style={styles.pingActions}>
                <Pressable style={[styles.actionButton, styles.dismissButton]} onPress={() => setBanner(null)}>
                  <Text style={styles.actionText}>Dismiss</Text>
                </Pressable>
                <Pressable style={[styles.actionButton, styles.ackButton]} onPress={() => socket.acknowledgePing(activePing.ping_id)}>
                  <Text style={styles.actionText}>Acknowledge</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        <View style={styles.headerCard}>
          <View>
            <Text style={styles.eyebrow}>Active space</Text>
            <Text style={styles.title}>MOF Synthesis Lab</Text>
            <Text style={styles.subtitle}>12 members · Ops online · 98% sync</Text>
          </View>
          <View style={styles.statusPill}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>Live</Text>
          </View>
        </View>

        <View style={styles.tabRow}>
          {(['overview', 'roles', 'tasks', 'pings'] as const).map((item) => (
            <Pressable
              key={item}
              onPress={() => setTab(item)}
              style={[styles.tab, tab === item && styles.tabActive]}
            >
              <Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'overview' && (
          <>
            <View style={styles.metricGrid}>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Tasks</Text>
                <Text style={styles.metricValue}>24</Text>
                <Text style={styles.metricHint}>+6 today</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>XP</Text>
                <Text style={styles.metricValue}>1,380</Text>
                <Text style={styles.metricHint}>Pool +220</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Bots</Text>
                <Text style={styles.metricValue}>3</Text>
                <Text style={styles.metricHint}>2 verified</Text>
              </View>
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Channel directory</Text>
                <Text style={styles.sectionMeta}>4 live</Text>
              </View>
              {channelSeed.map((channel) => (
                <View key={channel.id} style={styles.channelRow}>
                  <View style={styles.channelIconWrap}>
                    <Text style={styles.channelIcon}>{channel.type === 'text' ? 'T' : channel.type === 'voice' ? 'V' : 'M'}</Text>
                  </View>
                  <View style={styles.channelMeta}>
                    <Text style={styles.channelName}>#{channel.name}</Text>
                    <Text style={styles.channelType}>{channel.type.toUpperCase()}</Text>
                  </View>
                  <View style={[styles.channelLive, channel.active && styles.channelLiveActive]} />
                </View>
              ))}
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Activity stream</Text>
                <Text style={styles.sectionMeta}>Live feed</Text>
              </View>
              {[{ label: 'Bot verified', detail: 'mof-bot-01 accepted' }, { label: 'Task routed', detail: 'Supervisor assigned review' }, { label: 'Ping raised', detail: 'Emergency override acknowledged' }].map((item) => (
                <View key={item.label} style={styles.activityRow}>
                  <View style={styles.activityDot} />
                  <View style={styles.activityTextWrap}>
                    <Text style={styles.activityTitle}>{item.label}</Text>
                    <Text style={styles.activityDetail}>{item.detail}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {tab === 'roles' && (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Role matrix</Text>
              <Text style={styles.sectionMeta}>{mockRoles.length} roles</Text>
            </View>
            {mockRoles.map((role) => (
              <View key={role.id} style={styles.roleCard}>
                <View style={styles.roleHeaderRow}>
                  <Text style={styles.roleName}>{role.name}</Text>
                  <Text style={styles.rolePriority}>#{role.priority_level}</Text>
                </View>
                <View style={styles.permissionGrid}>
                  {[
                    { key: 'can_manage_tasks', value: role.can_manage_tasks },
                    { key: 'can_manage_events', value: role.can_manage_events },
                    { key: 'can_manage_bots', value: role.can_manage_bots },
                    { key: 'can_kick', value: role.can_kick },
                  ].map((permission) => (
                    <View key={permission.key} style={styles.permissionRow}>
                      <Text style={styles.permissionKey}>{permission.key}</Text>
                      <View style={[styles.permissionValue, permission.value && styles.permissionValueOn]}>
                        <Text style={styles.permissionValueText}>{permission.value ? 'ON' : 'OFF'}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}

        {tab === 'tasks' && (
          <View style={styles.taskBoard}>
            {Object.entries(groupedTasks).map(([status, items]) => (
              <View key={status} style={styles.column}>
                <View style={styles.columnHeader}>
                  <Text style={styles.columnTitle}>{status.replace('_', ' ')}</Text>
                  <Text style={styles.columnCount}>{items.length}</Text>
                </View>
                {items.length === 0 ? (
                  <View style={styles.emptyColumn}>
                    <Text style={styles.emptyText}>No tasks</Text>
                  </View>
                ) : (
                  items.map((task) => (
                    <View key={task.id} style={styles.taskCard}>
                      <View style={styles.taskHeader}>
                        <View style={styles.avatar}>S</View>
                        <View style={styles.taskHeadText}>
                          <Text style={styles.taskTitle}>{task.title}</Text>
                          <Text style={styles.taskMeta}>Priority · High</Text>
                        </View>
                        <View style={[styles.statusBadge, { backgroundColor: statusStyles[task.status].chip }]}>
                          <Text style={[styles.statusBadgeText, { color: statusStyles[task.status].text }]}>{task.status}</Text>
                        </View>
                      </View>
                      <Text style={styles.taskDescription}>{task.description || 'No description provided.'}</Text>
                      <View style={styles.taskMetaRow}>
                        <Text style={styles.metaLabel}>Assignee</Text>
                        <Text style={styles.metaValue}>{task.assignee_user_id || 'Unassigned'}</Text>
                      </View>
                      <View style={styles.taskMetaRow}>
                        <Text style={styles.metaLabel}>XP</Text>
                        <Text style={styles.metaValue}>+120</Text>
                      </View>
                      <View style={styles.taskMetaRow}>
                        <Text style={styles.metaLabel}>Deadline</Text>
                        <Text style={styles.metaValue}>{new Date(task.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                      </View>
                      <View style={styles.actionRow}>
                        <Pressable style={[styles.secondaryAction, { borderColor: '#334155' }]} onPress={() => socket.emitTaskStatusUpdate(task.id, 'approved')}>
                          <Text style={styles.secondaryActionText}>Submit Work</Text>
                        </Pressable>
                        <Pressable style={[styles.primaryAction, { backgroundColor: '#10B981' }]} onPress={() => socket.emitTaskStatusUpdate(task.id, 'approved')}>
                          <Text style={styles.primaryActionText}>Approve</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}
              </View>
            ))}
          </View>
        )}

        {tab === 'pings' && (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Ping matrix</Text>
              <Text style={styles.sectionMeta}>4-tier alert engine</Text>
            </View>
            {([0, 1, 2, 3] as PingLevel[]).map((level) => (
              <View key={level} style={styles.pingMatrixRow}>
                <View style={[styles.levelBadge, { backgroundColor: pingMeta[level].chip, borderColor: pingMeta[level].accent }]}>
                  <Text style={styles.levelBadgeText}>{pingMeta[level].label}</Text>
                </View>
                <View style={styles.levelInfo}>
                  <Text style={styles.levelInfoTitle}>{pingMeta[level].note}</Text>
                  <Text style={styles.levelInfoMeta}>Payload intensity: {level}</Text>
                </View>
              </View>
            ))}

            <Pressable
              style={[styles.primaryAction, styles.ctaButton, { backgroundColor: '#6366F1' }]}
              onPress={() =>
                socket.socket?.emit('ping:dispatch', {
                  ping_id: `ping-${Date.now()}`,
                  space_id: 'space-lab',
                  target_user_id: 'user-1',
                  created_by: 'user-1',
                  ping_level: 2,
                  category: 'system',
                  title: 'Bot action',
                  message: 'Verification completed for bot gateway',
                  created_at: new Date().toISOString(),
                })
              }
            >
              <Text style={styles.primaryActionText}>Dispatch test ping</Text>
            </Pressable>
          </View>
        )}

        {!socket.connected && (
          <View style={styles.connectionState}>
            <ActivityIndicator color="#6366F1" />
            <Text style={styles.connectionText}>{socket.connecting ? 'Connecting to backend…' : 'Socket disconnected'}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  scroller: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 16,
  },
  pingBanner: {
    marginTop: 8,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
  pingEmergency: {
    borderColor: '#EF4444',
    shadowColor: '#EF4444',
    shadowOpacity: 0.5,
  },
  pingBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  pingBadgeText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  pingContent: {
    flex: 1,
  },
  pingTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  pingMessage: {
    color: '#E2E8F0',
    fontSize: 12,
    marginTop: 2,
  },
  pingActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dismissButton: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  ackButton: {
    backgroundColor: '#EF4444',
  },
  actionText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 12,
  },
  headerCard: {
    borderRadius: 18,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    padding: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eyebrow: {
    color: '#94A3B8',
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: '#F8FAFC',
    fontSize: 28,
    fontWeight: '800',
    marginTop: 6,
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 4,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#10B981',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    backgroundColor: '#10B981',
    borderRadius: 999,
    marginRight: 6,
  },
  statusText: {
    color: '#ECFDF5',
    fontWeight: '700',
    fontSize: 12,
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 6,
    gap: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  tab: {
    flex: 1,
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
  },
  tabActive: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#6366F1',
  },
  tabText: {
    color: '#94A3B8',
    textTransform: 'capitalize',
    fontWeight: '700',
  },
  tabTextActive: {
    color: '#F8FAFC',
  },
  metricGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 16,
    padding: 16,
  },
  metricLabel: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 8,
  },
  metricValue: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '800',
  },
  metricHint: {
    color: '#10B981',
    marginTop: 8,
    fontSize: 12,
  },
  sectionCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 16,
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
  },
  sectionMeta: {
    color: '#94A3B8',
    fontSize: 11,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  channelIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#111827',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  channelIcon: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  channelMeta: {
    flex: 1,
    marginLeft: 10,
  },
  channelName: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  channelType: {
    color: '#94A3B8',
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 2,
  },
  channelLive: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#334155',
  },
  channelLiveActive: {
    backgroundColor: '#10B981',
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  activityDot: {
    width: 10,
    height: 10,
    backgroundColor: '#6366F1',
    borderRadius: 999,
  },
  activityTextWrap: {
    flex: 1,
  },
  activityTitle: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 14,
  },
  activityDetail: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  roleCard: {
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 12,
  },
  roleHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  roleName: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 16,
  },
  rolePriority: {
    color: '#A5B4FC',
    fontWeight: '700',
    fontSize: 12,
  },
  permissionGrid: {
    gap: 8,
  },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  permissionKey: {
    color: '#E2E8F0',
    fontSize: 12,
    textTransform: 'capitalize',
  },
  permissionValue: {
    minWidth: 58,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
  },
  permissionValueOn: {
    backgroundColor: '#052E2B',
    borderColor: '#10B981',
  },
  permissionValueText: {
    color: '#F8FAFC',
    fontSize: 10,
    fontWeight: '700',
  },
  taskBoard: {
    flexDirection: 'row',
    gap: 10,
  },
  column: {
    flex: 1,
    minWidth: 220,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 16,
    padding: 12,
  },
  columnHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  columnTitle: {
    color: '#F8FAFC',
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  columnCount: {
    color: '#94A3B8',
    fontSize: 12,
  },
  emptyColumn: {
    minHeight: 100,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 12,
  },
  taskCard: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#6366F1',
    justifyContent: 'center',
    alignItems: 'center',
    color: '#F8FAFC',
    fontWeight: '700',
  },
  taskHeadText: {
    flex: 1,
  },
  taskTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  taskMeta: {
    color: '#94A3B8',
    fontSize: 10,
    marginTop: 2,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#334155',
  },
  statusBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  taskDescription: {
    color: '#E2E8F0',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  taskMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  metaLabel: {
    color: '#94A3B8',
    fontSize: 11,
  },
  metaValue: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  secondaryAction: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryActionText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 12,
  },
  primaryAction: {
    flex: 1,
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  primaryActionText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 12,
  },
  pingMatrixRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  levelBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 82,
    alignItems: 'center',
  },
  levelBadgeText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
  },
  levelInfo: {
    flex: 1,
  },
  levelInfoTitle: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  levelInfoMeta: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  ctaButton: {
    marginTop: 8,
  },
  connectionState: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  connectionText: {
    color: '#94A3B8',
    fontSize: 12,
  },
});
