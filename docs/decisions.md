# Decisions

A dated log. Earlier entries predate the generalization into a product - they
are kept because they explain why things are shaped as they are, not because
they still hold. Where a decision was later reversed, the reversing entry says
so. Entries that only described the first deployment's own domains and DNS were
dropped when this became a public repository.


## 2026-05-07: Use GitHub Actions OIDC

Deployments should use GitHub Actions with AWS OIDC. Static AWS keys should not be stored in GitHub.

## 2026-05-07: Separate certificate stack

CloudFront certificates are managed by a separate CloudFormation stack in `us-east-1`.

## 2026-05-07: Name shared correspondence system Inbox/Ärenden

Use `inbox` for DNS and infrastructure names. Use `Ärenden` in Swedish UI copy for the task/ticket/case concept.

## 2026-05-07: Deploy www from master with path filters

Pushes to `master` should deploy `www` only for changed services/webapps. Workflows must use path filters to control GitHub Actions minutes.

## 2026-05-11: Deploy dev from non-master branches

Pushes to any non-`master` branch should deploy `dev` only for changed services/webapps. This gives feature branches a real deployed environment while keeping `master` as the `www` deployment source.

## 2026-06-04: Inbox app architecture (multi-tenant, membership, threading, audit)

The inbox app is a multi-tenant shared inbox (`aws/services/inbox` API in
`eu-north-1` + `aws/web/inbox` SPA). Key decisions:

- **Single-table DynamoDB** `{name}-inbox-data-{env}`: every row org-scoped
  (`${org}:...`), global rows under `ALL:`. `gsi1` doubles as the box/activity
  list index (`${org}:message:${box}` / `${lastActivityAt}#${id}`) and the admin
  email index (`admin-email#${email}`). Multi-tenant from day one (resale).
- **Membership-based auth, any Google account.** Cognito Google IdP authenticates
  anyone; authorization comes from `${org}:admin/{email}` DB rows (managed in the
  Admins UI). The pretoken trigger reads them via the email GSI and emits a signed
  multi-org `orgs` claim (caps + per-org categories + name). No allowlist.
- **Active-org selection via `X-Org` header**, validated against the signed claim
  (the claim is the authority; the header only selects among member orgs). Single-org
  users send nothing.
- **Category permissions enforced server-side** on every message/note path
  (`assertCategoryAllowed`, 404 on miss); scoped admins never see other categories
  even via direct API calls.
- **Threading** via `In-Reply-To`/`References` matched against stored Message-IDs;
  replies thread under the original and bump `lastActivityAt`; a reply reopens a
  finished thread.
- **Append-only audit log** (`${org}:audit`) of all admin mutations; superadmin-only
  view (`audit.read`). Outbound replies sent from the category alias so replies
  thread back.

## 2026-09-01: Generalized into a product; one profile per deployment

Extracted the inbox from the single-tenant system it grew in. 36 hand-maintained
CloudFormation parameters became one profile per deployment, with 14 of them
derived from name + accountId + region + env. Three had previously contained a
pasted AWS account id.

## 2026-09-01: One deployment per AWS account

Only one SES receipt rule set can be active per account per region, so two
deployments sharing an account means deploying one silently stops the other
receiving mail. Not a preference.

## 2026-09-01: Single region eu-north-1, superseding the cross-region split

SES receiving *is* available in eu-north-1 - verified by resolving
`inbound-smtp.eu-north-1.amazonaws.com` and exercising the receipt-rule API.
The original split receiving into eu-west-1 on the opposite assumption. The
`MailBucketRegion` and `InboxTableRegion` parameters are gone.

## 2026-09-01: DNS optional; no domain means CloudFront's own name

Certificates, aliases and Route 53 records are conditional. With no domain the
app is served on `*.cloudfront.net` - still a private S3 bucket behind Origin
Access Control, still HTTPS, which Cognito requires for callbacks.

## 2026-09-01: The router Lambda is deleted

It split `test@` to a dev parse function and everything else to production
within one account. One deployment per account removes that job, and the
forwarded-mail case it also covered is already handled: parse reads the `To:`
header first and falls back to the envelope recipient.

## 2026-09-01: Mail DNS and the SES identity are optional stack resources

Switched by `mail.hostedZoneId`. Empty means the domain is hosted elsewhere and
both are a manual bootstrap. Set means the stack owns them - which is what a
migration of the original deployment would need, since its mail subdomain is in
Route 53 and deleting the old stack would take its records with it.

## 2026-09-01: Localization covers email, not the agent UI

An English deployment's agents are that company's own staff, so English replies
alongside Swedish assignment notifications would be worse than either alone.
The agent web app stays Swedish until a customer's own staff need otherwise.

## 2026-09-01: `main`, and no deploy-on-push

The two entries above (deploy `www` from `master`, `dev` from other branches)
no longer apply. A deployment is a whole AWS account and this repo serves
several, so there is no branch whose push implies a target: deploys are a
manual `workflow_dispatch` taking profile and environment. Push and pull
request run validation only.

Work targets `main`. `master` exists from the first push and is still
validated, but an org-level ruleset requires an approving review on it that
nobody here can currently satisfy or change - so `main` is where work lands
until that is sorted.

## 2026-09-15: Notification defaults are org rows, not deployment profile

Admins can now turn new-issue and reply mail on or off separately, so both
flags need a default for admins who have chosen neither. That default is a
`${org}:settings/notify` row, not a profile key: the profile is deploy-time
infrastructure, one deployment can serve several orgs, and every product
default put there is one more thing a fork must keep in step with upstream.
A superadmin changes it from the Admins page; no redeploy.

Resolution is per-admin value, else org default, else code default. Reply mail
defaults **off** — a deployment nobody has configured should not mail people who
never asked for it. Because unset must therefore mean "inherit" rather than
"on", `null` is a stored value here, and a row written before the split (no
`notifyReply` key at all) keeps its old behaviour until it is next edited.

## 2026-09-24: Spam is a third box, decided by the SES verdict

Inbound spam is tagged, never dropped: a false positive that silently deletes a
customer's mail is far worse than one that files it in the wrong folder. The tag
is a third value of the existing `box` attribute — `inbox`, `archived`, `spam` —
so it inherits the machinery already there: `box` moves the row's `gsi1` list
partition, which means spam disappears from the inbox with no read-side filter
and no new index, and the daily reminder sweep (which queries `box: 'inbox'`)
skips it without a line of code. Un-tagging is the same `PATCH` as
un-archiving. An admin can also mark a message spam by hand.

No spam-filtering library. The receipt rule already has `ScanEnabled: true`, so
SES scans every message and hands the parse Lambda `spamVerdict` and
`virusVerdict` — a detector already running, already paid for, and one that
needs no dependency in a Lambda whose whole point is that it has none.

Only a hard `FAIL` counts. `GRAY` is SES's "maybe" and `PROCESSING_FAILED` is
"no idea"; on a maybe, letting spam through costs less than hiding real mail.
The SPF, DKIM and DMARC verdicts are deliberately not consulted, although they
look like obvious signals: mail reaches the inbox forwarded through a Google
group, which breaks SPF, re-signs over a rewritten `From:` and so fails DMARC
for entirely legitimate senders. Folding them in would file real customer mail
as spam. `test/spam-rule.test.mjs` asserts exactly that, so the trap cannot be
walked into twice.

Spam cannot be deleted permanently without archiving it first — `remove` still
requires `box === 'archived'` — and search still spans every box, spam included.

## 2026-09-24: Webhook push is a user-authored template, off by default

New inbound messages can be pushed to a URL configured per org. The immediate
need is the Basecamp Campfire the Zendesk queue posts to today — the inbox
cannot replace Zendesk until issues show up in the same room — but other
receivers are expected, so the payload is configuration rather than code: a
template of HTML with `{{placeholder}}` names, and a JSON envelope carrying one
`{{content}}`. That pair reaches Campfire, Slack, Teams and Discord without a
deploy, and without a template engine, which a flat message does not need.

The two substitutions escape, and that is the whole safety argument for letting
an admin type HTML: placeholders are HTML-escaped, `{{content}}` is
JSON-escaped, and an unknown placeholder is refused at save time rather than
rendering blank forever. `test/unit/webhook.test.js` holds all three.

**Delivery runs off the table's DynamoDB stream, in the API's own Lambda.** Not
in the parse Lambda, which is inline CloudFormation with no dependencies: it has
no MIME parser, so there would be no message body without hand-rolling one, it
already carries two hand-copied duplicates of service code, and it has no retry.
The stream brings the body, a real test seam and partial-batch retries.

**Reading the stream is off unless the profile asks** (`features.webhook` →
`EnableWebhook`). The stream itself is unconditional because writing records is
free; the reader is not. A Lambda event source mapping polls each shard four
times a second whether or not mail arrives — around $1-2 a month, a floor that
does not scale with volume. Raadalen runs this code in its own account and wants
no webhooks, so it should not pay for one. Gating the reader rather than the
stream also keeps the table's properties unconditional.

Deliberately not built: no list of targets (the settings row is already per org,
and another deployment is another account), no dead-letter queue (the raw MIME
in S3 remains the record, and a missed chat line is not data loss), and no
idempotency keys — delivery is at-least-once and the docs say so.
