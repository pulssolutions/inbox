<template>
  <div class="login-shell">
    <div class="login-card">
      <div class="brand-big">
        <img :src="logo" :alt="BRAND.short" @error="brandLogoBroken = true" />
        <span class="brand-tag">{{ BRAND.short }} · {{ BRAND.tagline }}</span>
      </div>

      <!-- Org picker (access to more than one organisation) -->
      <template v-if="session.needsOrgSelection">
        <h1>Välj organisation</h1>
        <p class="sub">Du har tillgång till flera organisationer.</p>
        <button
          v-for="o in session.orgOptions"
          :key="o.org"
          type="button"
          class="btn btn-secondary btn-block org-option"
          data-testid="org-option"
          @click="pickOrg(o.org)"
        >
          {{ o.name }}
        </button>
      </template>

      <!-- Normal login -->
      <template v-else>
        <h1>Logga in</h1>
        <p class="sub">Internt verktyg för ärendehantering.</p>

        <!-- The session ended on its own rather than by clicking "logga ut" —
             say so, otherwise an expired session looks like a broken app. -->
        <p v-if="sessionExpired" class="sub" data-testid="session-expired">
          Din inloggning har gått ut. Logga in igen.
        </p>

        <button
          type="button"
          class="btn btn-google btn-block"
          data-testid="google-signin"
          :disabled="signingIn"
          @click="handleSignIn"
        >
          <span class="g-mark" aria-hidden="true">G</span>
          {{ signingIn ? 'Loggar in…' : 'Fortsätt med Google' }}
        </button>

        <div class="divider"><span>eller</span></div>

        <!-- Email one-time-code: enter email, receive a code, verify it. -->
        <form v-if="otpStep === 'email'" class="otp-form" @submit.prevent="handleSendCode">
          <input
            v-model="otpEmail"
            type="email"
            class="otp-input"
            data-testid="otp-email"
            placeholder="name@company.se"
            autocomplete="email"
            required
          />
          <button
            type="submit"
            class="btn btn-secondary btn-block"
            data-testid="otp-send"
            :disabled="otpBusy || !otpEmail"
          >
            {{ otpBusy ? 'Skickar…' : 'Skicka inloggningskod' }}
          </button>
        </form>

        <form v-else class="otp-form" @submit.prevent="handleVerifyCode">
          <p class="otp-hint" data-testid="otp-sent">
            Vi skickade en kod till <strong>{{ otpEmail }}</strong>.
          </p>
          <input
            v-model="otpCode"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            class="otp-input"
            data-testid="otp-code"
            placeholder="Inloggningskod"
            required
          />
          <button
            type="submit"
            class="btn btn-primary btn-block"
            data-testid="otp-verify"
            :disabled="otpBusy || !otpCode"
          >
            {{ otpBusy ? 'Loggar in…' : 'Logga in' }}
          </button>
          <button type="button" class="btn-link" data-testid="otp-restart" @click="resetOtp">
            Använd en annan e-postadress
          </button>
        </form>

        <p v-if="errorKind === 'no-org'" class="form-error" data-testid="no-access">
          Ditt konto har inte åtkomst. Kontakta en administratör.
        </p>
        <p v-else-if="otpError" class="form-error" data-testid="otp-error">
          {{ otpError }}
        </p>
        <p v-else-if="errorKind" class="form-error">
          Inloggning misslyckades. Försök igen.
        </p>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAdminSessionStore } from '@/stores/admin-session-store'
import { BRAND } from '@/config'
import fallbackLogo from '@/assets/images/logo.svg'
import { useThemeStore } from '@/stores/theme-store'

const router = useRouter()
const route = useRoute()
const session = useAdminSessionStore()
const theme = useThemeStore()
// Brand artwork comes from the deployment profile (staged under /brand at
// build time). No configured logo -> the product's own neutral mark.
const brandLogoBroken = ref(false)
const logo = computed(() => {
  const configured = theme.effectiveTheme === 'dark' ? BRAND.logoDark : BRAND.logo
  // Fall back when the artwork is unset OR fails to load: a profile pointing at
  // a path that was never staged would otherwise render a 0-width broken image
  // rather than the product's own mark.
  return configured && !brandLogoBroken.value ? configured : fallbackLogo
})

const signingIn = ref(false)
const errorKind = ref(null)

// Set when a refresh was rejected outright (invalid_grant) — a transient failure
// keeps the session, so landing here after one means the session really ended.
const sessionExpired = computed(() => Boolean(session.lastRefreshError?.definitive))

// Email one-time-code state. otpStep flips from 'email' to 'code' once a code
// has been sent; otpSession/otpUsername carry Cognito's challenge between steps.
const otpStep = ref('email')
const otpEmail = ref('')
const otpCode = ref('')
const otpSession = ref(null)
const otpUsername = ref('')
const otpBusy = ref(false)
const otpError = ref(null)

const resetOtp = () => {
  otpStep.value = 'email'
  otpCode.value = ''
  otpSession.value = null
  otpUsername.value = ''
  otpError.value = null
}

const handleSendCode = async () => {
  if (otpBusy.value) return
  otpBusy.value = true
  otpError.value = null
  errorKind.value = null
  try {
    const challenge = await session.requestOtp(otpEmail.value)
    otpUsername.value = challenge.username
    otpSession.value = challenge.session
    otpStep.value = 'code'
  } catch {
    // Don't reveal whether the address exists — same message either way.
    otpError.value = 'Kunde inte skicka kod. Kontrollera adressen och försök igen.'
  } finally {
    otpBusy.value = false
  }
}

const handleVerifyCode = async () => {
  if (otpBusy.value) return
  otpBusy.value = true
  otpError.value = null
  try {
    await session.verifyOtp({
      username: otpUsername.value,
      code: otpCode.value,
      session: otpSession.value
    })
    if (!session.needsOrgSelection) goAfterAuth()
  } catch (e) {
    if (e?.message === 'AUTH_NO_ORG') {
      errorKind.value = 'no-org'
      resetOtp()
    } else {
      otpError.value = 'Fel eller utgången kod. Försök igen.'
    }
  } finally {
    otpBusy.value = false
  }
}

const goAfterAuth = () => {
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && redirect.startsWith('/')) {
    router.replace(redirect)
  } else {
    router.replace({ name: 'inbox' })
  }
}

onMounted(async () => {
  // Cognito Hosted UI redirects back to the app root with ?code=...&state=... in
  // the server query (before the hash), so read window.location.search — not the
  // hash-scoped route.query. Fall back to route.query for any direct navigation.
  const search = new URLSearchParams(window.location.search)
  const code = search.get('code') || (typeof route.query.code === 'string' ? route.query.code : null)
  const state = search.get('state') || (typeof route.query.state === 'string' ? route.query.state : undefined)
  if (typeof code === 'string') {
    signingIn.value = true
    try {
      await session.completeCallback({ code, state })
      // Strip the one-time code from the URL so a reload can't replay it.
      window.history.replaceState({}, '', window.location.pathname + window.location.hash)
      // Multi-org users land on the picker (rendered above); others go straight in.
      if (!session.needsOrgSelection) goAfterAuth()
    } catch (e) {
      errorKind.value = e?.message === 'AUTH_NO_ORG' ? 'no-org' : 'generic'
    } finally {
      signingIn.value = false
    }
  }
})

const pickOrg = (org) => {
  session.selectOrg(org)
  goAfterAuth()
}

const handleSignIn = async () => {
  if (signingIn.value) return
  signingIn.value = true
  errorKind.value = null
  try {
    await session.signInWithGoogle()
  } catch {
    errorKind.value = 'generic'
    signingIn.value = false
  }
}
</script>

<style scoped>
.brand-tag {
  font-size: 0.74rem;
  color: var(--fg-3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 700;
}
.org-option {
  margin-top: 8px;
  justify-content: flex-start;
}
.divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 18px 0 14px;
  color: var(--fg-3);
  font-size: 0.78rem;
}
.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border, rgba(0, 0, 0, 0.12));
}
.otp-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.otp-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border, rgba(0, 0, 0, 0.18));
  border-radius: 8px;
  font-size: 1rem;
}
.otp-hint {
  margin: 0;
  font-size: 0.86rem;
  color: var(--fg-2);
}
.btn-link {
  background: none;
  border: none;
  padding: 4px;
  color: var(--fg-3);
  font-size: 0.82rem;
  text-decoration: underline;
  cursor: pointer;
}
</style>
