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
   The set is account-wide and created by the `account` stack; each environment
   adds one rule to it. Deploy `--only account` before any `inbox-mail`.
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
| `DEPLOY_PROFILE` | Which committed profile a push deploys. Not needed when `DEPLOY_PROFILE_JSON` is set - that names itself. |
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
  "environments": { "dev": {} } }
```

## Several environments

`environments` maps a name to that environment's overrides. Each may have its
own web hostname and its own inbound mail domains; anything it does not
override comes from the top level, so a single environment is `{ "dev": {} }`:

```jsonc
"web": { "domain": "inbox.acme.example", "hostedZoneId": "Z0123456789ABCDEFGHIJ" },
"environments": {
  "dev": {
    "mailDomains": ["acme-test.example"],
    "web": { "domain": "inbox-dev.acme.example" }
  },
  "www": {
    "mailDomains": ["mail.acme.example", "support.acme.example"]
  }
}
```

Here `dev` gets its own hostname and answers only for `acme-test.example`;
`www` inherits `inbox.acme.example` from the top level and answers for two
domains. An environment that overrides nothing inherits everything.

The first domain in `mailDomains` is the environment's identity by default: it
is what the inbox sends from, and the one whose DNS the stack manages when
`mail.hostedZoneId` is set. Additional domains are received only — verify their
SES identities and publish their MX records yourself.

**Sending and receiving are separate questions.** SES sends only from a
*verified* identity — Cognito will not even create a user pool without one —
while a receive domain needs no verification at all. An environment that wants
to listen on a domain whose DNS somebody else publishes sets `senderDomain` to
something it can actually send as:

```jsonc
"www": {
  "mailDomains": ["mail.acme.example"],   // received; verify when you can
  "senderDomain": "acme-inbox.example"    // sent from; verified today
}
```

Unlike `mailDomains`, `senderDomain` may be shared: only receiving is exclusive.

**No domain may appear in two environments,** and `profile.mjs --check` refuses
a profile where one does. Every environment's rule lives in the same
account-wide rule set, so SES would match whichever rule came first and the
other environment would silently never see the mail. Two environments that both
inherit the single top-level `mailDomain` are the same mistake, and are refused
the same way — give at least one of them its own `mailDomains`.

`environments` was once a list of names. That form cannot survive this rule —
with nothing to override the one top-level `mailDomain` with, a list is only
ever valid with a single entry — so it is rejected, with the replacement in the
error message.

### Upgrading an existing deployment

Before this change each environment's `inbox-mail` stack owned its own receipt
rule set. Moving to the shared one needs a specific order, because SES refuses
to delete a rule set while it is the active one — do it the obvious way and the
stack update rolls back:

```bash
node scripts/deploy.mjs <profile> --only account          # creates <name>-inbox, empty
aws ses set-active-receipt-rule-set --rule-set-name <name>-inbox
node scripts/deploy.mjs <profile> --only inbox-mail --env dev
```

Between the second and third commands the active rule set has no rules, so
inbound mail bounces for a few minutes. Senders retry, so nothing is lost, but
do not do it during a busy hour. The old `<name>-inbox-<env>` set is deleted by
the third step, once it is no longer active.

Each environment is a full, separate deployment: its own bucket, table, user
pool, CloudFront distribution and certificate. Deploy them one at a time with
`--env`, and note that a second environment's user pool has its own hosted UI
domain, so a Google IdP needs that environment's redirect URI added to the
OAuth client.

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
