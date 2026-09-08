import { describe, it, expect, afterEach } from 'vitest'
import { handler, __setClient } from '../../src/index.mjs'

// Fake Cognito client: ListUsersCommand returns the seeded users; records any
// AdminLinkProviderForUserCommand it receives.
const fakeClient = ({ users = [] } = {}) => {
  const calls = { list: [], link: [] }
  return {
    calls,
    async send(cmd) {
      const name = cmd.constructor.name
      if (name === 'ListUsersCommand') {
        calls.list.push(cmd.input)
        return { Users: users }
      }
      if (name === 'AdminLinkProviderForUserCommand') {
        calls.link.push(cmd.input)
        return {}
      }
      throw new Error(`unexpected command ${name}`)
    }
  }
}

const externalEvent = ({ email, userName = 'Google_117', pool = 'pool-1' }) => ({
  triggerSource: 'PreSignUp_ExternalProvider',
  userName,
  userPoolId: pool,
  request: { userAttributes: { email } },
  response: {}
})

afterEach(() => __setClient(null))

describe('inbox presignup (Google account linking)', () => {
  it('links Google to the native user and auto-confirms', async () => {
    const client = fakeClient({
      users: [
        { Username: 'native-uuid-1', Attributes: [{ Name: 'email', Value: 'a@b.se' }] }
      ]
    })
    __setClient(client)

    const res = await handler(externalEvent({ email: 'a@b.se' }))

    expect(client.calls.list[0].Filter).toBe('email = "a@b.se"')
    expect(client.calls.link).toHaveLength(1)
    expect(client.calls.link[0]).toMatchObject({
      UserPoolId: 'pool-1',
      DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: 'native-uuid-1' },
      SourceUser: {
        ProviderName: 'Google',
        ProviderAttributeName: 'Cognito_Subject',
        ProviderAttributeValue: '117'
      }
    })
    expect(res.response.autoConfirmUser).toBe(true)
    expect(res.response.autoVerifyEmail).toBe(true)
  })

  it('lowercases the email before matching', async () => {
    const client = fakeClient({ users: [{ Username: 'native-uuid-1' }] })
    __setClient(client)
    await handler(externalEvent({ email: 'Mixed@Case.SE' }))
    expect(client.calls.list[0].Filter).toBe('email = "mixed@case.se"')
  })

  it('does nothing when no native user exists (non-admin Google login)', async () => {
    const client = fakeClient({
      // Only a federated user shares the email — not a native account.
      users: [{ Username: 'Google_117' }]
    })
    __setClient(client)
    const res = await handler(externalEvent({ email: 'stranger@x.se' }))
    expect(client.calls.link).toHaveLength(0)
    expect(res.response.autoConfirmUser).toBeUndefined()
  })

  it('ignores non-external triggers (e.g. admin-created native users)', async () => {
    const client = fakeClient({ users: [{ Username: 'native-uuid-1' }] })
    __setClient(client)
    const res = await handler({
      triggerSource: 'PreSignUp_AdminCreateUser',
      userName: 'native-uuid-1',
      userPoolId: 'pool-1',
      request: { userAttributes: { email: 'a@b.se' } },
      response: {}
    })
    expect(client.calls.list).toHaveLength(0)
    expect(client.calls.link).toHaveLength(0)
    expect(res.response.autoConfirmUser).toBeUndefined()
  })

  it('passes through when email is missing', async () => {
    const client = fakeClient({ users: [] })
    __setClient(client)
    const res = await handler(externalEvent({ email: undefined }))
    expect(client.calls.list).toHaveLength(0)
    expect(res).toBeDefined()
  })
})
