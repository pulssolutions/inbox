import { describe, it, expect } from 'vitest'
import {
  renderTemplate,
  renderEnvelope,
  validateWebhookUrl,
  unknownPlaceholders,
  Webhook,
  BODY_LIMIT
} from '../../src/webhook.js'

const message = (over = {}) => ({
  subject: 'Fel på mitt konto',
  from: 'Anna Andersson <anna@taby.se>',
  category: 'kurser',
  orgName: 'Puls',
  messageId: 'm1',
  threadId: 'm1',
  url: 'https://inbox.example/#/m/m1',
  receivedAt: '2026-09-24T08:00:00Z',
  body: 'Hej!',
  ...over
})

describe('renderTemplate', () => {
  it('substitutes every placeholder', () => {
    const out = renderTemplate(
      '{{subject}}|{{fromName}}|{{fromEmail}}|{{category}}|{{orgName}}|{{threadId}}|{{url}}|{{body}}',
      message()
    )
    expect(out).toBe(
      'Fel på mitt konto|Anna Andersson|anna@taby.se|kurser|Puls|m1|https://inbox.example/#/m/m1|Hej!'
    )
  })

  it('escapes what the customer wrote, so a subject cannot become markup', () => {
    // The template is authored by an admin; the values in it are not. A
    // subject line is the cheapest place to inject script into a chat room.
    const out = renderTemplate('<p>{{subject}}</p>', message({ subject: '<script>x()</script>' }))
    expect(out).toBe('<p>&lt;script&gt;x()&lt;/script&gt;</p>')
  })

  it('leaves the template author their own tags', () => {
    expect(renderTemplate('<b>{{category}}</b>', message())).toBe('<b>kurser</b>')
  })

  it('renders an unknown placeholder as nothing rather than leaving it visible', () => {
    expect(renderTemplate('[{{nope}}]', message())).toBe('[]')
  })

  it('truncates a long body', () => {
    const body = 'a'.repeat(BODY_LIMIT + 50)
    const out = renderTemplate('{{body}}', message({ body }))
    expect(out).toHaveLength(BODY_LIMIT + 1)
    expect(out.endsWith('…')).toBe(true)
  })

  it('falls back to the address when From carries no display name', () => {
    expect(renderTemplate('{{fromName}}', message({ from: 'anna@taby.se' }))).toBe('anna@taby.se')
  })
})

describe('renderEnvelope', () => {
  it('produces valid JSON whatever the content contains', () => {
    // The author types the envelope. They must not be able to break it, and
    // neither must a customer whose mail is full of quotes and newlines.
    const content = '<p>He said "hi"</p>\n<p>\\ end</p>'
    const body = renderEnvelope('{"content":"{{content}}"}', content)
    expect(JSON.parse(body)).toEqual({ content })
  })

  it('carries the receiver\'s own key', () => {
    expect(JSON.parse(renderEnvelope('{"text":"{{content}}"}', 'hi'))).toEqual({ text: 'hi' })
  })

  it('leaves a placeholder that is not content alone', () => {
    expect(renderEnvelope('{"a":"{{other}}","content":"{{content}}"}', 'x')).toContain('{{other}}')
  })
})

describe('validateWebhookUrl', () => {
  it('accepts an https URL', () => {
    expect(() => validateWebhookUrl('https://3.basecamp.com/1/integrations/t/lines')).not.toThrow()
  })

  it('refuses plain http', () => {
    expect(() => validateWebhookUrl('http://example.com/hook')).toThrow(/https/)
  })

  it('refuses private and link-local hosts', () => {
    for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.1', '169.254.169.254', '172.16.0.1']) {
      expect(() => validateWebhookUrl(`https://${host}/hook`), host).toThrow(/private/)
    }
  })

  it('refuses something that is not a URL', () => {
    expect(() => validateWebhookUrl('not a url')).toThrow(/URL/)
  })
})

describe('unknownPlaceholders', () => {
  it('names a typo so it fails in the form, not silently forever', () => {
    expect(unknownPlaceholders('{{subject}} {{sbject}} {{alsoWrong}}')).toEqual([
      'sbject',
      'alsoWrong'
    ])
  })

  it('is empty for a template that only uses real placeholders', () => {
    expect(unknownPlaceholders('{{subject}} {{body}} {{url}}')).toEqual([])
  })
})

describe('Webhook.post', () => {
  it('sends the body as JSON and reports the status', async () => {
    const calls = []
    const webhook = new Webhook({
      fetch: async (url, init) => {
        calls.push({ url, init })
        return { ok: true, status: 201 }
      }
    })
    const res = await webhook.post({ url: 'https://x.example/h', token: 's3cret', body: '{"a":1}' })
    expect(res).toEqual({ ok: true, status: 201 })
    expect(calls[0].url).toBe('https://x.example/h')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.body).toBe('{"a":1}')
    expect(calls[0].init.headers).toMatchObject({
      'content-type': 'application/json',
      'x-inbox-token': 's3cret'
    })
  })

  it('sends no token header when none is configured', async () => {
    let headers
    const webhook = new Webhook({
      fetch: async (_url, init) => {
        headers = init.headers
        return { ok: true, status: 200 }
      }
    })
    await webhook.post({ url: 'https://x.example/h', token: '', body: '{}' })
    expect(headers['x-inbox-token']).toBeUndefined()
  })
})
