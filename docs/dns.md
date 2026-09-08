# DNS

Two independent questions: where mail arrives, and where the web app lives.

## Mail (required)

The mail domain needs an MX record pointing at
`inbound-smtp.<region>.amazonaws.com` (priority 10) and three DKIM CNAMEs for
the SES identity.

Who creates them depends on `mail.hostedZoneId` in the profile:

| Profile | Behaviour |
| --- | --- |
| `mail.hostedZoneId` set | The `inbox-mail` stack owns the SES identity, the MX record and the DKIM CNAMEs. |
| empty | The stack touches none of them. Publish them yourself — see `bootstrap.md`. |

Setting it on an account where the identity already exists **fails the stack**:
SES has no create-if-absent. And with it set, deleting the stack takes mail down
for that domain until it is recreated.

## Web app (optional)

| Profile | Result |
| --- | --- |
| `web.domain` empty | Served on the CloudFront `*.cloudfront.net` name with its default certificate. No DNS, no ACM. |
| `web.domain` + `web.hostedZoneId` | ACM certificate and the alias record are created for you. |
| `web.domain`, no zone | The certificate is created; add its validation record and the alias by hand. |

Even with no domain the app sits behind CloudFront rather than an S3 website
endpoint, for two reasons: the bucket stays private behind Origin Access
Control, and Cognito refuses non-HTTPS callback URLs, which an S3 website
endpoint cannot provide.

**Never point a certificate at a zone whose NS records are not live.** ACM
validation then hangs for hours before the stack rolls back.
