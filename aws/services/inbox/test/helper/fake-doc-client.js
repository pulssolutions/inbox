export class FakeDocClient {
  constructor() {
    this.items = new Map()
    this.callLog = []
  }

  _key(item, pkAttr = 'pk', skAttr = 'sk') {
    return `${item[pkAttr]}|${item[skAttr]}`
  }

  async send(command) {
    const name = command.constructor.name
    const input = command.input
    this.callLog.push({ name, input })

    if (name === 'PutCommand') {
      const k = this._key(input.Item)
      this.items.set(k, { ...input.Item })
      return {}
    }

    if (name === 'GetCommand') {
      const k = `${input.Key.pk}|${input.Key.sk}`
      const item = this.items.get(k)
      return item ? { Item: { ...item } } : {}
    }

    if (name === 'DeleteCommand') {
      const k = `${input.Key.pk}|${input.Key.sk}`
      this.items.delete(k)
      return {}
    }

    if (name === 'UpdateCommand') {
      return this._update(input)
    }

    if (name === 'QueryCommand') {
      return this._query(input)
    }

    throw new Error(`FakeDocClient: unsupported command ${name}`)
  }

  // Supports only what Database generates: a SET of named attributes, an
  // attribute_exists condition, and ReturnValues: ALL_NEW.
  _update(input) {
    const k = `${input.Key.pk}|${input.Key.sk}`
    const existing = this.items.get(k)

    if (/attribute_exists/.test(input.ConditionExpression || '') && !existing) {
      const err = new Error('The conditional request failed')
      err.name = 'ConditionalCheckFailedException'
      throw err
    }

    const names = input.ExpressionAttributeNames || {}
    const values = input.ExpressionAttributeValues || {}
    const next = { ...(existing || input.Key) }

    const setClause = (input.UpdateExpression || '').replace(/^\s*SET\s+/i, '')
    for (const part of setClause.split(',')) {
      const m = part.trim().match(/^(#\w+|\w+)\s*=\s*(:\w+)$/)
      if (!m) continue
      const attr = m[1].startsWith('#') ? names[m[1]] : m[1]
      next[attr] = values[m[2]]
    }

    this.items.set(k, next)
    return input.ReturnValues === 'ALL_NEW' ? { Attributes: { ...next } } : {}
  }

  _query(input) {
    const indexName = input.IndexName
    const expr = input.KeyConditionExpression || ''
    const values = input.ExpressionAttributeValues || {}
    const names = input.ExpressionAttributeNames || {}

    const pkAttr = indexName === 'gsi1' ? 'gsi1pk' : 'pk'
    const skAttr = indexName === 'gsi1' ? 'gsi1sk' : 'sk'

    const pkPlaceholder = this._extractPkPlaceholder(expr, pkAttr, names)
    const pkValue = values[pkPlaceholder]

    const all = Array.from(this.items.values())
    let matched = all.filter((it) => it[pkAttr] === pkValue)

    const skClause = this._extractSkClause(expr, skAttr)
    if (skClause) {
      matched = matched.filter((it) => skClause.match(it[skAttr], values))
    }

    matched.sort((a, b) => ((a[skAttr] ?? '') < (b[skAttr] ?? '') ? -1 : 1))
    if (input.ScanIndexForward === false) matched.reverse()

    if (input.Select === 'COUNT') {
      return { Count: matched.length, ScannedCount: matched.length }
    }
    return { Items: matched.map((it) => ({ ...it })), Count: matched.length }
  }

  _extractPkPlaceholder(expr, pkAttr, names) {
    const re = new RegExp(`(?:#(\\w+)|${pkAttr})\\s*=\\s*(:\\w+)`)
    const m = expr.match(re)
    if (!m) return null
    if (m[1]) {
      const resolved = names['#' + m[1]]
      if (resolved !== pkAttr) return null
    }
    return m[2]
  }

  _extractSkClause(expr, skAttr) {
    const skRef = `(?:#(\\w+)|${skAttr})`
    const beginsWith = new RegExp(
      `begins_with\\s*\\(\\s*${skRef}\\s*,\\s*(:\\w+)\\s*\\)`
    )
    const gte = new RegExp(`${skRef}\\s*>=\\s*(:\\w+)`)
    const between = new RegExp(
      `${skRef}\\s+BETWEEN\\s+(:\\w+)\\s+AND\\s+(:\\w+)`
    )

    let m = expr.match(beginsWith)
    if (m) {
      const placeholder = m[2]
      return {
        match: (sk, vals) => (sk || '').startsWith(vals[placeholder])
      }
    }
    m = expr.match(gte)
    if (m) {
      const placeholder = m[2]
      return { match: (sk, vals) => (sk || '') >= vals[placeholder] }
    }
    m = expr.match(between)
    if (m) {
      const lo = m[2]
      const hi = m[3]
      return {
        match: (sk, vals) => (sk || '') >= vals[lo] && (sk || '') <= vals[hi]
      }
    }
    return null
  }

  seed(items) {
    for (const it of items) this.items.set(this._key(it), { ...it })
    return this
  }

  all() {
    return Array.from(this.items.values()).map((it) => ({ ...it }))
  }

  reset() {
    this.items.clear()
    this.callLog = []
  }
}
