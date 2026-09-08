# Agent Instructions

This repository is a **product**: a shared email support inbox that any company
can deploy into its own AWS account.

The single most important consequence: **nothing company-specific belongs
anywhere except `deployments/<name>.json`**. No account ids, domains, prefixes,
brand strings or email addresses in templates, code, tests or CI.

## Deployment model

Puls owns this repository. A company runs the product from its own copy of it -
a GitHub fork, or a private clone tracking this one as `upstream` - and
configures that copy with the `DEPLOY_PROFILE_JSON` repository variable. So
**nothing a downstream copy must change may live in a tracked file** - that is
what conflicts on every merge from upstream. New files are fine; edits to
shared ones are not.

- One deployment = one AWS account. Only one SES receipt rule set can be active
  per account per region, so two deployments sharing an account means deploying
  one silently stops the other receiving mail.
- One region per deployment, taken from the profile. It must be a region that
  supports SES _receiving_; `profile.mjs` validates this, because sending works
  everywhere and a wrong region otherwise fails as silently bounced mail.
- `dev` and `www` are separate accounts, not separate stacks in one account.

## Rules

- **Derive, don't configure.** If a value follows from name + accountId +
  region + env, compute it in `scripts/profile.mjs`. A parameter a human types
  twice is a parameter that will disagree with itself.
- **Infrastructure as code**, raw CloudFormation. No SAM, no CDK, no Terraform.
- **Deploy through `scripts/deploy.mjs`**, never `aws cloudformation deploy` by
  hand — it guards the target account, activates the SES rule set (which
  CloudFormation cannot do), and redeploys the inbox stack once the web origin
  is known.
- **Never commit secrets.** The Google OAuth secret lives in SSM and is
  resolved at deploy time.
- Set CloudWatch log retention on every log group.
- Keep IAM least-privilege and stack-scoped.
- S3 web buckets stay private behind CloudFront Origin Access Control.

## Things that will bite you

- **Activating a receipt rule set is not a CloudFormation resource.** A stack
  can deploy perfectly green and still drop every message.
- **SES validates action permissions when a rule is created**, not when mail
  arrives — the bucket policy and Lambda permission must already exist.
- **The S3 action must come before the Lambda action.** The Lambda event
  carries headers only; the body is fetched from S3 by message id.
- **ACM validation against a zone whose NS records are not live hangs for
  hours**, then rolls the stack back.
- **Cognito rejects any `redirect_uri` it was not told about**, and the web
  origin is a CloudFront name that does not exist until that stack does. Hence
  the two-pass deploy.
- **The SES sandbox restricts sending only.** Receiving is unrestricted, so the
  whole inbound path is testable before production access is granted.

## Brand artwork

No customer's logo belongs in `aws/web/inbox/src`. A profile points at files
under `deployments/assets/<name>/`; `deploy.mjs` copies them into the web
build's `public/brand/` and passes the paths as Vite env. A profile with no
logo gets the product's own neutral mark, so the app is never wrong - only
unbranded.

## Node version

`.nvmrc` is the single source: mise reads it (via the `[settings]` block in
`mise.toml`), nvm reads it with `nvm use`, and CI reads it through
`node-version-file`. Do not hardcode a version in a workflow.

**Verify against that version, not whatever your shell has.** Three CI
failures in this repo came from local/CI drift, one of them a `node --test`
invocation that only works before Node 22.

## Testing

Write a failing test first where the change has behaviour. The service uses
Vitest with hand-written fakes and no mocking library; profile expansion uses
`node --test`.

Two suites depend on environment and pin it explicitly — the service pins
`LOCALE`, the web app pins its brand vars. Do not remove those pins: without
them, assertions pass or fail depending on what was last deployed.

## Cost

Optimise for near-zero idle cost, and ask before adding anything with a
standing charge. The allowed and ask-first lists are in `docs/cost.md`.
