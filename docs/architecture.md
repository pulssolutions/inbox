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

## Multi-tenancy

Tenants are resolved from the recipient's domain via `ALL:tenant` rows, so one
deployment can serve several domains. Authorization comes from a signed `orgs`
claim built by a Cognito pre-token trigger; the `X-Org` header only *selects*
which member org a request acts on and can never grant access.
