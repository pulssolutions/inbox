import { describe, it, expect, afterEach } from 'vitest'
import { strings, availableLocales, DEFAULT_LOCALE } from '../../src/strings.js'
import { buildEmail } from '../../src/ses.js'

const original = process.env.LOCALE
afterEach(() => {
  process.env.LOCALE = original
})

describe('strings', () => {
  it('serves each locale it advertises', () => {
    for (const locale of availableLocales()) {
      expect(strings(locale).reminderHeading, locale).toBeTruthy()
    }
  })

  it('falls back to English rather than throwing on an unknown locale', () => {
    expect(strings('de').reminderHeading).toBe(strings(DEFAULT_LOCALE).reminderHeading)
  })

  it('fills gaps in a partial locale from English', () => {
    // Every locale must answer every key the code calls, or mail generation
    // throws mid-send. Compare shapes rather than trusting review.
    const en = Object.keys(strings('en')).sort()
    for (const locale of availableLocales()) {
      expect(Object.keys(strings(locale)).sort(), locale).toEqual(en)
    }
  })

  it('reads LOCALE at call time, so one deployment is one language', () => {
    process.env.LOCALE = 'sv'
    expect(strings().ctaOpen).toBe('Öppna')
    process.env.LOCALE = 'en'
    expect(strings().ctaOpen).toBe('Open')
  })

  it('localises the email chrome customers actually see', () => {
    process.env.LOCALE = 'en'
    const en = buildEmail({ orgName: 'Acme', paragraphs: ['x'], ctaUrl: 'https://e.x' })
    expect(en.html).toContain('This is an automated message from Acme.')
    expect(en.html).toContain('>Open<')

    process.env.LOCALE = 'sv'
    const sv = buildEmail({ orgName: 'Acme', paragraphs: ['x'], ctaUrl: 'https://e.x' })
    expect(sv.html).toContain('automatiskt meddelande från Acme')
  })
})
