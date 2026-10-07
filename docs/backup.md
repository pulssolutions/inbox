# Backup and restore

Backups stay inside the deployment's own account and region. They cover a
mistake, a bug or a bad deploy - not the loss of the account itself. Both
stores keep 35 days of history. The table, the mail bucket and the user pool
have `DeletionPolicy: Retain`, so deleting a stack deletes none of them.

| Data | Store | Recovery |
| --- | --- | --- |
| Threads, notes, assignments, settings, membership, audit | DynamoDB `<prefix>-inbox-data-<env>` | Point-in-time recovery, any second of the last 35 days |
| Message bodies and attachments (raw MIME) | S3 `<prefix>-inbox-mail-<env>-<account>-<region>`, `inbound/` | Versioning; a deleted or overwritten object is kept 35 days |
| Agent sign-in | Cognito user pool | Not backed up. Membership rows are keyed by email, so re-inviting the address restores access |
| Google client secret | SSM | Not backed up. Re-issue it in Google Cloud |

## Restore the table

PITR restores into a **new** table; it never overwrites the live one.

```bash
aws dynamodb restore-table-to-point-in-time \
  --source-table-name <prefix>-inbox-data-<env> \
  --target-table-name <prefix>-inbox-data-<env>-restore \
  --restore-date-time 2026-10-01T12:00:00Z
```

The restored table has no stream and no PITR of its own. Copy the rows you need
back into the live table with `get-item`/`put-item` (or `query` on the `pk`
for a whole org partition), then delete the scratch table. Writing back fires
the webhook again for a `message` row missing from the live table, if the
deployment has it enabled.

## Restore a message body

```bash
aws s3api list-object-versions --bucket <mail bucket> --prefix inbound/<sesMessageId>
# deleted: remove the delete marker
aws s3api delete-object --bucket <mail bucket> --key inbound/<sesMessageId> --version-id <marker id>
# overwritten: copy the old version back on top
aws s3api copy-object --bucket <mail bucket> --key inbound/<sesMessageId> \
  --copy-source "<mail bucket>/inbound/<sesMessageId>?versionId=<version id>"
```

## Erasure

A permanently deleted thread stays recoverable from PITR for up to 35 days.
Its MIME is not deleted with the thread at all - it lives until the
`ops.mailRetentionDays` lifecycle expires it, then 35 more days as a
noncurrent version.
