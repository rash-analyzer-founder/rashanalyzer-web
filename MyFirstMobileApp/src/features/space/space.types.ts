export type PingLevel = 0 | 1 | 2 | 3;
export type TaskStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'blocked';

export type ChannelType = 'text' | 'voice' | 'video';

export interface UserSummary {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  xp: number;
  is_cs_verified: boolean;
}

export interface SpaceRole {
  id: string;
  name: string;
  priority_level: number;
  can_manage_tasks: boolean;
  can_manage_events: boolean;
  can_manage_bots: boolean;
  can_kick: boolean;
}

export interface SpaceMember {
  id: string;
  space_id: string;
  user_id: string;
  role_id?: string;
  xp_balance: number;
  is_active: boolean;
}

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  group_id?: string;
  topic?: string;
  is_archived: boolean;
}

export interface TaskProofPayload {
  task_id: string;
  user_id: string;
  text_note?: string;
  attachments?: string[];
}

export interface PingPayload {
  ping_id: string;
  space_id?: string;
  target_user_id?: string;
  created_by: string;
  ping_level: PingLevel;
  category: 'task' | 'event' | 'system' | 'bot' | 'manual';
  title: string;
  message?: string;
  payload_json?: Record<string, unknown>;
  created_at: string;
}

export interface SpaceTask {
  id: string;
  event_id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignee_user_id?: string;
  assignee_role_id?: string;
  proof_required: boolean;
  updated_at: string;
}
