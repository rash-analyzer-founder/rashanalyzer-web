# Sigma Architecture Overview

## 1. System layout

The application follows a layered architecture: client app, API gateway, business logic, persistence, and event distribution.

- Client layer: Expo React Native app on local network devices.
- API layer: Express endpoints for auth, space management, task submission, bot verification.
- Data layer: SQLite with WAL mode for local persistence and fast read/write throughput.
- Event layer: Socket.io for live task updates, pings, and bot integration.

## 2. Core domain model

### Spaces
A space is an isolated collaboration unit. Each space maintains its own roles, channels, events, tasks, and bot registry.

### Roles and permissions
Role priority uses a lower integer as a stronger authority, matching the requirement:

- `0` owner / system admin
- `1` supervisor / lead
- `2` manager / moderator
- `3` member / contributor

The permission flags are stored as booleans and evaluated server-side before mutating restricted state.

### Channels and groups
- `channel_groups`: high-level categories like Research, Operations, Safety.
- `channels`: actual communication endpoints of type `text`, `voice`, or `video`.
- DMs are tracked separately and are not tied to a space.

### Events and tasks
Events are scheduled activities that can be lab, sports, competition, celebration, or custom. Each event owns multiple tasks with either a user or role assignment.

### Pings
The ping matrix is a 4-tier system mapped to notification behavior:

- `0` Meh: silent unread badge only.
- `1` Normal: chime + default vibration.
- `2` Urgent: double chime + high-priority vibration.
- `3` Emergency: override quiet mode, looping alarm, continuous vibration, acknowledgment required.

### Bot verification
A CS bot is registered with a manifest, a server-generated verification token, and a human admin approval route. Once verified, the bot gains a WebSocket enablement flag and API token.

## 3. State machines

### Task lifecycle state machine
```text
pending
  -> assigned
  -> in_progress
  -> submitted
  -> approved
  -> rejected
  -> blocked
```
Transitions:
- `pending -> assigned` when a user or role is assigned.
- `assigned -> in_progress` when work starts.
- `in_progress -> submitted` after proof or attachment upload.
- `submitted -> approved|rejected` after supervisors review.
- `in_progress|submitted -> blocked` if the task is paused or safety risk occurs.

### Ping state machine
```text
queued
  -> active
  -> acknowledged
  -> expired
```
Behavior by level:
- `0`: enters `active` without sound or vibration.
- `1`: emits chime and one vibration pattern.
- `2`: emits priority tones and a stronger vibration.
- `3`: escalates to `alarm` and requires explicit acknowledgment.

### Bot verification state machine
```text
pending
  -> verified
  -> enabled
  -> revoked
```
State changes are triggered by `/api/bots/verify` and can be revoked by admins later when policy or security criteria fail.

## 4. API exposure

### Auth and membership
- `POST /api/auth/login`
- `POST /api/spaces`
- `POST /api/spaces/:space_id/members`
- `PATCH /api/spaces/:space_id/members/:member_id/role`

### Event and task endpoints
- `GET /api/spaces/:space_id/events`
- `POST /api/spaces/:space_id/events`
- `POST /api/events/:event_id/tasks`
- `PATCH /api/tasks/:task_id`
- `POST /api/tasks/:task_id/proofs`

### Bot verification
- `POST /api/bots/register`
- `GET /api/bots/verify?token=...`
- `POST /api/bots/:bot_id/revoke`

## 5. Security principles
- All writes must evaluate RBAC permission flags.
- Verification links use one-time UUID tokens.
- API tokens are stored as hashes; raw tokens are exposed only once during verification.
- File uploads should be stored outside the SQLite DB under isolated media folders.
- Local network deployments should bind only to LAN interfaces and avoid public exposure.

## 6. Local-network deployment pattern
- Backend binds to `0.0.0.0` on a LAN-local port such as `3000`.
- Expo app uses the LAN IP of the host machine, e.g. `http://192.168.1.20:3000`.
- Use service discovery or a `.env` config to avoid hard-coded IP drift.
- Ensure SQLite file is stored in a durable folder such as `./data/sigma.db`.
