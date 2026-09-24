# Architecture

Serverless, one region, one AWS account per deployment.

```
sender → alias@mailDomain
  └─ MX → inbound-smtp.<region>.amazonaws.com        (SES receiving)
       └─ receipt rule, two actions IN ORDER:
            1. S3Action   → s3://<mail bucket>/inbound/<sesMessageId>
            2. LambdaAction → parse
                 └─ resolve tenant from recipient DOMAIN  (ALL:tenant row)
                    category   from recipient LOCAL PART
                    thread     from In-Reply-To / References
                 └─ PutItem → DynamoDB ticket row
                 └─ notify the responsible agents (SES)

agent → CloudFront → S3 (Vue app)
      → API Gateway (JWT) → Lambda → DynamoDB
                                   → S3 GetObject + mailparser (body on demand)
                                   → SES SendRawEmail (reply, threaded)

cron (daily) → same Lambda → reminder sweep over open tickets
```

## Why one account per deployment

Only one SES receipt rule set can be **active** per account per region.
Two deployments in one account means activating one deactivates the other, so
a routine dev deploy would stop production receiving mail. This is the
constraint that shapes everything else.

## Why one region

SES receiving is available in a subset of regions; sending is available
everywhere. Putting both in the same region removes cross-region IAM, the
`MailBucketRegion` / `InboxTableRegion` parameters, and a class of failure where
mail is silently bounced because someone chose a sending-only region.
`profile.mjs` rejects a region that cannot receive.

## Data

One DynamoDB table. The organization is part of the partition key
(`{org}:message`, `{org}:admin`, …), so a query cannot return another tenant's
rows — isolation is a property of the key design rather than of a filter
someone might forget to apply. Global rows use an `ALL:` prefix.

Message **bodies are never stored in DynamoDB**. The raw MIME in S3 is the only
copy, parsed on demand. Its lifecycle rule is therefore a retention policy: when
it expires, old threads empty out in the app.

## Pushing messages onwards

Every new inbound message can be posted to a URL the org configures under
**Admin → Settings** — a Basecamp Campfire chatbot, a Slack hook, anything that
takes a JSON POST. Two fields decide what is sent: a **template** of HTML with
`{{placeholder}}` names in it, and a JSON **envelope** carrying one
`{{content}}`. Between them they reach any receiver without a deploy, which is
why there is no per-target code and no template engine.

Both substitutions escape, and that is what makes a field an admin types safe:
placeholders are HTML-escaped, so a subject line cannot become markup in a chat
room, and `{{content}}` is JSON-escaped, so no message can break the request
body. An unknown placeholder is refused when the template is saved.

The push runs off the table's DynamoDB stream, consumed by the same Lambda that
serves the API (`src/stream.js` → `src/webhook/deliver.js`). It is there rather
than in the parse Lambda because the body has to come from the stored MIME, and
only this service has a MIME parser — reading it at push time is also what
strips the Google Groups footer. Spam never fires, and neither does our own
outbound reply.

**Reading the stream is off unless the deployment asks for it**
(`features.webhook` in the profile → `EnableWebhook`). The table always has a
stream, because writing records is free; a reader is not. Lambda polls each
shard four times a second whether or not mail arrives, which is roughly $1-2 a
month for as long as the mapping exists. A deployment that will not use webhooks
should not pay it.

Delivery is at-least-once: a receiver that accepts a post but times out before
answering may see the message twice. Retries are the stream's own, and a failure
fails only its own record, so one unreachable receiver does not re-post the
messages that shared its batch.

## Multi-tenancy

Tenants are resolved from the recipient's domain via `ALL:tenant` rows, so one
deployment can serve several domains. Authorization comes from a signed `orgs`
claim built by a Cognito pre-token trigger; the `X-Org` header only *selects*
which member org a request acts on and can never grant access.
