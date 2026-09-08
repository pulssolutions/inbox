// Pure formatting helpers — no I/O, deterministic (now is injectable).

export const ago = (iso, now = Date.now()) => {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Math.max(0, now - then)
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'nyss'
  if (min < 60) return `${min} min`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} tim`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} d`
  return new Date(iso).toLocaleDateString('sv-SE', {
    day: 'numeric',
    month: 'short'
  })
}

export const formatDateTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })
}

// Workflow states (Öppen / Pågår / Klar).
export const STATES = [
  { value: 'open', label: 'Öppen' },
  { value: 'pending', label: 'Pågår' },
  { value: 'done', label: 'Klar' }
]

export const stateLabel = (state) =>
  STATES.find((s) => s.value === state)?.label || 'Öppen'

// Human labels for audit-log actions.
const AUDIT_LABELS = {
  reply: 'Svar',
  status: 'Status',
  state: 'Status',
  archive: 'Arkiverade',
  unarchive: 'Återöppnade',
  delete: 'Tog bort',
  note: 'Anteckning',
  transfer: 'Flyttade',
  // The API emits these from updateStatus(); without them the log printed the
  // raw English key in an otherwise Swedish UI.
  assign: 'Tilldelade',
  update: 'Uppdaterade',
  'admin.create': 'Admin skapad',
  'admin.update': 'Admin ändrad',
  'admin.delete': 'Admin borttagen'
}

export const auditActionLabel = (action) => AUDIT_LABELS[action] || action

// Short human-readable detail for an audit entry, derived from its meta.
export const auditDetail = (entry) => {
  const m = entry?.meta || {}
  switch (entry?.action) {
    case 'state':
    case 'status':
      if (m.state) return `Status: ${stateLabel(m.state.from)} → ${stateLabel(m.state.to)}`
      if (m.status) return `Lässtatus: ${m.status.from} → ${m.status.to}`
      return ''
    case 'archive':
      return 'Flyttad: Inkorg → Arkiverade'
    case 'unarchive':
      return 'Flyttad: Arkiverade → Inkorg'
    case 'reply':
      return m.to ? `Svar till: ${m.to}` : ''
    case 'note':
      return 'Intern anteckning tillagd'
    case 'transfer':
      return m.category ? `Kategori: ${m.category.from} → ${m.category.to}` : ''
    case 'assign': {
      if (!m.assignee) return ''
      const label = (v) => v || 'Ej tilldelad'
      return `Tilldelad: ${label(m.assignee.from)} → ${label(m.assignee.to)}`
    }
    case 'delete':
      return m.category
        ? `Hela tråden borttagen (kategori: ${m.category})`
        : 'Hela tråden borttagen'
    case 'admin.create':
    case 'admin.update': {
      const role = m.role ? `Roll: ${m.role}` : ''
      const cats = Array.isArray(m.categories)
        ? `Kategorier: ${m.categories.join(', ') || 'inga'}`
        : ''
      return [role, cats].filter(Boolean).join(' · ')
    }
    case 'admin.delete':
      return m.role ? `Tidigare roll: ${m.role}` : ''
    default:
      return ''
  }
}

// "Name <addr>" -> "Name"; bare address stays as-is.
export const senderName = (from) => {
  if (!from) return ''
  const angle = String(from).match(/^\s*(.+?)\s*<[^>]+>\s*$/)
  return angle ? angle[1].replace(/^"|"$/g, '') : String(from).trim()
}

// "Name <addr>" -> "addr"; a bare address stays as-is; '' when no address.
export const emailOf = (from) => {
  if (!from) return ''
  const s = String(from).trim()
  const angle = s.match(/<([^>]+)>/)
  const candidate = angle ? angle[1].trim() : s
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : ''
}

// Attachment sizes, Swedish-style ("1,4 MB"). Returns '' for a missing size so
// the caller can just render it — old mail rows have no size recorded.
export const formatBytes = (bytes) => {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1024) return `${n} B`
  const kb = n / 1024
  if (kb < 1024) return `${Math.round(kb)} kB`
  return `${(kb / 1024).toFixed(1).replace('.', ',')} MB`
}
