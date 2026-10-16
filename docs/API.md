# API reference

Base URL `http://localhost:5000/api`. JSON in/out. Success: `{ "data": ..., "meta"?: ... }`. Error:
`{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details"?: [...], "requestId": "..." } }`.

**Browser clients:** send `credentials: "include"` on every request, call `GET /auth/csrf` once and send the returned token as `X-CSRF-Token` on every POST/PATCH.

```js
const { data } = await (await fetch(`${API}/auth/csrf`, { credentials: 'include' })).json();
const post = (path, body) => fetch(`${API}${path}`, { method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': data.csrfToken }, body: JSON.stringify(body) });
```

Common status codes: 400 `VALIDATION_ERROR`/`INVALID_INPUT` · 401 `UNAUTHENTICATED`/`INVALID_CREDENTIALS` · 403 `FORBIDDEN`/`CSRF_INVALID`/`ACCOUNT_PENDING`/`ACCOUNT_REJECTED`/`ACCOUNT_SUSPENDED` · 404 `NOT_FOUND` · 409 `EMAIL_ALREADY_REGISTERED`/`INVALID_STATE` · 429 `RATE_LIMITED`.

## Public

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{ status, db }` |
| GET | `/meta/options` | `programs`, `workingStatuses`, `categories`, `googleEnabled` |
| GET | `/auth/csrf` | returns `{ csrfToken }`, sets `csrf_token` cookie |

## Auth

### POST `/auth/register` → 201
```json
{ "fullName": "Asha Menon", "email": "asha@example.com", "password": "Str0ngPassw0rd!",
  "phoneCountryCode": "+91", "phoneNumber": "9847012345", "category": "indian",
  "academicYearStart": 2018, "academicYearEnd": 2020, "program": "MCA",
  "workingStatus": "Employed", "companyName": "Acme", "companyWebsite": "https://acme.example.com",
  "linkedinUrl": "https://www.linkedin.com/in/asha" }
```
`program` ∈ `MSc Computer Science | MCA | PGDDSA — Data Science | PGDCS — Cyber Security` (note the em dash) · `workingStatus` ∈ `Employed | Self-employed | Unemployed | Higher Studies` · `category` ∈ `indian | nri`. `companyName` required for Employed/Self-employed. Phone validated per country (libphonenumber). Password ≥ 10 chars with a letter and a number. Unknown keys (e.g. `role`, `approvalStatus`) → 400. Optional `googleIdToken` (then `password` optional, `email` must match the token).
```json
{ "data": { "user": { "id": "665f…", "fullName": "Asha Menon", "email": "asha@example.com", "role": "alumni",
    "approvalStatus": "pending", "accountStatus": "active", "registeredAt": "2026-10-15T09:00:00.000Z", "...": "..." },
  "message": "Registration received. …" } }
```
Duplicate → `409 EMAIL_ALREADY_REGISTERED`. No session is created.

### POST `/auth/login` `{ "email", "password" }` → 200
```json
{ "data": { "user": { "id": "…", "role": "alumni", "approvalStatus": "pending" }, "access": "status-only" } }
```
Sets HTTP-only `alumni_session`. `access` is `"full"` (approved alumni, admins) or `"status-only"` (pending/rejected). Wrong credentials: `401 INVALID_CREDENTIALS` (same for unknown email). Suspended: `403 ACCOUNT_SUSPENDED`.

### POST `/auth/logout` → 200 · GET `/auth/me` → `{ user, access, linkedProviders }`
### POST `/auth/google` `{ "idToken": "<credential>" }`
200 same shape as login · `404 REGISTRATION_REQUIRED` (`details: { email, name }`) · `409 ACCOUNT_LINK_REQUIRED` · `401 INVALID_GOOGLE_TOKEN | GOOGLE_EMAIL_UNVERIFIED` · `503 GOOGLE_NOT_CONFIGURED`.
### POST `/auth/google/link` (signed in) `{ "idToken", "currentPassword" }` → `{ linkedProviders: ["google"] }`
### POST `/auth/forgot-password` `{ "email" }` → always 200 `{ message: "If an account exists …" }` (5/hour/IP)
### POST `/auth/reset-password` `{ "token": "<64 hex from email link>", "password" }` → 200, or `400 INVALID_OR_EXPIRED_TOKEN`. Single use, 30 min, revokes all sessions.
### POST `/auth/change-password` (signed in) `{ "currentPassword", "newPassword" }` → 200; other sessions are signed out.

## Alumni (signed in)

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/alumni/status` | any signed-in | `{ role, approvalStatus, accountStatus, rejectionReason?, registeredAt, approvedAt?, rejectedAt? }` |
| GET | `/alumni/profile` | approved | own profile |
| PATCH | `/alumni/profile` | approved | any subset of: `fullName, phoneCountryCode+phoneNumber (together), category, academicYearStart+academicYearEnd (together), program, workingStatus, companyName, companyWebsite, linkedinUrl` (`null`/`""` clears the company fields). Anything else → 400. |
| GET | `/alumni/notifications?page&limit&unread=true` | any signed-in | own only. `meta.unreadCount` included |
| PATCH | `/alumni/notifications/:id/read` | any signed-in | `{}` body; others' ids → 404 |
| PATCH | `/alumni/notifications/read-all` | any signed-in | `{ data: { updated: n } }` |

Notification: `{ id, type: approval|rejection|account|announcement, audience, title, message, isRead, readAt?, createdAt }`.

## Admin (admin role; checked against the DB on every request)

### GET `/admin/alumni`
Query: `search` (name/email, literal text), `program`, `category`, `workingStatus`, `approvalStatus`, `accountStatus`, `academicYearStart`, `academicYearEnd`, `sortBy` (`registeredAt|fullName|email|academicYearStart|academicYearEnd|program|approvalStatus|category|workingStatus`), `sortOrder` (`asc|desc`), `page` (1…), `limit` (1–100, default 20).
`{ "data": [ …users ], "meta": { "page": 1, "limit": 20, "total": 134, "totalPages": 7 } }`

### GET `/admin/alumni/:id` → `{ user, linkedProviders }` · PATCH `/admin/alumni/:id` (profile fields, audited)
### PATCH `/admin/alumni/:id/approve` `{}` → `{ user }` — from `pending`/`rejected`; else `409 INVALID_STATE`
### PATCH `/admin/alumni/:id/reject` `{ "reason": "≥5 chars" }` — from `pending` only
### PATCH `/admin/alumni/:id/status` `{ "accountStatus": "suspended", "reason": "required when suspending" }` or `{ "accountStatus": "active" }`
Suspension revokes the user's sessions immediately.

### GET `/admin/dashboard/stats?months=12`
```json
{ "data": { "totals": { "registrations": 4, "pending": 1, "approved": 2, "rejected": 1, "indian": 2, "nri": 2 },
  "byProgram": [ { "program": "MCA", "count": 2 } ],
  "byAcademicYear": [ { "academicYearStart": 2018, "academicYearEnd": 2020, "label": "2018-2020", "count": 4 } ],
  "byWorkingStatus": [ { "workingStatus": "Employed", "count": 2 } ],
  "registrationsOverTime": [ { "period": "2026-09", "count": 1 }, { "period": "2026-10", "count": 3 } ] } }
```

### GET `/admin/exports/csv` · GET `/admin/exports/excel`
Same filters/sort as the listing (no pagination) plus `preset` = `filtered`(default) `all approved pending rejected indian nri`. A preset that contradicts an explicit filter → `400 CONFLICTING_FILTER`. Response: `Content-Disposition: attachment; filename="alumni-approved-2026-10-15.csv|xlsx"`, `Cache-Control: no-store`, `X-Export-Row-Count`. Exported columns are an allow-list (no hashes/tokens/sessions/ids); cells starting with `= + - @ TAB CR` are prefixed with `'`. More than `EXPORT_MAX_ROWS` rows → `413 EXPORT_TOO_LARGE`. Every export is audited.

### POST `/admin/notifications`
```json
{ "audience": "user", "userId": "665f…", "type": "account", "title": "Please update your profile", "message": "…" }
{ "audience": "all_approved", "filters": { "program": "MCA", "category": "nri", "workingStatus": "Employed", "academicYearEnd": 2020 },
  "title": "Reunion", "message": "Save the date" }
```
→ `201 { data: { audience, recipients: n } }`. Announcements go only to approved, active alumni (copied per recipient so read-state is individual).

### GET `/admin/activity-logs?page&limit&action&adminId&resourceType&resourceId&from&to`
`{ "data": [ { "id", "admin": { "fullName", "email" }, "action": "alumni.approve", "resourceType": "alumni", "resourceId": "…", "details": {…}, "requestId": "…", "timestamp": "…" } ], "meta": {…} }`
Actions: `alumni.approve`, `alumni.reject`, `alumni.status_change`, `alumni.profile_update`, `notification.send`, `export.csv`, `export.excel`, `admin.bootstrap`. Read-only: no endpoint modifies entries, and the model blocks updates/deletes.
