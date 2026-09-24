<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Administratörer</h1>
        <p class="muted">Hantera vilka som har åtkomst och till vilka kategorier.</p>
      </div>
    </div>

    <div class="page-tabs">
      <button
        type="button"
        data-testid="tab-admins"
        :class="{ active: tab === 'admins' }"
        @click="tab = 'admins'"
      >
        Admins
      </button>
      <button
        type="button"
        data-testid="tab-settings"
        :class="{ active: tab === 'settings' }"
        @click="tab = 'settings'"
      >
        Settings
      </button>
    </div>

    <div v-if="tab === 'settings'" class="page-body" data-testid="settings-panel">
      <section class="notify-defaults">
        <h2>E-post som standard</h2>
        <p class="muted">
          Gäller administratörer som inte valt något eget. Var och en kan sätta
          sitt eget värde under Admins.
        </p>
        <div v-for="e in NOTIFY_EVENTS" :key="e.key" class="notify-row">
          <label class="form-label" :for="`default-notify-${e.key}`">{{ e.label }}</label>
          <select
            :id="`default-notify-${e.key}`"
            class="form-control"
            :data-testid="`default-notify-${e.key}`"
            :value="settings.notifyDefaults[e.key] ? 'on' : 'off'"
            :disabled="settings.loading.save"
            @change="saveDefault(e.key, $event.target.value)"
          >
            <option value="on">På</option>
            <option value="off">Av</option>
          </select>
        </div>
        <p v-if="settings.error.save" class="form-error">Kunde inte spara standardvärdet.</p>
      </section>

      <section class="webhook">
        <h2>Webhook</h2>
        <p v-if="!settings.webhook.enabled" class="muted" data-testid="webhook-off">
          Webhooks är avstängda i den här installationen.
        </p>
        <template v-else>
          <p class="muted">
            Skickar varje nytt meddelande vidare till en adress, till exempel en
            Basecamp-campfire. Tom adress stänger av.
          </p>

          <div class="field">
            <label class="form-label" for="webhook-url">Adress</label>
            <input
              id="webhook-url"
              v-model="webhookForm.url"
              class="form-control"
              type="url"
              data-testid="webhook-url"
              placeholder="https://3.basecamp.com/…/lines"
            />
          </div>

          <div v-for="e in WEBHOOK_EVENTS" :key="e.key" class="notify-row">
            <label class="form-label" :for="`webhook-${e.key}`">{{ e.label }}</label>
            <select
              :id="`webhook-${e.key}`"
              class="form-control"
              :data-testid="`webhook-${e.key}`"
              :value="webhookForm[e.key] ? 'on' : 'off'"
              @change="webhookForm[e.key] = $event.target.value === 'on'"
            >
              <option value="on">På</option>
              <option value="off">Av</option>
            </select>
          </div>

          <div class="field">
            <label class="form-label" for="webhook-template">Mall</label>
            <p class="muted hint">Platshållare: {{ PLACEHOLDER_HINT }}</p>
            <textarea
              id="webhook-template"
              v-model="webhookForm.template"
              class="form-control template"
              data-testid="webhook-template"
              rows="8"
            />
          </div>

          <details class="advanced">
            <summary>Avancerat</summary>
            <div class="field">
              <label class="form-label" for="webhook-envelope">JSON-kropp</label>
              <p class="muted hint">Måste innehålla {{ CONTENT_TOKEN }}.</p>
              <input
                id="webhook-envelope"
                v-model="webhookForm.envelope"
                class="form-control"
                data-testid="webhook-envelope"
              />
            </div>
            <div class="field">
              <label class="form-label" for="webhook-token">Hemlighet</label>
              <p class="muted hint">Skickas som X-Inbox-Token. Lämna tom om mottagaren inte vill ha någon.</p>
              <input
                id="webhook-token"
                v-model="webhookForm.token"
                class="form-control"
                data-testid="webhook-token"
              />
            </div>
          </details>

          <div class="webhook-actions">
            <button
              type="button"
              class="btn btn-primary btn-sm"
              data-testid="webhook-save"
              :disabled="settings.loading.webhook"
              @click="saveWebhook"
            >
              Spara
            </button>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              data-testid="webhook-test"
              :disabled="settings.loading.test || !settings.webhook.url"
              @click="settings.testWebhookAction()"
            >
              Skicka test
            </button>
          </div>

          <p v-if="settings.error.webhook" class="form-error" data-testid="webhook-error">
            {{ webhookError }}
          </p>
          <p v-else-if="settings.testResult" class="test-result" data-testid="webhook-test-result">
            {{ settings.testResult.delivered
              ? 'Testet levererades.'
              : `Testet gick inte fram: ${settings.testResult.error}` }}
          </p>
        </template>
      </section>
    </div>

    <div v-else class="page-body">
      <Spinner v-if="store.loading.list" label="Laddar administratörer…" />
      <table v-else class="admin-table">
        <thead>
          <tr>
            <th>Namn</th>
            <th>E-post</th>
            <th>Roll</th>
            <th>Kategorier</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in store.admins" :key="a.email" data-testid="admin-row">
            <td>{{ a.name }}</td>
            <td class="muted">{{ a.email }}</td>
            <td>
              <span class="role-tag" :class="{ owner: a.role === 'superadmin' }">
                {{ a.role === 'superadmin' ? 'Superadmin' : 'Admin' }}
              </span>
            </td>
            <td>
              <span v-if="a.role === 'superadmin'" class="muted">Alla</span>
              <span v-else class="areas">
                <span v-for="c in a.categories || []" :key="c" class="area-chip">{{ c }}</span>
                <span v-if="!(a.categories || []).length" class="muted">—</span>
              </span>
            </td>
            <td class="nowrap">
              <button type="button" class="btn btn-ghost btn-sm" @click="openEdit(a)">Ändra</button>
              <button type="button" class="btn btn-ghost btn-sm" data-testid="delete-admin" @click="onDelete(a)">Ta bort</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="store.error.list" class="form-error">Kunde inte ladda administratörer.</p>

      <button type="button" class="btn btn-primary btn-sm add-admin" data-testid="add-admin" @click="openNew">
        + Ny admin
      </button>

    </div>

    <Modal :open="modalOpen" :title="editing ? 'Ändra admin' : 'Ny admin'" @close="modalOpen = false">
      <div class="stack-12">
        <div>
          <label class="form-label">E-post</label>
          <input v-model="form.email" class="form-control" data-testid="f-email" :disabled="editing" />
        </div>
        <div>
          <label class="form-label">Namn</label>
          <input v-model="form.name" class="form-control" data-testid="f-name" />
        </div>
        <div>
          <label class="form-label">Roll</label>
          <select v-model="form.role" class="form-control" data-testid="f-role">
            <option value="admin">Admin</option>
            <option value="superadmin">Superadmin</option>
          </select>
        </div>
        <div v-if="form.role !== 'superadmin'">
          <label class="form-label">Kategorier (kommaseparerade)</label>
          <input v-model="form.categories" class="form-control" data-testid="f-categories" placeholder="kurser, styrelse" />
        </div>
        <div v-for="e in NOTIFY_EVENTS" :key="e.key">
          <label class="form-label">E-post: {{ e.label.toLowerCase() }}</label>
          <select
            v-model="form.notify[e.key]"
            class="form-control"
            :data-testid="`f-notify-${e.key}`"
          >
            <option value="inherit">
              Följ standard ({{ settings.notifyDefaults[e.key] ? 'På' : 'Av' }})
            </option>
            <option value="on">På</option>
            <option value="off">Av</option>
          </select>
        </div>
        <p v-if="store.error.save" class="form-error">{{ saveError }}</p>
      </div>
      <template #footer>
        <button type="button" class="btn btn-ghost btn-sm" @click="modalOpen = false">Avbryt</button>
        <button type="button" class="btn btn-primary btn-sm" data-testid="save-admin" :disabled="store.loading.save" @click="save">
          Spara
        </button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useAdminsStore } from '@/stores/admins-store'
import { useSettingsStore } from '@/stores/settings-store'
import Modal from '@/components/Modal.vue'
import Spinner from '@/components/Spinner.vue'

const store = useAdminsStore()
const settings = useSettingsStore()
const tab = ref('admins')
const modalOpen = ref(false)
const editing = ref(false)

// The two events an admin is mailed about, each stored under its own flag.
// `null` on the admin row means "no choice" — the org default applies.
const NOTIFY_EVENTS = [
  { key: 'newIssue', field: 'notifyNewIssue', label: 'Nytt ärende' },
  { key: 'reply', field: 'notifyReply', label: 'Svar och aktivitet i ärende' }
]

// What the webhook fires on. Spam never does, whatever is set here.
const WEBHOOK_EVENTS = [
  { key: 'onNewIssue', label: 'Nytt ärende' },
  { key: 'onReply', label: 'Svar i ärende' }
]

// Vue's parser reads a literal `{{` inside an interpolation as the closing
// brace, so the placeholder names are built here rather than written in markup.
const CONTENT_TOKEN = '{{content}}'

const PLACEHOLDER_HINT = [
  'subject', 'from', 'fromName', 'fromEmail', 'category', 'orgName',
  'messageId', 'threadId', 'url', 'receivedAt', 'body'
].map((n) => `{{${n}}}`).join(' ')

// The webhook saves on a button, so the form is a local copy rather than the
// store's - a half-typed template should not be written on every keystroke.
const webhookForm = reactive({
  url: '', template: '', envelope: '', token: '', onNewIssue: true, onReply: true
})

const toChoice = (v) => (v === true ? 'on' : v === false ? 'off' : 'inherit')
const fromChoice = (v) => (v === 'on' ? true : v === 'off' ? false : null)

// A row written before the flags were split carries neither key, or only the
// old one — and back then that one governed both events, absent meaning on.
// Show what the admin ALREADY GETS, so saving an unrelated edit pins it rather
// than moving them onto an org default they never chose. Mirrors carryNotifyFlags
// in the service; the server applies the same rule when the field is omitted.
const storedChoice = (admin, field) =>
  admin[field] === undefined
    ? toChoice(admin.notifyNewIssue !== false)
    : toChoice(admin[field])

const blankForm = () => ({
  email: '',
  name: '',
  role: 'admin',
  categories: '',
  notify: { newIssue: 'inherit', reply: 'inherit' }
})

const form = reactive(blankForm())

onMounted(async () => {
  store.loadAdminsAction()
  await settings.loadSettingsAction()
  const { enabled, ...saved } = settings.webhook
  Object.assign(webhookForm, saved)
})

const saveWebhook = async () => {
  try {
    await settings.updateWebhookAction({ ...webhookForm })
  } catch {
    // Reported through settings.error.webhook, below the form.
  }
}

// The server's own words when it refused the input - an unknown placeholder or
// a URL it will not fetch - because those name what to fix.
const webhookError = computed(() =>
  settings.error.webhook?.code === 'WEBHOOK_INVALID'
    ? settings.error.webhook.message
    : 'Kunde inte spara.'
)

const saveDefault = (key, value) =>
  settings.updateNotifyDefaultsAction({ [key]: value === 'on' })

const saveError = computed(() =>
  store.error.save?.code === 'LAST_SUPERADMIN'
    ? 'Det måste finnas minst en superadmin.'
    : 'Kunde inte spara.'
)

const openNew = () => {
  editing.value = false
  Object.assign(form, blankForm())
  store.error.save = null
  modalOpen.value = true
}

const openEdit = (a) => {
  editing.value = true
  Object.assign(form, {
    email: a.email,
    name: a.name,
    role: a.role,
    categories: (a.categories || []).join(', '),
    notify: Object.fromEntries(
      NOTIFY_EVENTS.map((e) => [e.key, storedChoice(a, e.field)])
    )
  })
  store.error.save = null
  modalOpen.value = true
}

const parseCategories = () =>
  form.categories
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)

const save = async () => {
  const payload = {
    name: form.name,
    role: form.role,
    categories: form.role === 'superadmin' ? [] : parseCategories(),
    ...Object.fromEntries(
      NOTIFY_EVENTS.map((e) => [e.field, fromChoice(form.notify[e.key])])
    )
  }
  try {
    if (editing.value) {
      await store.updateAdminAction(form.email, payload)
    } else {
      await store.createAdminAction({ ...payload, email: form.email })
    }
    modalOpen.value = false
  } catch {
    // error surfaced in the modal
  }
}

const onDelete = async (a) => {
  if (!window.confirm(`Ta bort ${a.email}?`)) return
  try {
    await store.deleteAdminAction(a.email)
  } catch {
    window.alert('Kunde inte ta bort (kanske sista superadmin).')
  }
}
</script>

<style scoped>
.page {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.page-head {
  padding: 22px 40px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-2);
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
}
.page-body {
  padding: 22px 40px;
}
.page-tabs {
  padding: 0 40px;
  align-items: center;
  border-bottom: 1px solid var(--border);
  margin-bottom: 0;
}
.add-admin {
  margin-top: 14px;
}
.notify-defaults {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
  max-width: 520px;
}
.notify-defaults h2 {
  font-size: 15px;
  margin: 0 0 4px;
}
.notify-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 12px;
}
.notify-row .form-control {
  width: 200px;
}
.webhook {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
  max-width: 640px;
}
.webhook h2 {
  font-size: 15px;
  margin: 0 0 4px;
}
.field {
  margin-top: 12px;
}
.hint {
  font-size: 0.8rem;
  margin: 2px 0 6px;
  word-break: break-word;
}
.template {
  font-family: ui-monospace, monospace;
  font-size: 0.82rem;
}
.advanced {
  margin-top: 16px;
}
.advanced summary {
  cursor: pointer;
  font-size: 0.86rem;
  color: var(--fg-2);
}
.webhook-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
.test-result {
  font-size: 0.86rem;
  margin-top: 12px;
}
.stack-12 {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
