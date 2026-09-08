import { describe, it, expect, beforeEach, vi } from 'vitest'
import { requestCode, verifyCode } from '@/auth/otp'

// Minimal unsigned JWT with the given payload (sessionFromTokens only decodes,
// never verifies, the id_token).
const jwt = (payload) => {
  const b64 = (o) =>
    Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '')
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`
}

const okJson = (body) => ({ ok: true, json: async () => body })
const errJson = (type) => ({ ok: false, json: async () => ({ __type: `com.x#${type}` }) })

describe('auth/otp', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('requestCode starts USER_AUTH email-OTP and returns the challenge', async () => {
    fetch.mockResolvedValueOnce(okJson({ Session: 'sess-1', ChallengeName: 'EMAIL_OTP' }))
    const out = await requestCode('  Leader@Klubben.SE ')

    const [url, opts] = fetch.mock.calls[0]
    expect(url).toMatch(/^https:\/\/cognito-idp\.eu-north-1\.amazonaws\.com\/$/)
    expect(opts.headers['X-Amz-Target']).toBe(
      'AWSCognitoIdentityProviderService.InitiateAuth'
    )
    const body = JSON.parse(opts.body)
    expect(body.AuthFlow).toBe('USER_AUTH')
    expect(body.AuthParameters).toMatchObject({
      USERNAME: 'leader@klubben.se',
      PREFERRED_CHALLENGE: 'EMAIL_OTP'
    })
    expect(out).toEqual({ username: 'leader@klubben.se', session: 'sess-1', challenge: 'EMAIL_OTP' })
  })

  it('verifyCode exchanges the code for a session', async () => {
    const id = jwt({ email: 'a@b.se', orgs: JSON.stringify({ rbk: { name: 'RBK' } }) })
    fetch.mockResolvedValueOnce(
      okJson({
        AuthenticationResult: {
          IdToken: id,
          AccessToken: 'at',
          RefreshToken: 'rt',
          ExpiresIn: 3600
        }
      })
    )
    const s = await verifyCode({ username: 'a@b.se', code: ' 123456 ', session: 'sess-1' })

    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.ChallengeName).toBe('EMAIL_OTP')
    expect(body.ChallengeResponses).toMatchObject({
      USERNAME: 'a@b.se',
      EMAIL_OTP_CODE: '123456'
    })
    expect(s).toMatchObject({ idToken: id, accessToken: 'at', refreshToken: 'rt' })
    expect(s.orgs).toEqual({ rbk: { name: 'RBK' } })
  })

  it('verifyCode rejects with AUTH_NO_ORG when the account has no membership', async () => {
    const id = jwt({ email: 'a@b.se', orgs: JSON.stringify({}) })
    fetch.mockResolvedValueOnce(
      okJson({ AuthenticationResult: { IdToken: id, AccessToken: 'at', ExpiresIn: 3600 } })
    )
    await expect(
      verifyCode({ username: 'a@b.se', code: '1', session: 's' })
    ).rejects.toThrow('AUTH_NO_ORG')
  })

  it('verifyCode rejects a wrong/expired code (no tokens returned)', async () => {
    fetch.mockResolvedValueOnce(okJson({ ChallengeName: 'EMAIL_OTP', Session: 's2' }))
    await expect(
      verifyCode({ username: 'a@b.se', code: '0', session: 's' })
    ).rejects.toThrow('AUTH_OTP_INVALID')
  })

  it('surfaces Cognito error types from a failed call', async () => {
    fetch.mockResolvedValueOnce(errJson('UserNotFoundException'))
    await expect(requestCode('x@y.se')).rejects.toMatchObject({
      cognitoType: 'UserNotFoundException'
    })
  })
})
