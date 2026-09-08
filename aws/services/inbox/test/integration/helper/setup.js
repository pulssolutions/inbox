import { FakeDocClient } from '../../helper/fake-doc-client.js'
import { FakeSes } from '../../helper/fake-ses.js'
import { FakeMailStore } from '../../helper/fake-mail-store.js'
import { Database } from '../../../src/database.js'
import { createApp } from '../../../src/app.js'
import { handler, __setApp } from '../../../src/index.js'

const SENDER = 'support@acme.example'

export const buildHarness = () => {
  const docClient = new FakeDocClient()
  const db = new Database({ docClient, tableName: 'inbox-test' })
  const ses = new FakeSes()
  const mailStore = new FakeMailStore()
  const app = createApp({ deps: { db, ses, mailStore, sender: SENDER } })
  __setApp(app)
  return { docClient, db, ses, mailStore, handler }
}

export const parseBody = (res) => (res.body ? JSON.parse(res.body) : null)
