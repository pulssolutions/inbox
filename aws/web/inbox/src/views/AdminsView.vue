<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Administratörer</h1>
        <p class="muted">Hantera vilka som har åtkomst och till vilka kategorier.</p>
      </div>
      <button type="button" class="btn btn-primary btn-sm" data-testid="add-admin" @click="openNew">
        + Ny admin
      </button>
    </div>

    <div class="page-body">
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
        <div>
          <label class="form-check">
            <input
              type="checkbox"
              v-model="form.notifyNewIssue"
              data-testid="f-notify"
            />
            Skicka e-post för nytt ärende
          </label>
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
import Modal from '@/components/Modal.vue'
import Spinner from '@/components/Spinner.vue'

const store = useAdminsStore()
const modalOpen = ref(false)
const editing = ref(false)
const form = reactive({ email: '', name: '', role: 'admin', categories: '', notifyNewIssue: true })

onMounted(() => store.loadAdminsAction())

const saveError = computed(() =>
  store.error.save?.code === 'LAST_SUPERADMIN'
    ? 'Det måste finnas minst en superadmin.'
    : 'Kunde inte spara.'
)

const openNew = () => {
  editing.value = false
  Object.assign(form, { email: '', name: '', role: 'admin', categories: '', notifyNewIssue: true })
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
    notifyNewIssue: a.notifyNewIssue !== false
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
    notifyNewIssue: form.notifyNewIssue
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
  padding: 22px 28px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-2);
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
}
.page-body {
  padding: 22px 28px;
}
.stack-12 {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
