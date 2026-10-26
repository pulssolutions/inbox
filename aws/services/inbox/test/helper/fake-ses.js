export class FakeSes {
  constructor() {
    this.sent = []
    this.replies = []
    this.notifications = []
  }

  async sendPlainText(args) {
    this.sent.push(args)
    return { MessageId: `fake-${this.sent.length}` }
  }

  async sendReply(args) {
    this.replies.push(args)
    if (args.store) await args.store(Buffer.from('fake raw'))
    return { MessageId: `fake-reply-${this.replies.length}` }
  }

  async sendNotification(args) {
    this.notifications.push(args)
    return { MessageId: `fake-notif-${this.notifications.length}` }
  }
}
