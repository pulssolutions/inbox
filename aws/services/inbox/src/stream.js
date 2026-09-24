import { deliver } from './webhook/deliver.js'

// The stream image is DynamoDB's own wire shape. Every attribute this push
// reads - the keys, the sender, the subject, the S3 pointer - is a string, so
// picking the `S` members is the whole unmarshal and `@aws-sdk/util-dynamodb`
// would be a dependency for one line. A row's lists and booleans are simply not
// here, which is also why no template placeholder can name one.
const stringAttributes = (image) => {
  const row = {}
  for (const [name, value] of Object.entries(image)) {
    if (typeof value?.S === 'string') row[name] = value.S
  }
  return row
}

// The org a row belongs to is its partition key's prefix: `${org}:message`.
const orgOf = (pk) => String(pk || '').split(':')[0]

// The event source mapping already filters to INSERT of an inbound, non-spam
// row. These guards repeat it because a filter is configuration and this is the
// rule: an outbound reply or a spam tag must never reach a chat room, whatever
// the mapping says today.
const announceable = (row) =>
  row?.direction === 'inbound' && row.box !== 'spam' && row.pk?.endsWith(':message')

// Consumes DynamoDB stream records and pushes each new inbound message to the
// org's webhook. Returns the partial-batch response, so one unreachable
// receiver does not re-post the records that already succeeded.
export const handleStream = async (deps, event) => {
  const batchItemFailures = []
  for (const record of event?.Records || []) {
    if (record.eventName !== 'INSERT') continue
    const image = record.dynamodb?.NewImage
    if (!image) continue

    const row = stringAttributes(image)
    if (!announceable(row)) continue

    const result = await deliver({ deps, org: orgOf(row.pk), message: row })
    if (result.delivered || !result.error) continue
    // eslint-disable-next-line no-console
    console.error('webhook delivery failed', row.messageId, result.error)
    batchItemFailures.push({ itemIdentifier: record.eventID })
  }
  return { batchItemFailures }
}
