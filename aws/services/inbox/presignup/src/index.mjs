// Cognito pre-sign-up trigger for the inbox service.
//
// Cognito creates a separate user object the first time someone signs in with
// Google (username `Google_<sub>`). To keep one account per email — so a person
// can use either Google *or* the email one-time-code and land on the same
// account — we make the native (email) user canonical and link the Google
// identity to it here, on that first federated sign-in.
//
// The native user is provisioned when an admin is added (API) or by the
// backfill script, so by the time Google linking runs it already exists.
//
// Only `PreSignUp_ExternalProvider` is acted on. Admin-created native users
// (`PreSignUp_AdminCreateUser`) and any other source pass through untouched.

import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminLinkProviderForUserCommand
} from '@aws-sdk/client-cognito-identity-provider'

let _client = null
export const __setClient = (c) => {
  _client = c
}
const getClient = () => {
  if (_client) return _client
  _client = new CognitoIdentityProviderClient({})
  return _client
}

// Username of a federated user looks like `Google_1234567890`. Split on the
// first underscore: everything before is the provider, everything after is the
// provider's subject id.
const splitFederatedUsername = (userName) => {
  const sep = String(userName || '').indexOf('_')
  if (sep <= 0) return null
  return {
    providerName: userName.slice(0, sep),
    providerUserId: userName.slice(sep + 1)
  }
}

const isFederatedUsername = (userName) => /_/.test(String(userName || ''))

// The native (email/password) user for an email is the one whose username is
// not a `Provider_subject` federated handle.
const findNativeUser = async ({ client, userPoolId, email }) => {
  const res = await client.send(
    new ListUsersCommand({
      UserPoolId: userPoolId,
      Filter: `email = "${email}"`,
      Limit: 10
    })
  )
  const users = res.Users || []
  return users.find((u) => !isFederatedUsername(u.Username)) || null
}

export const handler = async (event = {}) => {
  if (event.triggerSource !== 'PreSignUp_ExternalProvider') return event

  const userPoolId = event.userPoolId
  const email = event?.request?.userAttributes?.email
    ? String(event.request.userAttributes.email).toLowerCase()
    : null
  const federated = splitFederatedUsername(event.userName)
  if (!userPoolId || !email || !federated) return event

  const client = getClient()
  const native = await findNativeUser({ client, userPoolId, email })
  // No native user → not a provisioned admin. Let Cognito create the standalone
  // federated user; they get no org claims and are rejected downstream anyway.
  if (!native) return event

  await client.send(
    new AdminLinkProviderForUserCommand({
      UserPoolId: userPoolId,
      DestinationUser: {
        ProviderName: 'Cognito',
        ProviderAttributeValue: native.Username
      },
      SourceUser: {
        ProviderName: federated.providerName,
        ProviderAttributeName: 'Cognito_Subject',
        ProviderAttributeValue: federated.providerUserId
      }
    })
  )

  event.response = event.response || {}
  event.response.autoConfirmUser = true
  event.response.autoVerifyEmail = true
  return event
}
