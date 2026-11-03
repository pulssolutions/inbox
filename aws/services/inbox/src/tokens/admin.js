import { createHash, randomBytes } from 'node:crypto'
import { NotFoundError, ValidationError } from '../errors.js'
import { recordAudit } from '../audit.js'
import { orgEntry } from '../caps.js'

const hashOf = (secret) => createHash('sha256').update(secret).digest('hex')

const publicFields = ({
  tokenId,
  name,
  owner,
  createdAt,
  createdBy,
  lastUsedAt
}) => ({
  tokenId,
  name,
  owner,
  createdAt,
  createdBy,
  lastUsedAt: lastUsedAt ?? null
})

export const list = async ({ deps, org }) =>
  (await deps.db.listTokens({ org })).map(publicFields)

export const create = async ({ deps, org, body, claims }) => {
  if (typeof body?.name !== 'string' || body.name.trim() === '') {
    throw new ValidationError('NAME_REQUIRED', 'name required')
  }
  const owner = String(body.owner || '').toLowerCase()
  const admin = owner && (await deps.db.getAdmin({ org, email: owner }))
  if (!admin || admin.active === false) {
    throw new ValidationError('OWNER_INVALID', 'owner must be an active admin')
  }
  const secret = `inbx_${randomBytes(32).toString('base64url')}`
  const token = {
    tokenId: randomBytes(8).toString('hex'),
    name: body.name.trim(),
    owner,
    hash: hashOf(secret),
    createdAt: new Date().toISOString(),
    createdBy: claims?.email || ''
  }
  await deps.db.putToken({ org, token })
  await recordAudit(deps, {
    org,
    claims,
    action: 'token.create',
    targetType: 'token',
    targetId: token.tokenId,
    targetLabel: token.name,
    meta: { name: token.name, owner }
  })
  const { tokenId, name, createdAt } = token
  return { statusCode: 201, data: { tokenId, name, owner, createdAt, secret } }
}

export const remove = async ({ deps, org, pathParameters, claims }) => {
  const tokenId = String(pathParameters?.tokenId || '')
  const existing = await deps.db.getToken({ org, tokenId })
  if (!existing) throw new NotFoundError('TOKEN_NOT_FOUND', 'Token not found')
  await deps.db.deleteToken({ org, tokenId })
  await recordAudit(deps, {
    org,
    claims,
    action: 'token.delete',
    targetType: 'token',
    targetId: tokenId,
    targetLabel: existing.name,
    meta: { name: existing.name, owner: existing.owner }
  })
  return { statusCode: 204 }
}

// Bearer secret -> { org, claims } shaped like a Cognito JWT's, built from the
// owner's LIVE admin row so a demoted or removed owner takes the token with it.
export const resolveToken = async (deps, secret) => {
  if (typeof secret !== 'string' || !secret.startsWith('inbx_')) return null
  const token = await deps.db.getTokenByHash({ hash: hashOf(secret) })
  if (!token) return null
  const { org, owner } = token
  const admin = await deps.db.getAdmin({ org, email: owner })
  if (!admin || admin.active === false) return null
  await deps.db.touchToken({
    org,
    tokenId: token.tokenId,
    lastUsedAt: new Date().toISOString()
  })
  const tenant = (await deps.db.listTenants()).find((t) => t.org === org)
  return {
    org,
    claims: {
      email: owner,
      name: token.name,
      via: 'mcp',
      orgs: JSON.stringify({ [org]: orgEntry(admin, tenant?.name || org) })
    }
  }
}
