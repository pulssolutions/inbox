// The admin-row -> claim mapping, shared by the pretoken trigger and the API
// token resolver so both hand the handlers identical capability objects.
const INBOX_CAPS = { inbox: { read: true, write: true, send: true } }
const SUPER_CAPS = {
  inbox: { read: true, write: true, send: true },
  admins: { read: true, write: true, delete: true },
  audit: { read: true }
}

export const orgEntry = (row, name) => ({
  capabilities: row.role === 'superadmin' ? SUPER_CAPS : INBOX_CAPS,
  categories: row.role === 'superadmin' ? '*' : row.categories || [],
  name,
  active: true
})
