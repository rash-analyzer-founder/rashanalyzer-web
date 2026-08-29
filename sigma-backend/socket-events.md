# Socket.io event contract

## Core principles
- All socket traffic is namespaced to the space context when relevant.
- Server emits authoritative, normalized payloads.
- Clients should acknowledge actions that impact task state or user safety.
- `ping_level` values are integers in the range `0..3`.

## 1) Task state changes

### Event: `task:state_changed`
Purpose: broadcast a task lifecycle update to all relevant members in a space.

Payload:
```json
{
  "space_id": "sp_123",
  "event_id": "evt_456",
  "task_id": "tsk_789",
  "old_status": "assigned",
  "new_status": "in_progress",
  "actor_id": "usr_001",
  "assignee_user_id": "usr_002",
  "assignee_role_id": null,
  "title": "Inspect Solvothermal Step",
  "updated_at": "2026-08-29T10:00:00Z",
  "source": "task_worker",
  "proof_required": true
}
```

Server-side semantics:
- `pending -> assigned` after assignment.
- `assigned -> in_progress` when work begins.
- `in_progress -> submitted` upon upload/proof creation.
- `submitted -> approved|rejected` by supervisor.

### Event: `task:proof_submitted`
Purpose: notify supervisors immediately after a proof or note is uploaded.

Payload:
```json
{
  "space_id": "sp_123",
  "task_id": "tsk_789",
  "submitted_by": "usr_002",
  "note": "Photograph and summary attached.",
  "attachment_ids": ["att_001", "att_002"],
  "submitted_at": "2026-08-29T10:04:10Z"
}
```

## 2) Emergency pings

### Event: `ping:emergency`
Purpose: escalate a high-priority alert that overrides quiet mode and requires acknowledgment.

Payload:
```json
{
  "space_id": "sp_123",
  "ping_id": "ping_900",
  "target_user_id": "usr_003",
  "created_by": "usr_001",
  "ping_level": 3,
  "category": "event",
  "title": "Emergency: Chemical Transfer Required",
  "message": "Safety escalation triggered by lab lead.",
  "payload_json": {
    "requires_ack": true,
    "loop_alarm": true,
    "vibration": "continuous"
  },
  "expires_at": "2026-08-29T10:15:00Z",
  "created_at": "2026-08-29T10:05:00Z"
}
```

Client behavior:
- Level 3 must override system quiet modes.
- Device should trigger persistent looping audio and continuous vibration until operator acknowledges the alert.
- Client must emit `ping:acknowledge` with `ping_id` when dismissed.

## 3) Bot hooks and verification channel

### Event: `bot:webhook:received`
Purpose: deliver bot event data from a verified bot endpoint to a space.

Payload:
```json
{
  "space_id": "sp_123",
  "bot_id": "bot_88",
  "bot_name": "mof-bot-01",
  "event": "task_status",
  "payload": {
    "task_id": "tsk_789",
    "status": "submitted",
    "source": "bot",
    "proof_url": "https://example.com/report.pdf"
  },
  "received_at": "2026-08-29T10:04:11Z"
}
```

### Event: `bot:verified`
Purpose: indicate that a CS bot has passed approval and is now enabled for WebSocket and API requests.

Payload:
```json
{
  "space_id": "sp_123",
  "bot_id": "bot_88",
  "bot_name": "mof-bot-01",
  "verified_at": "2026-08-29T10:00:00Z",
  "api_token_ready": true,
  "websocket_enabled": true
}
```

## 4) Client emitters

### `task:submit_proof`
```json
{
  "task_id": "tsk_789",
  "user_id": "usr_002",
  "text_note": "Completed filtration and recorded values.",
  "attachments": ["att_001"]
}
```

### `ping:acknowledge`
```json
{
  "ping_id": "ping_900",
  "user_id": "usr_003",
  "acknowledged_at": "2026-08-29T10:06:00Z"
}
```

### `bot:register`
```json
{
  "space_id": "sp_123",
  "bot_name": "mof-bot-01",
  "permissions": ["read:tasks", "write:status", "read:events"],
  "webhook_url": "https://bot.example.internal/webhook"
}
```
