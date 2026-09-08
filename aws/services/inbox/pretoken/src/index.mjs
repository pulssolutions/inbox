// Cognito pre-token-generation trigger for the inbox service.
//
// Authorization is driven entirely by DB membership: a user is a member of an
// org iff a `${org}:admin/{email}` row exists (the Admins UI writes these). We
// look up every such row via the email GSI and emit a multi-org claim. Any
// Google account can authenticate; users with no membership get no claim (the
// API and web reject them).
//
// Emitted claims:
//   - orgs: JSON { [org]: { capabilities, categories, name, active } }
//   - organizationId: the single org (only when the user belongs to exactly one)

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'

const INBOX_CAPS = { inbox: { read: true, write: true, send: true } }
const SUPER_CAPS = {
  inbox: { read: true, write: true, send: true },
  admins: { read: true, write: true, delete: true },
  audit: { read: true }
}

let _docClient = null
export const __setDocClient = (c) => {
  _docClient = c
}
const getDocClient = () => {
  if (_docClient) return _docClient
  _docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))
  return _docClient
}

const queryAll = async (params) => {
  const items = []
  let lastKey
  do {
    const res = await getDocClient().send(
      new QueryCommand({ ...params, ...(lastKey ? { ExclusiveStartKey: lastKey } : {}) })
    )
    for (const it of res.Items || []) items.push(it)
    lastKey = res.LastEvaluatedKey
  } while (lastKey)
  return items
}

const adminRowsForEmail = async (email) => {
  if (!process.env.TABLE_NAME) return []
  try {
    return await queryAll({
      TableName: process.env.TABLE_NAME,
      IndexName: 'gsi1',
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': 'gsi1pk' },
      ExpressionAttributeValues: { ':pk': `admin-email#${email}` }
    })
  } catch {
    return []
  }
}

const orgNameMap = async () => {
  const map = {}
  try {
    const tenants = await queryAll({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': 'pk' },
      ExpressionAttributeValues: { ':pk': 'ALL:tenant' }
    })
    for (const t of tenants) if (t.org) map[t.org] = t.name || t.org
  } catch {
    /* names are best-effort */
  }
  return map
}

export const handler = async (event = {}) => {
  const userAttrs = event?.request?.userAttributes || {}
  const email = userAttrs.email ? String(userAttrs.email).toLowerCase() : null
  if (!email) return event

  const rows = (await adminRowsForEmail(email)).filter((r) => r.active !== false)
  if (rows.length === 0) return event

  const names = await orgNameMap()
  const orgs = {}
  for (const r of rows) {
    if (!r.org) continue
    orgs[r.org] = {
      capabilities: r.role === 'superadmin' ? SUPER_CAPS : INBOX_CAPS,
      categories: r.role === 'superadmin' ? '*' : r.categories || [],
      name: names[r.org] || r.org,
      active: true
    }
  }
  const orgKeys = Object.keys(orgs)
  if (orgKeys.length === 0) return event

  const claims = { orgs: JSON.stringify(orgs) }
  if (orgKeys.length === 1) claims.organizationId = orgKeys[0]

  event.response = event.response || {}
  event.response.claimsOverrideDetails = {
    ...(event.response.claimsOverrideDetails || {}),
    claimsToAddOrOverride: {
      ...(event.response.claimsOverrideDetails?.claimsToAddOrOverride || {}),
      ...claims
    }
  }
  return event
}
