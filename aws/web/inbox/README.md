# inbox-web

The agent web app: Vue 3, Pinia, Vite. Reads and answers tickets through the
inbox API.

## Configuration comes from the environment

Nothing per-account is committed. `scripts/deploy.mjs` writes `.env.local` from
the deployment profile and the inbox stack's outputs at build time:

```
VITE_API_BASE, VITE_COGNITO_DOMAIN, VITE_USER_POOL_ID,
VITE_USER_POOL_CLIENT_ID, VITE_AWS_REGION, VITE_BRAND_*
```

`src/config.js` reads only those and logs loudly if a required one is missing —
a missing pool id otherwise shows up as a login page that silently cannot
authenticate.

## Local development

```bash
yarn install
yarn dev      # needs a .env.local; copy one from a deployed stack, or point
              # VITE_API_BASE at the local API (npm run dev in services/inbox)
yarn test
yarn lint
yarn build    # → site/
```

## Sign-in

Google via Hosted UI (authorization code + PKCE, plain fetch and WebCrypto — no
Amplify), or a passwordless email one-time code straight against the Cognito
IDP API. Both produce the same session shape.

Authenticating and having access are separate: a token with an empty `orgs`
claim is rejected by the session layer, because membership lives in the claim
rather than in the pool.

Capability checks in the UI mirror the server's, but they are UX only — the API
is the authority.

## Language

Swedish, hardcoded. Only the emails the service sends are localized; see
`docs/email.md`.

## Tests

The suite pins its brand variables in `vitest.config.js`. Without that it reads
whatever `.env.local` the last deploy wrote, and assertions pass or fail
depending on who deployed last.
