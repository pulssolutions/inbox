# inbox-service

The HTTP API, Cognito, the DynamoDB table and the daily reminder sweep.

```
api:    HTTP API + Lambda (Cognito JWT, org from the signed claim)
          list/update → DynamoDB
          detail      → S3 GetObject raw MIME → mailparser → body
          reply       → SES SendRawEmail, threaded
cron:   daily sweep → remind whoever owns a ticket left open and quiet
```

## Multi-tenancy

Every row is org-scoped (`pk = {org}:...`); global rows use `ALL:`. The org is
resolved from the recipient's domain on the way in, and from the signed `orgs`
claim on the API. One Cognito pool serves every tenant in the deployment.

Onboarding a tenant is one `ALL:tenant` row plus Cognito users plus their MX —
no per-tenant infrastructure.

## Data model (single table, `pk` / `sk`, one GSI)

| Row | pk | sk |
| --- | --- | --- |
| Tenant | `ALL:tenant` | domain |
| Message | `{org}:message` | messageId |
| Note | `{org}:note` | `{messageId}#{createdAt}` |
| Admin | `{org}:admin` | email |
| Audit | `{org}:audit` | `{ts}#{id}` |

`gsi1` does two jobs. For messages, `{org}:message:{box}` keyed by
`{lastActivityAt}#{id}` — a descending query is the inbox list, and bumping
`lastActivityAt` floats a thread to the top. For admins, `admin-email#{email}`
gives the reverse lookup of every org a person belongs to, which the pre-token
trigger needs.

**Bodies are never stored here.** Inbound bodies are parsed from S3 on demand;
only outbound replies keep their text.

## API

All routes are capability-gated from the signed claim.

| Route | Capability |
| --- | --- |
| `GET /admin/messages?box=&category=` | `inbox.read` |
| `GET /admin/messages/search?q=` | `inbox.read` |
| `GET /admin/messages/{id}` (parses the body, marks read) | `inbox.read` |
| `GET /admin/messages/{id}/raw`, `/attachments/{i}` | `inbox.read` |
| `PATCH /admin/messages/{id}` (`status`/`box`/`state`/`assignee`) | `inbox.write` |
| `POST /admin/messages/{id}/reply` | `inbox.send` |
| `POST /admin/messages/{id}/notes`, `/transfer` | `inbox.write` |
| `DELETE /admin/messages/{id}` (archived only) | `inbox.write` |
| `GET/POST/PATCH/DELETE /admin/admins` | `admins.*` |
| `GET /admin/audit` | `audit.read` |

API Gateway declares only per-method proxy routes, so **adding an endpoint needs
no CloudFormation change** — add a line to `buildRoutes` in `app.js`.

Every handler touching a message goes through `requireMessage`, which applies
category scoping and returns 404 rather than 403 so existence stays hidden. If
you add a handler, call it too.

## Sign-in

Google, or a passwordless email one-time code; both resolve to one account per
email. The native (email) user is canonical — a new admin gets one
auto-provisioned, and the pre-signup trigger links a first Google login onto it.

OTP mail is sent through SES from the deployment's sender address. Cognito's
default sender has deliverability too poor for one-time codes.

## Test and dev

```bash
npm test                 # unit
npm run test:integration # handler + app, still with fakes
npm run lint
npm run dev              # local Express server on :3600, fakes, mock JWT
```

Vitest with hand-written fakes, no mocking library. The suite pins `LOCALE=sv`
in `vitest.config.js` because it asserts the Swedish copy — without the pin it
would depend on the ambient environment.

## Seeding

```bash
export INBOX_PREFIX=<deployment name>
node scripts/seed-tenant.mjs --env dev --domain <domain> --org <slug> --name "<Name>"
INBOX_SEED_PASSWORD='…' node scripts/seed-admin.mjs --env dev --org <slug> --email <email>
```

The password is read from the environment only, never argv. Sign-in is OTP or
Google, so it is never used — Cognito just requires the native user to have one.
