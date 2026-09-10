// Which of an environment's mail domains have no ALL:tenant row.
//
// Adding a domain to mailDomains makes SES ACCEPT its mail. It does not make
// the system PROCESS it: parse resolves the org from an ALL:tenant row and
// drops anything else on purpose, so the two lists have to agree. When they do
// not, SES accepts the message, nobody bounces it, and the only trace is a log
// line. This is what tells the operator, at the one moment they are looking.
//
// It reports presence only. Tenant rows map domain -> org and one deployment
// may serve several orgs (docs/architecture.md), so which org owns a domain is
// never guessed here - seeding the wrong one would file another org's mail
// under yours.

const normalise = (d) => String(d || '').trim().toLowerCase()

export const missingTenants = (mailDomains, knownDomains) => {
  const known = new Set((knownDomains || []).map(normalise))
  return (mailDomains || []).filter((d) => normalise(d) && !known.has(normalise(d)))
}

export const seedHint = ({ domain, env, org, prefix, name }) =>
  `INBOX_PREFIX=${prefix} node aws/services/inbox/scripts/seed-tenant.mjs ` +
  `--env ${env} --domain ${domain} --org ${org}` +
  (name ? ` --name ${JSON.stringify(name)}` : '')
