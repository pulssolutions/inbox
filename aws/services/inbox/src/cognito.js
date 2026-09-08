import {
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand
} from '@aws-sdk/client-cognito-identity-provider'
import { randomBytes } from 'node:crypto'

// A random permanent password just to move an admin-created user out of
// FORCE_CHANGE_PASSWORD into CONFIRMED, so passwordless email-OTP sign-in works.
// It is never used to log in. base64 covers upper/lower/digits; the suffix
// guarantees the pool's complexity rules (upper + lower + number) are met.
const randomPassword = () =>
  randomBytes(18).toString('base64').replace(/[+/=]/g, '') + 'Aa1'

// Thin wrapper over Cognito admin APIs used to provision the native (email)
// account that backs both Google and email-OTP sign-in for an inbox admin.
export class Cognito {
  constructor({ client, userPoolId }) {
    this.client = client
    this.userPoolId = userPoolId
  }

  // Ensure a confirmed native user exists for `email` with email_verified=true.
  // Idempotent: re-running just (re)asserts the verified flag.
  async ensureNativeUser({ email }) {
    if (!this.userPoolId) return
    const username = String(email).toLowerCase()
    try {
      await this.client.send(
        new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: username,
          MessageAction: 'SUPPRESS',
          UserAttributes: [
            { Name: 'email', Value: username },
            { Name: 'email_verified', Value: 'true' }
          ]
        })
      )
      await this.client.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: this.userPoolId,
          Username: username,
          Password: randomPassword(),
          Permanent: true
        })
      )
    } catch (e) {
      if (e?.name !== 'UsernameExistsException') throw e
      // Already provisioned (e.g. via Google or a prior add) — make sure the
      // email is marked verified so email-OTP delivery is allowed.
      await this.client.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: this.userPoolId,
          Username: username,
          UserAttributes: [{ Name: 'email_verified', Value: 'true' }]
        })
      )
    }
  }
}
