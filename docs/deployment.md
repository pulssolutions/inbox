# Deployment

```bash
node scripts/deploy.mjs <profile> [--env dev] [--only <stack>] [--dry-run]
```

Stacks run in dependency order: `shared` → `inbox` → `inbox-parse` →
`inbox-mail` → `web`. `account` and `billing` are one-time and only run with
`--only`.

Start with `--dry-run`. It prints every parameter for every stack and changes
nothing.

## What the script does that CloudFormation cannot

1. **Refuses the wrong account.** Compares `sts get-caller-identity` with the
   profile before anything runs.
2. **Activates the SES receipt rule set.** There is no CloudFormation resource
   for this. Without it a stack deploys perfectly green and drops every message.
3. **Deploys the inbox stack twice.** The web app's origin is a CloudFront name
   that does not exist until the web stack does, and Cognito rejects any
   `redirect_uri` it was not told about. The second pass registers it. On a
   partial run it reads the already-deployed Lambda keys off the stack rather
   than rebuilding.
4. **Builds the web app from stack outputs.** API URL and Cognito ids are
   written to `.env.local` at build time, so nothing per-account is committed.

## Parameters

There are no `parameters-*.json` files. `scripts/profile.mjs` expands the
profile into per-stack overrides, deriving every bucket name, table name, ARN
and function name from `name + accountId + region + env`.

```bash
node scripts/profile.mjs <profile> <stack> [env]   # see what a stack receives
node scripts/profile.mjs <profile> --stacks
```

## CI

One workflow per stack, each with its own path filter:

| Workflow | Deploys | On push to `main` |
| --- | --- | --- |
| `deploy-shared.yml` | artifact bucket | `aws/shared/**` |
| `deploy-inbox-service.yml` | API, Cognito, table | `aws/services/inbox/**` |
| `deploy-inbox-parse.yml` | parse Lambda | `aws/services/inbox-parse/**` |
| `deploy-inbox-mail.yml` | receipt rule, bucket | `aws/services/inbox-mail/**` |
| `deploy-inbox-web.yml` | web app | `aws/web/inbox/**` |
| `deploy-account.yml` | OIDC role, CloudTrail | dispatch only |
| `deploy-billing.yml` | budget | dispatch only |

The logic lives once in `_deploy.yml`, which the seven call. They are thin on
purpose: seven copies of the same fifty lines drift apart.

`account` and `billing` never deploy on push. They are account-wide bootstrap,
and `account` creates the very role CI assumes - its first run has to be local.

### Repository variables

| Variable | Effect |
| --- | --- |
| `DEPLOY_PROFILE_JSON` | The whole profile as JSON. Wins over any committed file. |
| `DEPLOY_PROFILE` | Which committed profile a push deploys. Required unless `DEPLOY_PROFILE_JSON` is set. |
| `AWS_DEPLOY_ROLE_ARN` | Role to assume. Optional - derived from the profile otherwise. |

A dispatch run can override profile and environment per run.

## Running your own deployment

This repository is the product. A company runs it from its own copy, which
keeps the upstream link so fixes arrive as a merge rather than a copy-paste.

Use GitHub's fork button if a public copy is fine. If yours must be **private**,
fork it with git instead - a GitHub fork of a public repository is always
public:

```bash
git clone git@github.com:you/your-inbox.git && cd your-inbox
git remote add upstream https://github.com/pulssolutions/inbox.git
git fetch upstream && git merge upstream/main
```

Either way, configure it entirely through the `DEPLOY_PROFILE_JSON` repository
variable:

```jsonc
// repository variable in your copy - not committed anywhere
{ "name": "acme", "accountId": "444455556666", "region": "eu-west-1",
  "mailDomain": "mail.acme.example", "notificationEmail": "ops@acme.example",
  "org": { "slug": "acme", "name": "Acme Ltd" },
  "github": { "owner": "acme", "repo": "acme-inbox" },
  "environments": ["dev", "www"] }
```

**Why a variable rather than a committed file.** A copy that edits a tracked
file to configure itself conflicts on that file at every merge from upstream.
Holding the profile in a repository variable leaves no tracked configuration at
all, while `profile.mjs` validates it exactly as it validates a committed one -
a malformed profile still fails before anything deploys.

Extra code of your own belongs in directories upstream does not have, so those
never conflict either. Brand artwork is the usual case: commit it under
`deployments/assets/<name>/` and point the profile at it.

You still need your own AWS account, your own `account` stack for the OIDC
role, and your own DNS. Nothing is shared between deployments but the code.

`validate.yml` runs on every push and PR with **no AWS credentials** — cfn-lint
rather than the CloudFormation API, the full test suites, and a check that every
committed profile expands for every stack.

## Reading a deployment's state

Nothing about a live deployment is committed. Query it:

```bash
aws cloudformation describe-stacks --stack-name <name>-inbox-service-<env> \
  --query 'Stacks[0].Outputs'
aws ses describe-active-receipt-rule-set --query 'Metadata.Name'
```
