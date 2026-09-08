import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { SESClient } from '@aws-sdk/client-ses'
import { S3Client } from '@aws-sdk/client-s3'
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider'
import pino from 'pino'
import { Database } from './database.js'
import { Ses } from './ses.js'
import { MailStore } from './mail-store.js'
import { Cognito } from './cognito.js'
import { createApp } from './app.js'
import { runNag } from './nag.js'

let appInstance

const buildDefaultDeps = () => {
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))
  const db = new Database({ docClient, tableName: process.env.TABLE_NAME })
  const ses = new Ses({
    client: new SESClient({}),
    fromAddress: process.env.SENDER_EMAIL,
    notifyFromName: process.env.NOTIFY_SENDER_NAME
  })
  // Raw MIME lives in the inbox-mail bucket in eu-west-1 (SES receiving region);
  // this Lambda runs in eu-north-1 and reads cross-region.
  const mailStore = new MailStore({
    client: new S3Client({ region: process.env.MAIL_BUCKET_REGION }),
    defaultBucket: process.env.MAIL_BUCKET
  })
  const cognito = new Cognito({
    client: new CognitoIdentityProviderClient({}),
    userPoolId: process.env.ADMIN_USER_POOL_ID
  })
  return {
    db,
    ses,
    mailStore,
    cognito,
    sender: process.env.SENDER_EMAIL,
    webBaseUrl: process.env.WEB_BASE_URL
  }
}

const getApp = () => {
  if (!appInstance) {
    appInstance = createApp({ deps: buildDefaultDeps() })
  }
  return appInstance
}

// Test seam — replace the cached app instance with one wired to fakes.
export const __setApp = (app) => {
  appInstance = app
}

export const handler = async (event, context = {}) => {
  const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    mixin: () => ({ RequestId: context.awsRequestId || 'local' })
  })
  try {
    // EventBridge schedule: the daily reminder sweep, not an HTTP request.
    if (event?.source === 'aws.events') {
      const result = await runNag(getApp().deps)
      logger.info(result, 'reminder sweep')
      return result
    }
    return await getApp().handle(event)
  } catch (err) {
    logger.error(err, 'unhandled')
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Internal error' })
    }
  }
}
