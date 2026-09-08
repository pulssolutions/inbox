# Bootstrap a new deployment

Everything here is once per company. After it, deploys are
`node scripts/deploy.mjs <profile>`.

## 1. An AWS account of its own

Not a stack in an existing account — see `architecture.md`. In an
Organization, "Add account" is enough; it inherits the payer's billing.

Check no inherited Service Control Policy denies IAM, SES or Route 53 there.

## 2. The profile

Copy an existing file in `deployments/` and edit it. Required: `name`,
`accountId`, `region`, `mailDomain`, `notificationEmail`, `org.slug`,
`org.name`, `github.owner`, `github.repo`.

```bash
node scripts/profile.mjs <name> --check
```

## 3. The mail domain

Two paths, and the profile's `mail.hostedZoneId` picks between them.

**The domain's DNS is in Route 53 in this account** — set `mail.hostedZoneId`
and the `inbox-mail` stack creates the SES identity, the MX record and the DKIM
CNAMEs for you. Nothing manual.

**The domain is hosted anywhere else** (the common case) — leave it empty and
do this by hand, because only the domain's owner can publish these records:

```bash
aws sesv2 create-email-identity --email-identity <mailDomain>
aws sesv2 get-email-identity --email-identity <mailDomain> \
  --query 'DkimAttributes.Tokens'          # publish these three as CNAMEs
```

Then point the domain's MX at `inbound-smtp.<region>.amazonaws.com`,
priority 10.

> Repointing MX moves **all** mail for that domain. If staff mailboxes use it,
> receive on a subdomain instead and forward into it.

Verify before deploying:

```bash
host -t MX <mailDomain>
aws sesv2 get-email-identity --email-identity <mailDomain> \
  --query '{Verified:VerifiedForSendingStatus,Dkim:DkimAttributes.Status}'
```

## 4. Account stack

The only deploy that needs local admin credentials. Creates the GitHub OIDC
provider, the deploy role and CloudTrail:

```bash
node scripts/deploy.mjs <profile> --only account
```

`GitHubOwner`/`GitHubRepository` must match the repo exactly — the trust policy
is pinned to it, and a mismatch means Actions cannot assume the role.

Cognito sends through a service-linked role the deploy role may not create, so
once per account:

```bash
aws iam create-service-linked-role --aws-service-name email.cognito-idp.amazonaws.com
```

Optional budget alarm: `node scripts/deploy.mjs <profile> --only billing`
(us-east-1; Budgets is not in every region).

## 5. Everything else

```bash
node scripts/deploy.mjs <profile>
```

Order, activation of the receipt rule set, the web build and the second Cognito
pass are all handled. Expect ~20 minutes on a first run — CloudFront dominates.

## 6. Seed the tenant and the first admin

```bash
export INBOX_PREFIX=<name>
cd aws/services/inbox
node scripts/seed-tenant.mjs --env dev --domain <mailDomain> --org <org.slug> --name "<org.name>"

INBOX_SEED_PASSWORD='<random, never used - sign-in is OTP or Google>' \
node scripts/seed-admin.mjs --env dev --org <org.slug> --email <you>
```

Without the tenant row, inbound mail is logged and dropped — the `ALL:tenant`
rows are the allowlist.

## 7. SES production access

Until granted, sending only reaches verified addresses; receiving is
unrestricted, so test inbound immediately and request access in parallel. It is
per account and per region.

```bash
aws sesv2 put-account-details --help    # or the SES console
```

To test replies before it lands, verify the recipients you use:
`aws sesv2 create-email-identity --email-identity <you>`.
