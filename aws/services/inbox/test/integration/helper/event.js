const matchPathParams = (templatePath, actualPath) => {
  const t = templatePath.split('/')
  const a = actualPath.split('/')
  if (t.length !== a.length) return {}
  const out = {}
  for (let i = 0; i < t.length; i += 1) {
    const m = t[i].match(/^\{(\w+)\}$/)
    if (m) out[m[1]] = a[i]
  }
  return out
}

const collapseQuery = (path) => {
  const idx = path.indexOf('?')
  if (idx < 0) return { rawPath: path, queryStringParameters: undefined }
  const rawPath = path.slice(0, idx)
  const params = Object.fromEntries(new URLSearchParams(path.slice(idx + 1)))
  return { rawPath, queryStringParameters: params }
}

export const apiEvent = ({
  method,
  path,
  body,
  claims,
  host = 'api-inbox-dev.apps.acme.example',
  routeTemplate
}) => {
  const { rawPath, queryStringParameters } = collapseQuery(path)
  const template = routeTemplate || rawPath
  return {
    routeKey: `${method} ${template}`,
    rawPath,
    headers: { host, 'content-type': 'application/json' },
    queryStringParameters,
    pathParameters: matchPathParams(template, rawPath),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    requestContext: {
      // Real API Gateway v2 events always carry this, and the app needs it to
      // resolve the {proxy+} route keys it is actually deployed behind — pass a
      // routeTemplate of '/admin/{proxy+}' to exercise that path.
      http: { method, path: rawPath },
      ...(claims ? { authorizer: { jwt: { claims } } } : {})
    }
  }
}

// Build admin claims with inbox capabilities for the given org.
export const adminClaims = (org, caps = { read: true, write: true, send: true }) => ({
  organizationId: org,
  orgs: JSON.stringify({ [org]: { active: true, capabilities: { inbox: caps } } })
})
