# Email

## Receiving

MX for the mail domain points at `inbound-smtp.<region>.amazonaws.com`. The
active receipt rule matches the whole domain and runs two actions, in order:

1. **S3** — the raw MIME lands under `inbound/<sesMessageId>`.
2. **Lambda** — parse is invoked asynchronously.

The order is load-bearing. The Lambda event carries headers only; parse fetches
the body from S3 by message id, so it has to already be stored.

From one inbound message parse derives:

- **category** — the recipient's local part. `billing@` makes a ticket in
  `billing`. There is no queue configuration anywhere; adding a queue is adding
  an email alias.
- **tenant** — the recipient's domain, via an `ALL:tenant` row. No fallback: an
  unknown domain is logged and dropped rather than stored under a junk org.
  Those rows are the allowlist.
- **thread** — ids from `In-Reply-To` and `References`, matched against the
  `mailMessageId` values stored on previous outbound messages.

Parse prefers the `To:` header over the envelope recipient, so a deployment fed
by a forwarding rule still sees the address the sender actually used.

## Sending

Replies go out from the **ticket's category alias**, not from the configured
sender — a reply on a `billing` ticket comes from `billing@yourdomain`, so the
customer's response lands back in the same queue.

`SendRawEmail` is used rather than `SendEmail` because it is the only way to set
`In-Reply-To` and `References` alongside an HTML part. SES's returned
`MessageId` is stored back on the outbound row as
`<id@region.amazonses.com>` — **this is exactly what parse matches on later**.
Change that format and inbound replies stop threading.

## Language

`LOCALE` (from the profile) selects the language of every generated email:
customer-facing chrome, agent notifications and reminders. The reply body is
whatever the agent typed and is never translated. The agent web app is separate
and currently Swedish only.

The parse Lambda is inline in its template and cannot import `src/strings.js`,
so it carries its own copy of the table. The two must be kept in step by hand.

## The sandbox

The SES sandbox restricts **sending only** — to verified addresses, 200 a day.
Receiving is unrestricted, so the entire inbound pipeline is testable on day
one. Production access is requested per account and per region.

## Reminders

A daily sweep emails whoever is responsible for a ticket that has been open and
quiet for 24 hours: the assignee if there is one, otherwise every agent
covering its category. At most five reminders per silence, and any activity on
the thread resets the count.
