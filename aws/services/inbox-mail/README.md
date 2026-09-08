# inbox-mail

The inbound edge: an SES receipt rule that stores raw MIME to S3 and invokes the
parse Lambda.

```
sender → alias@mailDomain
  └─ MX → inbound-smtp.<region>.amazonaws.com
       └─ receipt rule: S3Action (store) → LambdaAction (parse)
```

## What this stack owns

The inbound bucket and its policy, and the receipt rule set and rule.

DNS and the SES identity are owned **only** when `mail.hostedZoneId` is set in
the profile — see `docs/dns.md`. Otherwise the domain is hosted elsewhere, its
records are a manual bootstrap, and this stack touches neither.

## The activation trap

CloudFormation has `AWS::SES::ReceiptRuleSet` and `AWS::SES::ReceiptRule`, but
**nothing that makes a rule set active**. A stack that deploys perfectly green
and still drops every message is almost always this. `scripts/deploy.mjs` runs
it, and the stack outputs the command:

```bash
aws ses set-active-receipt-rule-set --region <region> --rule-set-name <prefix>-inbox-<env>
```

Only one rule set can be active per account per region — which is why a
deployment gets an account to itself.

## Ordering constraints

- SES validates the S3 grant when the **rule is created**, not when mail
  arrives, so the bucket policy must exist first (`DependsOn`).
- The S3 action comes **before** the Lambda action: the event carries headers
  only, and parse fetches the body from S3 by message id.
- Bucket, rule set and function must share a region — SES will not invoke a
  function in another one.
- Both grants are scoped with `AWS:SourceAccount`.
- The S3 action caps at 40 MB; larger mail is refused at SMTP time.

## Retention

`ops.mailRetentionDays` (default 1825) expires `inbound/`. The raw MIME is the
only copy of message bodies, so this is a retention policy rather than a cleanup
knob: when it expires, old threads empty out in the app. `attachments/` holds
copies made for presigned download and expires after a day.

## Testing inbound

The SES sandbox restricts sending only, so real mail arrives immediately:

```bash
B=$(aws cloudformation describe-stacks --stack-name <prefix>-inbox-mail-<env> \
  --query "Stacks[0].Outputs[?OutputKey=='InboundBucketName'].OutputValue" --output text)
aws s3api list-objects-v2 --bucket $B --prefix inbound/ \
  --query 'sort_by(Contents,&LastModified)[-1].[Key,Size,LastModified]' --output text
aws logs tail /aws/lambda/<prefix>-inbox-parse-<env> --since 5m
```
