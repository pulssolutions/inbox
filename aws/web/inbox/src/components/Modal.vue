<template>
  <Teleport to="body">
    <div v-if="open" class="app-modal-backdrop" @click.self="$emit('close')">
      <div class="app-modal" role="dialog" :aria-label="title">
        <header class="app-modal-head">
          <h3>{{ title }}</h3>
          <button
            type="button"
            class="app-modal-x"
            data-testid="modal-close"
            aria-label="Stäng"
            @click="$emit('close')"
          >
            ×
          </button>
        </header>
        <div class="app-modal-body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="app-modal-foot">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, required: true }
})
defineEmits(['close'])
</script>

<style>
.app-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 15, 20, 0.55);
  backdrop-filter: blur(4px);
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 20px;
}
.app-modal {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 14px;
  max-width: 520px;
  width: 100%;
  box-shadow: var(--shadow-lg);
}
.app-modal-head {
  padding: 18px 22px;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.app-modal-head h3 {
  margin: 0;
  font-size: 1.05rem;
}
.app-modal-x {
  background: transparent;
  border: 0;
  font-size: 1.4rem;
  cursor: pointer;
  color: var(--fg-3);
  line-height: 1;
}
.app-modal-x:hover {
  color: var(--fg);
}
.app-modal-body {
  padding: 22px;
}
.app-modal-foot {
  padding: 14px 22px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  background: var(--bg-3);
}
</style>
