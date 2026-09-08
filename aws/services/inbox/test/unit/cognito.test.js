import { describe, it, expect } from 'vitest'
import { Cognito } from '../../src/cognito.js'

// Fake Cognito client recording the commands it receives. `failCreateWith`
// makes AdminCreateUser throw an error with that `name`.
const fakeClient = ({ failCreateWith = null } = {}) => {
  const calls = { create: [], setPw: [], update: [] }
  return {
    calls,
    async send(cmd) {
      const name = cmd.constructor.name
      if (name === 'AdminCreateUserCommand') {
        calls.create.push(cmd.input)
        if (failCreateWith) {
          const err = new Error(failCreateWith)
          err.name = failCreateWith
          throw err
        }
        return {}
      }
      if (name === 'AdminSetUserPasswordCommand') {
        calls.setPw.push(cmd.input)
        return {}
      }
      if (name === 'AdminUpdateUserAttributesCommand') {
        calls.update.push(cmd.input)
        return {}
      }
      throw new Error(`unexpected command ${name}`)
    }
  }
}

describe('Cognito.ensureNativeUser', () => {
  it('creates a verified, confirmed user (lowercased email)', async () => {
    const client = fakeClient()
    await new Cognito({ client, userPoolId: 'pool-1' }).ensureNativeUser({
      email: 'Leader@Acme.EXAMPLE'
    })
    expect(client.calls.create[0]).toMatchObject({
      UserPoolId: 'pool-1',
      Username: 'leader@acme.example',
      MessageAction: 'SUPPRESS',
      UserAttributes: [
        { Name: 'email', Value: 'leader@acme.example' },
        { Name: 'email_verified', Value: 'true' }
      ]
    })
    expect(client.calls.setPw[0]).toMatchObject({
      Username: 'leader@acme.example',
      Permanent: true
    })
    expect(client.calls.setPw[0].Password).toMatch(/Aa1$/)
    expect(client.calls.update).toHaveLength(0)
  })

  it('re-asserts email_verified when the user already exists', async () => {
    const client = fakeClient({ failCreateWith: 'UsernameExistsException' })
    await new Cognito({ client, userPoolId: 'pool-1' }).ensureNativeUser({
      email: 'a@b.se'
    })
    expect(client.calls.setPw).toHaveLength(0)
    expect(client.calls.update[0]).toMatchObject({
      Username: 'a@b.se',
      UserAttributes: [{ Name: 'email_verified', Value: 'true' }]
    })
  })

  it('propagates unexpected create errors', async () => {
    const client = fakeClient({ failCreateWith: 'InternalErrorException' })
    await expect(
      new Cognito({ client, userPoolId: 'pool-1' }).ensureNativeUser({ email: 'a@b.se' })
    ).rejects.toMatchObject({ name: 'InternalErrorException' })
  })

  it('no-ops without a configured pool id', async () => {
    const client = fakeClient()
    await new Cognito({ client, userPoolId: undefined }).ensureNativeUser({ email: 'a@b.se' })
    expect(client.calls.create).toHaveLength(0)
  })
})
