// The admin-row -> claim mapping, shared by the pretoken trigger and the API
// token resolver so both hand the handlers identical capability objects.
const capabilities = (row) => ({
  // replyApproval: the admin drafts replies for a colleague to send.
  inbox: { read: true, write: true, send: row.replyApproval !== true, propose: true },
  ...(row.role === 'superadmin' && {
    admins: { read: true, write: true, delete: true },
    audit: { read: true }
  })
})

export const orgEntry = (row, name) => ({
  capabilities: capabilities(row),
  categories: row.role === 'superadmin' ? '*' : row.categories || [],
  name,
  active: true
})
