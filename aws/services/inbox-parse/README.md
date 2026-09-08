# inbox-parse

Turns one received email into one ticket row. Invoked by the SES receipt rule
after the raw MIME is already in S3.

## The code is inline in the template

`template.yml` carries the whole function in `Code.ZipFile` — no bundler, no
`node_modules`, nothing but what `nodejs22.x` ships. That keeps this stack
deployable on its own, at one real cost: **three pieces of logic exist twice**
and must be kept in step by hand.

| Inline here | Also lives in |
| --- | --- |
| `notifyRecipients` | `aws/services/inbox/src/notify.js` |
| `buildEmail` | `aws/services/inbox/src/ses.js` |
| the locale string table | `aws/services/inbox/src/strings.js` |

If you change any of those three, change both copies. They will otherwise
drift, and the drift is invisible until someone reads two differently-worded
emails.

## What it does per message

1. Reads the recipient from the `To:` header, falling back to the envelope
   recipient. The header comes first so a deployment fed by a forwarding rule
   still sees the address the sender actually used.
2. **Category** = the local part. **Tenant** = the domain, looked up as an
   `ALL:tenant` row.
3. **An unknown domain is logged and dropped.** There is no fallback org: those
   rows are the allowlist, and a missing one means mail silently does not
   appear. That is the first thing to check when a new deployment receives
   nothing.
4. Threads the message by matching ids from `In-Reply-To` / `References`
   against the `mailMessageId` values stored on previous outbound replies.
5. Writes the row — headers, subject, addresses and the S3 pointer. **The body
   is never copied into DynamoDB.**
6. A reply reopens its thread and bumps `lastActivityAt` so it floats to the
   top of the agent's list.
7. Notifies the agents responsible for the category, best-effort.

## Known gap

A reply does not clear the root's `read` status — only `state` and
`lastActivityAt` change. A customer answering a thread you had already read
shows up as movement in the list rather than as unread.

## Watching it

```bash
aws logs tail /aws/lambda/<prefix>-inbox-parse-<env> --since 10m
```

Each accepted message logs one `inbound-email` line with org, category, sender,
subject and S3 key.
