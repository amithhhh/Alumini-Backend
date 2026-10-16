# Alumni Portal — Backend API

Node.js · Express 4 · MongoDB · Mongoose 9 · ES modules. Real persistence, no mocks.
The backend is the source of truth for identity, approval status, permissions and data.

## Quick start

```bash
cd server
npm install
cp .env.example .env            # then edit .env (see "Configuration")
# generate the two secrets (run twice, paste into JWT_SECRET and COOKIE_SECRET):
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

npm run create-admin            # one-time: creates the first administrator (interactive, hidden password prompt)
npm run dev                     # development (auto-restart)      — or —
npm start                       # production
npm test                        # test suite (uses a throw-away MongoDB; see "Testing")
```

Requires Node ≥ 20 and a reachable MongoDB (local `mongod`, Docker `docker run -p 27017:27017 mongo:7`, or Atlas).
Health check: `GET /api/health`. Full endpoint reference: [docs/API.md](docs/API.md).

## Architecture

```
src/
  config/       env.js (validated env vars, fails fast), db.js (connect + build indexes)
  models/       User, ExternalIdentity, Notification, AdminActivityLog (append-only), PasswordResetToken
  validators/   zod schemas (strict: unknown keys rejected => no mass assignment)
  middleware/   requestId, noSqlGuard, csrf, auth (authenticate / requireAdmin / requireApprovedAlumni),
                validate, rateLimit, errorHandler
  services/     business logic: auth, alumni (filters, approval, profile), notification, stats, export,
                audit, google (ID-token verification), mail, password (Argon2id), token (JWT/CSRF/reset)
  controllers/  thin HTTP adapters       routes/  URL -> middleware -> controller wiring
  scripts/      create-admin.js (one-time bootstrap)
  app.js        createApp() (no listen; used by tests)      server.js   process entry point
tests/          Vitest + Supertest
```

Request pipeline: `requestId → helmet → CORS → JSON(20kb) → cookies → rate limit → NoSQL guard → CSRF → router → (authenticate → authorize → validate) → controller → service → Mongoose`. Errors end in one handler returning `{ error: { code, message, details?, requestId } }`.

### Session strategy (and why)

* A signed **JWT in an HTTP-only, `SameSite=Lax`, `Secure`-in-production cookie** (`alumni_session`, default 12 h). JavaScript can never read it.
* The JWT carries only the user id and a `tokenVersion`. **On every protected request the user is re-loaded from MongoDB** and `role`, `approvalStatus` and `accountStatus` are taken from the database — never from the token or the client. A rejection or suspension therefore takes effect on the very next request.
* **Revocation:** incrementing `User.tokenVersion` invalidates every live session. This happens on suspension, password reset and password change.
* **CSRF** (every non-GET request): double-submit token. `GET /api/auth/csrf` returns a token and sets a `csrf_token` cookie; the client echoes the token in `X-CSRF-Token`. The token is HMAC-signed with `COOKIE_SECRET`, so a planted cookie can't be forged, and the `Origin` header (if present) must be in `CLIENT_URL`. Works cross-origin because the token is read from the JSON body, not `document.cookie`.

### Access levels

| State | Login | `/auth/me`, `/alumni/status`, `/alumni/notifications` | Profile & other alumni APIs | Admin APIs |
|---|---|---|---|---|
| alumni `pending` | ✅ status-only session (`access: "status-only"`) | ✅ | ❌ 403 `ACCOUNT_PENDING` | ❌ |
| alumni `rejected` | ✅ status-only | ✅ (sees reason) | ❌ 403 `ACCOUNT_REJECTED` | ❌ |
| alumni `approved` | ✅ `access: "full"` | ✅ | ✅ | ❌ |
| `suspended` | ❌ 403 `ACCOUNT_SUSPENDED`; live sessions revoked | ❌ | ❌ | ❌ |
| `admin` (active) | ✅ | ✅ | ❌ (alumni only) | ✅ |

Pending/rejected users get a *status-only* session purely so the frontend can show "awaiting approval" / the rejection reason. It grants no protected data.

### Google Sign-In / One Tap

`POST /api/auth/google` takes the Google **ID token** (the `credential` from either the Sign-In button or One Tap). The server verifies signature, audience (`GOOGLE_CLIENT_ID`), issuer, expiry and `email_verified` with `google-auth-library`, and uses the immutable **`sub`** as identity (stored in `ExternalIdentity`, unique on `{provider, subject}`).

* Known `sub` → normal login rules above (approval is still enforced).
* Unknown `sub`, no account with that email → `404 REGISTRATION_REQUIRED` (with the Google email/name to pre-fill). Register via `POST /api/auth/register` including `googleIdToken` (password optional; the registration email must equal the verified Google email). The account is created **pending** like any other.
* Unknown `sub`, but an account with that email exists → `409 ACCOUNT_LINK_REQUIRED`. **No automatic merge.** The user signs in with their password, then calls `POST /api/auth/google/link` (session + CSRF + current password + Google token).
* If `GOOGLE_CLIENT_ID` is empty, Google endpoints return `503 GOOGLE_NOT_CONFIGURED`; everything else works.

### Approval workflow

Approve / reject / suspend are single atomic `updateOne`s whose filter contains the expected current state (`pending → approved|rejected`, `rejected → approved`, `active ↔ suspended`), so repeated or concurrent clicks cannot double-apply (a second attempt returns `409 INVALID_STATE`). Each action then writes the in-app notification and an audit entry. See "Known limitations" for transactions.

### Security checklist (what is implemented)

Argon2id hashing · strict zod validation on every input (params, query, body) · `role`/`approvalStatus` never accepted from clients (unknown keys → 400) · operator-injection guard + flat query parser · regex input escaped for search · Helmet · restricted CORS · rate limits (global, auth, forgot/reset password) · generic login/forgot-password responses with timing equalisation · single-use SHA-256-hashed reset tokens (30 min) · reset/change password revokes sessions · CSV/Excel formula-injection neutralisation · export field allow-list · append-only audit log with secret scrubbing · export fails closed if the audit write fails · env validation at start-up (min 32-char secrets) · no endpoint can create an admin.

## Configuration

All variables are documented in [.env.example](.env.example). Required: `MONGODB_URI`, `JWT_SECRET`, `COOKIE_SECRET` (distinct, ≥ 32 chars). Optional with graceful fallback: `GOOGLE_CLIENT_ID` (empty → Google disabled), `SMTP_*` (empty → emails are *not delivered*; in development the reset link is printed to the console). In production behind a proxy set `TRUST_PROXY=1` so rate limiting sees real client IPs. If the frontend is on a different **site** (not just origin), set `COOKIE_SAMESITE=none` (forces `Secure`).

Google setup: Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web); add your frontend origin under *Authorised JavaScript origins*; copy the client ID to `GOOGLE_CLIENT_ID` (and use the same ID in the frontend).

## Bootstrapping the first administrator

`npm run create-admin` prompts for name, email and a hidden password (≥ 12 chars), creates the admin, writes an audit entry, and **refuses to run again** once any admin exists. There is deliberately no HTTP route for this. For automation set `ADMIN_BOOTSTRAP_NAME/EMAIL/PASSWORD` (don't leave them in your environment afterwards).

## Testing

```bash
npm test                                                   # in-memory MongoDB (downloads a mongod binary on first run)
TEST_MONGODB_URI=mongodb://127.0.0.1:27017/alumni_portal_test npm test   # or an existing instance
```

Tests never touch real data: they use a throw-away in-memory MongoDB, or `TEST_MONGODB_URI` whose database name **must end in `_test`** (otherwise the suite refuses to run). 80 tests cover registration, duplicates, validation, hashing, login errors, pending/rejected/approved access, admin protection, Google verification and approval enforcement, password-reset expiry/single-use, profile ownership and mass-assignment, approval/rejection, notifications, stats, CSV/Excel exports, formula injection and audit logging.

## Known limitations / production notes

* **No multi-document transactions.** State changes are single-document atomic; the notification and audit entry follow as separate writes. If either fails after the state change, the error is logged (`AUDIT WRITE FAILED`) rather than reverting the approval. On a replica set you can wrap `approve/reject` in `session.withTransaction()` if you need all-or-nothing. Exports are the exception: the audit entry is written *first* and the export is refused if that fails.
* Registration reveals whether an email is already registered (409). Hiding that would require email-verification-first signup.
* Alumni cannot change their email via the profile API (identity field); admins would do that with a dedicated, audited process.
* Rate limits use the in-memory store (per process). Use a shared store (e.g. `rate-limit-redis`) when running several instances.
* Grant the application DB user only the rights it needs; for stronger audit immutability, deny `update`/`remove` on `adminactivitylogs` at the database-role level (the app layer already blocks it).
* Google One Tap nonce binding is not implemented (the ID token's audience/expiry/signature are verified).
