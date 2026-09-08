// Passwordless email one-time-code sign-in via the Cognito IDP JSON API.
// No SDK — plain fetch against the choice-based USER_AUTH flow. Tokens come
// from the same user pool/app client as the Google Hosted UI flow, so the API
// authorizer and pre-token claims work identically for both.

import CONFIG from '@/config'
import { sessionFromTokens } from '@/auth/cognito'

const endpoint = () => `https://cognito-idp.${CONFIG.cognito.region}.amazonaws.com/`

const idpCall = async (target, payload) => {
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`
    },
    body: JSON.stringify(payload)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Cognito error type looks like "...#UserNotFoundException".
    const type = String(data.__type || '').split('#').pop() || 'AUTH_OTP_ERROR'
    const err = new Error(type)
    err.cognitoType = type
    throw err
  }
  return data
}

// Start a passwordless sign-in: emails a one-time code to `email` and returns
// the opaque session used to verify it.
export const requestCode = async (email) => {
  const username = String(email).trim().toLowerCase()
  const data = await idpCall('InitiateAuth', {
    AuthFlow: 'USER_AUTH',
    ClientId: CONFIG.cognito.clientId,
    AuthParameters: {
      USERNAME: username,
      PREFERRED_CHALLENGE: 'EMAIL_OTP'
    }
  })
  return { username, session: data.Session, challenge: data.ChallengeName }
}

// Complete sign-in with the emailed code. Returns the same session shape as the
// Google callback (see sessionFromTokens); throws AUTH_NO_ORG if the account
// has no inbox membership.
export const verifyCode = async ({ username, code, session }) => {
  const data = await idpCall('RespondToAuthChallenge', {
    ClientId: CONFIG.cognito.clientId,
    ChallengeName: 'EMAIL_OTP',
    Session: session,
    ChallengeResponses: {
      USERNAME: username,
      EMAIL_OTP_CODE: String(code).trim()
    }
  })
  const r = data.AuthenticationResult
  if (!r) {
    // A wrong/expired code comes back as another EMAIL_OTP challenge instead of
    // tokens; surface it as an invalid-code error for the UI.
    throw new Error('AUTH_OTP_INVALID')
  }
  return sessionFromTokens({
    id_token: r.IdToken,
    access_token: r.AccessToken,
    refresh_token: r.RefreshToken,
    expires_in: r.ExpiresIn
  })
}
