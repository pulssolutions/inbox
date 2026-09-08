# Security

## Access

- Deploy from GitHub Actions via OIDC, never static AWS keys.
- IAM least-privilege, stack-scoped. The deploy role is limited to resources
  carrying the deployment's prefix.
- Agents authenticate with Cognito — email one-time code, or Google if the
  profile configures it. Both resolve to one account per email address.
- CloudTrail is on for the account; every log group has a retention setting.

## Authorization

Capabilities live in a signed `orgs` claim built by the pre-token trigger from
DynamoDB membership. Two rules matter:

- The `X-Org` header **selects** which member org a request acts on; it can
  never grant access, because the capability check re-reads the signed claim.
- Category scoping returns **404, not 403**, so an out-of-scope admin cannot
  probe for the existence of tickets they may not see.

The web app's `can()` checks mirror the server's, but they are UX only — the
API is the authority.

## Personal data

This system stores other people's email. That is its whole purpose, and it is
the main privacy consideration.

- **Raw MIME in S3** is the only copy of message bodies and attachments. Its
  lifecycle rule (`ops.mailRetentionDays`, default 1825) is therefore a
  retention policy, not a cleanup knob: expiry empties old threads in the app.
  Set it to whatever the deployment's retention obligation actually is.
- **DynamoDB** holds headers, subjects, addresses and internal notes.
- **Deletion**: an agent can permanently delete a whole thread, but only after
  archiving it. There is no automated erasure workflow — a subject-access or
  erasure request is handled by finding the thread and deleting it.
- Extracted attachments are copied to `attachments/` for presigned download and
  expire after one day.
- Buckets are private, encrypted at rest, and blocked from public access. The
  web bucket is reachable only through CloudFront Origin Access Control.

## Mail

- SES scans inbound for spam and viruses; the verdicts are in the stored MIME.
- Outbound is DKIM-signed via the verified domain identity.
- Until SES production access is granted, sending reaches only verified
  addresses — a sandbox, not a security control.
