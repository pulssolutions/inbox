import {
  ValidationError,
  ConflictError,
  NotFoundError
} from '../errors.js'
import { recordAudit } from '../audit.js'

const VALID_ROLES = new Set(['superadmin', 'admin'])
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const normalizeCategories = (role, categories) => {
  // Superadmins implicitly see all categories; we don't store a list for them.
  if (role === 'superadmin') return []
  if (!Array.isArray(categories)) return []
  return categories.filter((c) => typeof c === 'string' && c.length > 0)
}

const validateCreate = (body) => {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('BODY_REQUIRED', 'Body required')
  }
  if (typeof body.email !== 'string' || !EMAIL_RE.test(body.email)) {
    throw new ValidationError('EMAIL_INVALID', 'Valid email required')
  }
  if (typeof body.name !== 'string' || body.name.trim() === '') {
    throw new ValidationError('NAME_REQUIRED', 'name required')
  }
  if (!VALID_ROLES.has(body.role)) {
    throw new ValidationError('ROLE_INVALID', 'role must be superadmin or admin')
  }
  assertNotifyFlag(body.notifyNewIssue)
}

// Per-admin opt-out of new-issue/reply mail (default true). Optional everywhere.
const assertNotifyFlag = (v) => {
  if (v !== undefined && typeof v !== 'boolean') {
    throw new ValidationError('NOTIFY_INVALID', 'notifyNewIssue must be a boolean')
  }
}

const isActiveSuper = (a) => a.active !== false && a.role === 'superadmin'

// Guard: never let the last active superadmin be removed or demoted/disabled.
const assertNotLastSuperadmin = async (deps, org, email, next) => {
  const all = await deps.db.listAdmins({ org })
  const activeSupers = all.filter(isActiveSuper)
  const wasSuper = activeSupers.some((a) => a.email === email)
  if (!wasSuper) return
  const stillSuper = next && next.active !== false && next.role === 'superadmin'
  if (activeSupers.length === 1 && !stillSuper) {
    throw new ConflictError('LAST_SUPERADMIN', 'Cannot remove the last superadmin')
  }
}

export const list = async ({ deps, org }) => deps.db.listAdmins({ org })

export const create = async ({ deps, org, body, claims }) => {
  validateCreate(body)
  const email = body.email.toLowerCase()
  if (await deps.db.getAdmin({ org, email })) {
    throw new ConflictError('ADMIN_EXISTS', `Admin ${email} already exists`)
  }
  const admin = {
    email,
    name: body.name,
    role: body.role,
    categories: normalizeCategories(body.role, body.categories),
    notifyNewIssue: body.notifyNewIssue !== false,
    active: true,
    addedBy: claims?.email || claims?.name || 'okänd'
  }
  // Provision the native Cognito user first so the new admin can sign in with an
  // email one-time code immediately (and Google can link to it). Idempotent, so
  // a retry after a later failure is safe. Done before the DB write so a failure
  // here leaves no half-created admin row.
  await deps.cognito?.ensureNativeUser({ email })
  await deps.db.putAdmin({ org, admin })
  await recordAudit(deps, {
    org,
    claims,
    action: 'admin.create',
    targetType: 'admin',
    targetId: email,
    targetLabel: email,
    meta: { role: admin.role, categories: admin.categories }
  })
  return { statusCode: 201, data: await deps.db.getAdmin({ org, email }) }
}

export const update = async ({ deps, org, pathParameters, body, claims }) => {
  const email = String(pathParameters?.email || '').toLowerCase()
  const existing = await deps.db.getAdmin({ org, email })
  if (!existing) throw new NotFoundError('ADMIN_NOT_FOUND', `Admin ${email} not found`)

  const role = body?.role !== undefined ? body.role : existing.role
  if (!VALID_ROLES.has(role)) {
    throw new ValidationError('ROLE_INVALID', 'role must be superadmin or admin')
  }
  assertNotifyFlag(body?.notifyNewIssue)
  const next = {
    ...existing,
    ...(body?.name !== undefined ? { name: body.name } : {}),
    ...(body?.active !== undefined ? { active: body.active } : {}),
    role,
    categories: normalizeCategories(
      role,
      body?.categories !== undefined ? body.categories : existing.categories
    ),
    // Backfill legacy rows lacking the flag (treat as opted-in).
    notifyNewIssue:
      body?.notifyNewIssue !== undefined
        ? body.notifyNewIssue
        : existing.notifyNewIssue !== false,
    email
  }
  await assertNotLastSuperadmin(deps, org, email, next)
  await deps.db.putAdmin({ org, admin: next })
  await recordAudit(deps, {
    org,
    claims,
    action: 'admin.update',
    targetType: 'admin',
    targetId: email,
    targetLabel: email,
    meta: { role: next.role, categories: next.categories, active: next.active }
  })
  return deps.db.getAdmin({ org, email })
}

export const remove = async ({ deps, org, pathParameters, claims }) => {
  const email = String(pathParameters?.email || '').toLowerCase()
  const existing = await deps.db.getAdmin({ org, email })
  if (!existing) throw new NotFoundError('ADMIN_NOT_FOUND', `Admin ${email} not found`)
  await assertNotLastSuperadmin(deps, org, email, null)
  await deps.db.deleteAdmin({ org, email })
  await recordAudit(deps, {
    org,
    claims,
    action: 'admin.delete',
    targetType: 'admin',
    targetId: email,
    targetLabel: email,
    meta: { role: existing.role }
  })
  return { statusCode: 204 }
}
