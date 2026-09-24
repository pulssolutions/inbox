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
      <p class="muted">Settings here later</p>
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

      <section class="notify-defaults">
        <h2>E-post som standard</h2>
        <p class="muted">
          Gäller administratörer som inte valt något eget. Var och en kan sätta
          sitt eget värde i listan ovan.
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

onMounted(() => {
  store.loadAdminsAction()
  settings.loadSettingsAction()
})

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
.stack-12 {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
