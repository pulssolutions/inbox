import { describe, it, expect } from 'vitest'
import {
  ago,
  formatDateTime,
  senderName,
  emailOf,
  stateLabel,
  auditActionLabel,
  auditDetail,
  formatBytes
} from '@/helpers/format'

const NOW = new Date('2026-06-02T12:00:00Z').getTime()

describe('ago', () => {
  it('shows "nyss" under a minute', () => {
    expect(ago('2026-06-02T11:59:30Z', NOW)).toBe('nyss')
  })
  it('shows minutes', () => {
    expect(ago('2026-06-02T11:45:00Z', NOW)).toBe('15 min')
  })
  it('shows hours', () => {
    expect(ago('2026-06-02T09:00:00Z', NOW)).toBe('3 tim')
  })
  it('shows days', () => {
    expect(ago('2026-05-30T12:00:00Z', NOW)).toBe('3 d')
  })
  it('falls back to a date for older items', () => {
    expect(ago('2026-01-02T12:00:00Z', NOW)).toMatch(/jan/)
  })
  it('handles missing input', () => {
    expect(ago('', NOW)).toBe('')
  })
})

describe('formatDateTime', () => {
  it('formats an ISO date in sv-SE', () => {
    expect(formatDateTime('2026-06-02T09:30:00Z')).toMatch(/2026/)
  })
  it('returns empty for missing input', () => {
    expect(formatDateTime(null)).toBe('')
  })
})

describe('stateLabel', () => {
  it('maps states to Swedish labels', () => {
    expect(stateLabel('open')).toBe('Öppen')
    expect(stateLabel('pending')).toBe('Pågår')
    expect(stateLabel('done')).toBe('Klar')
  })
  it('defaults to Öppen for unknown/missing', () => {
    expect(stateLabel(undefined)).toBe('Öppen')
  })
})

describe('auditActionLabel', () => {
  it('maps actions to Swedish labels', () => {
    expect(auditActionLabel('reply')).toBe('Svar')
    expect(auditActionLabel('delete')).toBe('Tog bort')
    expect(auditActionLabel('admin.create')).toBe('Admin skapad')
  })
  it('falls back to the raw action', () => {
    expect(auditActionLabel('weird')).toBe('weird')
  })
})

describe('auditDetail', () => {
  it('describes a status change with from→to labels', () => {
    expect(auditDetail({ action: 'state', meta: { state: { from: 'open', to: 'done' } } }))
      .toBe('Status: Öppen → Klar')
  })
  it('describes archive + reply + admin changes', () => {
    expect(auditDetail({ action: 'archive', meta: {} })).toContain('Arkiverade')
    expect(auditDetail({ action: 'reply', meta: { to: 'a@b.se' } })).toContain('a@b.se')
    expect(auditDetail({ action: 'admin.update', meta: { role: 'admin', categories: ['kurser'] } }))
      .toContain('kurser')
  })
  it('is empty when there is nothing extra to show', () => {
    expect(auditDetail({ action: 'reply', meta: {} })).toBe('')
  })
})

describe('emailOf', () => {
  it('extracts the address from a display-named header', () => {
    expect(emailOf('Anna Svensson <anna@example.se>')).toBe('anna@example.se')
  })
  it('returns a bare address as-is', () => {
    expect(emailOf('anna@example.se')).toBe('anna@example.se')
  })
  it('returns empty for non-addresses', () => {
    expect(emailOf('')).toBe('')
    expect(emailOf('Anna Svensson')).toBe('')
  })
})

describe('senderName', () => {
  it('extracts the display name from "Name <addr>"', () => {
    expect(senderName('Anna Svensson <anna@example.se>')).toBe('Anna Svensson')
  })
  it('returns the bare address when no display name', () => {
    expect(senderName('anna@example.se')).toBe('anna@example.se')
  })
  it('handles empty', () => {
    expect(senderName('')).toBe('')
  })
})

describe('formatBytes', () => {
  it('shows bytes, kilobytes and megabytes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 kB')
    expect(formatBytes(358_400)).toBe('350 kB')
    // Swedish decimal comma.
    expect(formatBytes(1_500_000)).toBe('1,4 MB')
  })

  it('renders nothing for a missing or zero size', () => {
    // Older mail rows have no size recorded — the chip just omits it.
    expect(formatBytes(undefined)).toBe('')
    expect(formatBytes(null)).toBe('')
    expect(formatBytes(0)).toBe('')
    expect(formatBytes('nope')).toBe('')
  })
})

describe('audit transfer', () => {
  it('labels a transfer and shows both categories', () => {
    expect(auditActionLabel('transfer')).toBe('Flyttade')
    expect(
      auditDetail({ action: 'transfer', meta: { category: { from: 'kurser', to: 'agility' } } })
    ).toBe('Kategori: kurser → agility')
  })
})

describe('audit labels cover every action the API emits', () => {
  it('names assignment in the product language, not the raw key', () => {
    expect(auditActionLabel('assign')).toBe('Tilldelade')
    expect(auditActionLabel('update')).toBe('Uppdaterade')
  })

  it('describes an assignment change, including to and from nobody', () => {
    expect(
      auditDetail({ action: 'assign', meta: { assignee: { from: null, to: 'a@b.se' } } })
    ).toBe('Tilldelad: Ej tilldelad → a@b.se')
    expect(
      auditDetail({ action: 'assign', meta: { assignee: { from: 'a@b.se', to: null } } })
    ).toBe('Tilldelad: a@b.se → Ej tilldelad')
  })
})
