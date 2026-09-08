import { dispatch } from './router.js'
import { resolveOrg } from './org.js'
import { requireCapability } from './auth.js'
import * as messages from './messages/admin.js'
import * as admins from './admins/admin.js'
import * as audit from './audit/handler.js'

const wrapAdmin = (cap, fn) => async (ctx) => {
  const claims = requireCapability(ctx.event, ctx.org, cap)
  return fn({ ...ctx, claims })
}

export const buildRoutes = () => ({
  'GET /admin/messages': wrapAdmin('inbox.read', messages.list),
  'GET /admin/messages/search': wrapAdmin('inbox.read', messages.search),
  'GET /admin/assignees': wrapAdmin('inbox.read', messages.listAssignees),
  'GET /admin/categories': wrapAdmin('inbox.read', messages.listCategories),
  'GET /admin/messages/{messageId}': wrapAdmin('inbox.read', messages.detail),
  'GET /admin/messages/{messageId}/raw': wrapAdmin('inbox.read', messages.raw),
  'GET /admin/messages/{messageId}/attachments/{index}': wrapAdmin(
    'inbox.read',
    messages.attachment
  ),
  'PATCH /admin/messages/{messageId}': wrapAdmin('inbox.write', messages.updateStatus),
  'POST /admin/messages/{messageId}/reply': wrapAdmin('inbox.send', messages.reply),
  'POST /admin/messages/{messageId}/notes': wrapAdmin('inbox.write', messages.addNote),
  'POST /admin/messages/{messageId}/transfer': wrapAdmin('inbox.write', messages.transfer),
  'DELETE /admin/messages/{messageId}': wrapAdmin('inbox.write', messages.remove),

  'GET /admin/admins': wrapAdmin('admins.read', admins.list),
  'POST /admin/admins': wrapAdmin('admins.write', admins.create),
  'PATCH /admin/admins/{email}': wrapAdmin('admins.write', admins.update),
  'DELETE /admin/admins/{email}': wrapAdmin('admins.delete', admins.remove),

  'GET /admin/audit': wrapAdmin('audit.read', audit.list)
})

// API Gateway routes admin paths through per-method proxies
// ({GET,POST,PATCH,DELETE} /admin/{proxy+}). Translate any of those into the
// concrete handler routeKey by matching method + rawPath against the route map.
const isProxyAdminRoute = (routeKey) =>
  /^(?:ANY|GET|POST|PATCH|PUT|DELETE) \/admin\/\{proxy\+\}$/.test(routeKey || '')

const matchAdminRoute = (event, routeKeys) => {
  const method = event.requestContext?.http?.method || event.httpMethod
  const rawPath = event.rawPath || event.path
  if (!method || !rawPath) return null
  for (const key of routeKeys) {
    const sp = key.indexOf(' ')
    const m = key.slice(0, sp)
    const pat = key.slice(sp + 1)
    if (m !== method) continue
    if (pat === rawPath) return { routeKey: key, pathParameters: {} }
    if (!pat.includes('{')) continue
    const re = new RegExp('^' + pat.replace(/\{(\w+)\}/g, '(?<$1>[^/]+)') + '$')
    const match = rawPath.match(re)
    if (match) return { routeKey: key, pathParameters: match.groups || {} }
  }
  return null
}

export const createApp = ({ deps }) => {
  const routes = buildRoutes()
  const routeKeys = Object.keys(routes)
  return {
    routes,
    // Exposed so non-HTTP entry points (the scheduled reminder sweep) reuse the
    // same wiring — and the same __setApp test seam.
    deps,
    async handle(event) {
      let resolvedEvent = event
      if (isProxyAdminRoute(event.routeKey)) {
        const matched = matchAdminRoute(event, routeKeys)
        if (matched) {
          resolvedEvent = {
            ...event,
            routeKey: matched.routeKey,
            pathParameters: {
              ...(event.pathParameters || {}),
              ...matched.pathParameters
            }
          }
        }
      }

      const org = resolveOrg(resolvedEvent)
      return dispatch(resolvedEvent, routes, { deps, request: { org } })
    }
  }
}
