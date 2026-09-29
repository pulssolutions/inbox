// Regenerates the screenshots in public/manual/ for manual.html.
// Runs the app from source with a mocked API and a seeded admin session — no
// backend, no Cognito. Usage: yarn manual:shots
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'public', 'manual')

// A fictional brand, so the shots are the same for every deployment.
Object.assign(process.env, {
  VITE_API_BASE: 'https://api.manual.invalid',
  VITE_COGNITO_DOMAIN: 'manual.auth.invalid',
  VITE_USER_POOL_ID: 'manual',
  VITE_USER_POOL_CLIENT_ID: 'manual',
  VITE_BRAND_SHORT: 'Acme',
  VITE_BRAND_TAGLINE: 'Inbox',
  VITE_BRAND_FULL: 'Acme AB',
  VITE_BRAND_LOGO: '/manual/acme.svg',
  VITE_APP_TITLE: 'Acme Inbox',
  VITE_HELP_ORG_NOUN: 'företaget',
  VITE_HELP_EXAMPLE_ADDRESSES: 'support@, faktura@'
})

// Fixtures and the browser clock share one fixed "now", so the shots come out
// the same whenever they are regenerated.
const NOW = new Date('2026-09-29T11:00:00')
const daysAgo = (d, h = 9) => {
  const t = new Date(NOW)
  t.setDate(t.getDate() - d)
  t.setHours(h, 15, 0, 0)
  return t.toISOString()
}

const admins = [
  {
    email: 'maria@acme.example',
    name: 'Maria Lindqvist',
    role: 'superadmin',
    active: true,
    categories: [],
    notifyNewIssue: true
  },
  {
    email: 'johan@acme.example',
    name: 'Johan Berg',
    role: 'admin',
    active: true,
    categories: ['support'],
    notifyNewIssue: true
  },
  {
    email: 'sara@acme.example',
    name: 'Sara Nilsson',
    role: 'admin',
    active: true,
    categories: ['support', 'faktura'],
    notifyNewIssue: false
  }
]

const inbound = (m) => ({
  direction: 'inbound',
  status: 'read',
  state: 'open',
  box: 'inbox',
  attachments: [],
  ...m,
  lastActivityAt: m.lastActivityAt || m.receivedAt
})

const messages = [
  inbound({
    messageId: 'msg-1',
    category: 'support',
    from: 'Anna Svensson <anna.svensson@example.com>',
    to: ['support@acme.example'],
    subject: 'Kommer inte in på mitt konto',
    receivedAt: daysAgo(0, 8),
    status: 'unread',
    text: 'Hej!\n\nNär jag försöker logga in får jag felet "Kontot är låst". Jag har inte bytt lösenord nyligen. Kan ni hjälpa mig att komma in igen?\n\nMed vänlig hälsning\nAnna'
  }),
  inbound({
    messageId: 'msg-2',
    category: 'support',
    from: 'Erik Johansson <erik.j@example.com>',
    to: ['support@acme.example'],
    subject: 'Order 48211 har inte kommit',
    receivedAt: daysAgo(1, 19),
    lastActivityAt: daysAgo(0, 10),
    state: 'pending',
    assignee: 'johan@acme.example',
    text: 'Hej,\n\nJag beställde den 12:e (ordernummer 48211) och paketet skulle ha kommit i förra veckan. Spårningen har inte uppdaterats sedan i onsdags. Vet ni var det är?\n\nHälsningar\nErik'
  }),
  inbound({
    messageId: 'msg-3',
    category: 'faktura',
    from: 'Karin Öberg <karin.oberg@example.com>',
    to: ['faktura@acme.example'],
    subject: 'Fel belopp på faktura 2026-1187',
    receivedAt: daysAgo(2, 14),
    assignee: 'maria@acme.example',
    attachments: [
      {
        filename: 'faktura-2026-1187.pdf',
        contentType: 'application/pdf',
        size: 84213
      }
    ],
    text: 'Hej,\n\nFakturan i bilagan är på 4 800 kr men enligt offerten skulle det vara 4 200 kr. Kan ni skicka en kreditfaktura?\n\nKarin Öberg, ekonomi'
  }),
  inbound({
    messageId: 'msg-4',
    category: 'sälj',
    from: 'Lars Pettersson <lars.p@example.com>',
    to: ['salj@acme.example'],
    subject: 'Offert på 20 licenser',
    receivedAt: daysAgo(3, 11),
    status: 'unread',
    text: 'Hej, vi är ett team på 20 personer och vill ha en offert på årslicenser. Finns det volymrabatt?\n\nLars'
  }),
  inbound({
    messageId: 'msg-5',
    category: 'support',
    from: 'Sofia Ahmed <sofia.ahmed@example.com>',
    to: ['support@acme.example'],
    subject: 'Tack för snabb hjälp',
    receivedAt: daysAgo(5, 16),
    state: 'done',
    assignee: 'sara@acme.example',
    text: 'Bara ett stort tack – problemet med exporten är löst!\n\nSofia'
  }),
  inbound({
    messageId: 'msg-6',
    category: 'faktura',
    from: 'Nordic Leasing <ekonomi@example.com>',
    to: ['faktura@acme.example'],
    subject: 'Påminnelse: faktura 7731 förfaller 31 oktober',
    receivedAt: daysAgo(6, 9),
    state: 'pending',
    text: 'Påminnelse om att faktura 7731 förfaller den 31 oktober.'
  }),
  inbound({
    messageId: 'msg-7',
    category: 'support',
    from: 'Gunilla Ek <gunilla.ek@example.com>',
    to: ['support@acme.example'],
    subject: 'Ny faktureringsadress',
    receivedAt: daysAgo(12, 13),
    box: 'archived',
    state: 'done',
    text: 'Ny adress: Storgatan 3, 123 45 Storstad.'
  }),
  inbound({
    messageId: 'msg-8',
    category: 'support',
    from: 'Best Deals <promo@example.net>',
    to: ['support@acme.example'],
    subject: 'Du har vunnit! Hämta din belöning idag',
    receivedAt: daysAgo(1, 4),
    box: 'spam',
    text: 'Grattis! Klicka här för att hämta din belöning innan erbjudandet går ut.'
  })
]

// msg-2 has a reply from Johan; the thread endpoint returns both.
const reply = {
  messageId: 'msg-2-reply',
  direction: 'outbound',
  from: 'Johan Berg <support@acme.example>',
  sentByName: 'Johan Berg',
  receivedAt: daysAgo(0, 10),
  subject: 'Re: Order 48211 har inte kommit',
  text: 'Hej Erik!\n\nTack för ditt mejl. Paketet fastnade hos transportören och skickades om i morse med nytt spårningsnummer 7364 1029 88. Det bör komma inom två arbetsdagar.\n\nHälsningar\nJohan',
  attachments: []
}

const notes = {
  'msg-2': [
    {
      messageId: 'msg-2',
      text: 'Kollade med lagret – paketet returnerades av transportören, nytt skickat 09:40.',
      author: 'johan@acme.example',
      authorName: 'Johan Berg',
      createdAt: daysAgo(0, 9)
    }
  ],
  'msg-3': [
    {
      messageId: 'msg-3',
      text: 'Offerten stämmer, 4 200 kr. Ekonomi skickar kreditfaktura på fredag.',
      author: 'maria@acme.example',
      authorName: 'Maria Lindqvist',
      createdAt: daysAgo(1, 20)
    }
  ]
}

const audit = [
  {
    id: 'a6',
    ts: daysAgo(0, 10),
    actor: { email: 'johan@acme.example', name: 'Johan Berg' },
    action: 'reply',
    targetType: 'message',
    targetLabel: 'Order 48211 har inte kommit'
  },
  {
    id: 'a5',
    ts: daysAgo(0, 9),
    actor: { email: 'johan@acme.example', name: 'Johan Berg' },
    action: 'note',
    targetType: 'message',
    targetLabel: 'Order 48211 har inte kommit'
  },
  {
    id: 'a4',
    ts: daysAgo(1, 20),
    actor: { email: 'maria@acme.example', name: 'Maria Lindqvist' },
    action: 'transfer',
    targetType: 'message',
    targetLabel: 'Fel belopp på faktura 2026-1187',
    meta: { category: { from: 'support', to: 'faktura' } }
  },
  {
    id: 'a3',
    ts: daysAgo(2, 15),
    actor: { email: 'sara@acme.example', name: 'Sara Nilsson' },
    action: 'state',
    targetType: 'message',
    targetLabel: 'Tack för snabb hjälp',
    meta: { state: { from: 'open', to: 'done' } }
  },
  {
    id: 'a2',
    ts: daysAgo(4, 12),
    actor: { email: 'maria@acme.example', name: 'Maria Lindqvist' },
    action: 'archive',
    targetType: 'message',
    targetLabel: 'Ny faktureringsadress'
  },
  {
    id: 'a1',
    ts: daysAgo(8, 9),
    actor: { email: 'maria@acme.example', name: 'Maria Lindqvist' },
    action: 'admin.create',
    targetType: 'admin',
    targetLabel: 'sara@acme.example'
  }
]

const settings = {
  notifyDefaults: { newIssue: true, reply: false },
  webhook: {
    enabled: true,
    url: 'https://hooks.example.com/inbox',
    template: '',
    envelope: '',
    token: '',
    onNewIssue: true,
    onReply: false
  }
}

const listRow = ({ text, attachments, ...m }) => m // eslint-disable-line no-unused-vars
const threadItem = (m) => ({
  messageId: m.messageId,
  direction: m.direction,
  from: m.from,
  receivedAt: m.receivedAt,
  subject: m.subject,
  text: m.text,
  html: null,
  attachments: m.attachments || [],
  sentByName: m.sentByName
})

const api = (method, url) => {
  const { pathname, searchParams } = new URL(url)
  if (method !== 'GET') return {}
  if (pathname === '/admin/messages') {
    const box = searchParams.get('box') || 'inbox'
    const cat = searchParams.get('category')
    return messages
      .filter((m) => m.box === box && (!cat || m.category === cat))
      .sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1))
      .map(listRow)
  }
  if (pathname === '/admin/messages/search') {
    const q = (searchParams.get('q') || '').toLowerCase()
    return messages
      .filter((m) => `${m.subject} ${m.from}`.toLowerCase().includes(q))
      .map(listRow)
  }
  if (pathname === '/admin/assignees')
    return admins.map(({ email, name }) => ({ email, name }))
  if (pathname === '/admin/categories') return ['support', 'faktura', 'sälj']
  if (pathname === '/admin/admins') return admins
  if (pathname === '/admin/audit') return audit
  if (pathname === '/admin/settings') return settings
  const m = pathname.match(/^\/admin\/messages\/([^/]+)$/)
  if (m) {
    const msg = messages.find((x) => x.messageId === m[1])
    const thread = [threadItem(msg)]
    if (msg.messageId === 'msg-2') thread.push(threadItem(reply))
    return {
      ...listRow(msg),
      status: 'read',
      thread,
      notes: notes[msg.messageId] || []
    }
  }
  return {}
}

const session = {
  user: {
    email: 'maria@acme.example',
    name: 'Maria Lindqvist',
    initials: 'M'
  },
  idToken: 'manual',
  accessToken: 'manual',
  refreshToken: null,
  expiresAt: NOW.getTime() + 3600e3,
  orgs: {
    acme: {
      name: 'Acme AB',
      active: true,
      categories: '*',
      capabilities: {
        inbox: { read: true, write: true, send: true },
        admins: { read: true, write: true, delete: true },
        audit: { read: true }
      }
    }
  },
  currentOrg: 'acme'
}

const main = async () => {
  const vite = await createServer({
    root,
    server: { port: 0 },
    logLevel: 'error'
  })
  await vite.listen()
  const base = vite.resolvedUrls.local[0]
  const browser = await chromium.launch()

  const open = async ({ mobile = false, signedIn = true } = {}) => {
    const ctx = await browser.newContext({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 800 },
      deviceScaleFactor: 2,
      locale: 'sv-SE',
      colorScheme: 'light'
    })
    await ctx.route('**/admin/**', (route) =>
      route.fulfill({
        json: api(route.request().method(), route.request().url())
      })
    )
    await ctx.clock.setFixedTime(NOW)
    if (signedIn) {
      await ctx.addInitScript((s) => {
        localStorage.setItem('inbox:admin', JSON.stringify(s))
        localStorage.setItem('inbox:org', s.currentOrg)
        localStorage.setItem('inbox:theme', 'light')
      }, session)
    }
    return ctx.newPage()
  }

  const shot = async (page, name, opts = {}) => {
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(outDir, `${name}.png`), ...opts })
    console.log(`  ${name}.png`)
  }
  // The thread pane scrolls; show the latest reply rather than the top.
  const scrollThreadToEnd = (page) =>
    page.getByTestId('thread-msg').last().scrollIntoViewIfNeeded()
  const goto = (page, hash) =>
    page.goto(`${base}#${hash}`, { waitUntil: 'networkidle' })

  let page = await open({ signedIn: false })
  await goto(page, '/logga-in')
  await shot(page, 'login')

  page = await open()
  await goto(page, '/')
  await page.getByTestId('message-list').waitFor()
  await shot(page, 'inbox')

  await goto(page, '/m/msg-2')
  await page.getByTestId('note').waitFor()
  await scrollThreadToEnd(page)
  await shot(page, 'message')

  await goto(page, '/m/msg-1')
  await page.getByTestId('thread-msg').waitFor()
  await page.getByTestId('tab-reply').click()
  await page
    .getByTestId('reply-body')
    .fill(
      'Hej Anna!\n\nKontot låstes efter för många inloggningsförsök. Jag har låst upp det nu – prova att logga in igen, och hör av dig om det inte fungerar.\n\nHälsningar\nMaria'
    )
  await page.getByTestId('send-menu-toggle').click()
  await shot(page, 'reply')

  await page.getByTestId('tab-note').click()
  await page
    .getByTestId('reply-body')
    .fill(
      'Anna ringde också – kontot låstes av tre felaktiga försök igår kväll.'
    )
  await shot(page, 'note')

  await page.getByTestId('category-select').focus()
  await shot(page, 'actions', {
    clip: { x: 0, y: 0, width: 1280, height: 260 }
  })

  await goto(page, '/')
  await page.getByTestId('filter-spam').click()
  await page.getByTestId('message-list').waitFor()
  await page.getByText('Du har vunnit!').click()
  await page.getByTestId('not-spam').waitFor()
  await shot(page, 'spam')

  await goto(page, '/admins')
  await page.getByTestId('admin-row').first().waitFor()
  await shot(page, 'admins')
  await page.getByTestId('tab-settings').click()
  await page.getByTestId('settings-panel').waitFor()
  await shot(page, 'settings')

  await goto(page, '/audit')
  await page.getByTestId('audit-row').first().waitFor()
  await shot(page, 'audit')

  page = await open({ mobile: true })
  await goto(page, '/')
  await page.getByTestId('message-list').waitFor()
  await shot(page, 'mobile-list')
  await goto(page, '/m/msg-2')
  await page.getByTestId('note').waitFor()
  await scrollThreadToEnd(page)
  await shot(page, 'mobile-message')

  await browser.close()
  await vite.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
