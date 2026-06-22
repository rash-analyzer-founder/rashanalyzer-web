This folder contains the Chat Auth Challenge–Response server implementation and OpenAPI spec.

Files:
- `openapi.yaml` - OpenAPI v3 description of endpoints: /register, /challenge, /verify, /refresh, /revoke, /message
- `index.js` - Express auth server with PS256 JWT issuance and auth-protected message proxy
- `db.js` - SQLite-backed persistence for users, sessions, and messages
- `data/auth.db` - runtime SQLite database file (created automatically)

Quick start:

```bash
cd server
npm install
cp .env.example .env
# optionally add JWT_PRIVATE_KEY_PEM or JWT_PRIVATE_KEY_PATH
npm start
```

The server supports:
- PS256-signed access tokens
- refresh tokens stored in httpOnly cookies
- persistent users and sessions in SQLite
- auth-protected `/api/v1/message` proxy endpoint for chat sends
- optional HTTPS using `HTTPS_KEY_PATH` and `HTTPS_CERT_PATH`

Security notes:
- Store the signing key in a secure environment or secret manager, not in checked-in source.
- In production, use `HTTPS_KEY_PATH` and `HTTPS_CERT_PATH` or deploy behind TLS.
- Replace the demo SQLite storage with a managed database if you need scaling and durability.
