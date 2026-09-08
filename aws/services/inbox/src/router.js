import { NotFoundError, ValidationError, errorToResponse } from './errors.js'

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS'
}

const jsonResponse = (statusCode, data) => {
  if (statusCode === 204 || data === undefined) {
    return { statusCode, headers: { ...CORS_HEADERS }, body: '' }
  }
  return {
    statusCode,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify(data)
  }
}

const parseBody = (raw) => {
  if (raw === undefined || raw === null || raw === '') return undefined
  try {
    return JSON.parse(raw)
  } catch {
    throw new ValidationError('BAD_JSON', 'Request body is not valid JSON')
  }
}

export const dispatch = async (event, routes, options = {}) => {
  const handler = routes[event.routeKey]
  try {
    if (!handler) {
      throw new NotFoundError('NO_ROUTE', `No handler for ${event.routeKey}`)
    }
    const body = parseBody(event.body)
    const ctx = {
      event,
      body,
      pathParameters: event.pathParameters || {},
      query: event.queryStringParameters || {},
      headers: event.headers || {},
      deps: options.deps || {},
      ...(options.request || {})
    }
    const result = await handler(ctx)
    if (result === undefined) return jsonResponse(204)
    if (result && typeof result === 'object' && 'statusCode' in result) {
      return jsonResponse(result.statusCode, result.data)
    }
    return jsonResponse(200, result)
  } catch (err) {
    const { statusCode, body } = errorToResponse(err)
    if (statusCode >= 500) {
      console.error(
        `[${event.routeKey}] unhandled error:`,
        err && err.stack ? err.stack : err
      )
    } else {
      console.warn(
        `[${event.routeKey}] ${statusCode} ${err?.name || ''} ${err?.code || ''}: ${err?.message || ''}`
      )
    }
    return jsonResponse(statusCode, body)
  }
}
