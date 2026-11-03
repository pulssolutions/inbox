# MCP server

The API exposes an [MCP](https://modelcontextprotocol.io) endpoint at
`POST /mcp`, so an AI agent can work the inbox with the same authorization,
category scoping and audit trail as an admin in the web app.

## Issuing a token

A superadmin creates tokens under **Admin → Settings → API-nycklar**: a name
(what the agent is called in the audit log) and the admin it acts as. The
secret, `inbx_…`, is shown once. Delete the row to revoke it.

A token is exactly as powerful as its owner's admin row, read live on every
request: a scoped admin's token sees only their categories, a deactivated or
removed owner's token stops working at once.

## Connecting

```bash
claude mcp add --transport http inbox https://<api>/mcp \
  --header "Authorization: Bearer inbx_..."
```

Any Streamable HTTP client works. The transport is stateless: no session id,
one JSON response per request.

## Tools

| Tool | Does |
| --- | --- |
| `list_messages` | One page of threads (`box`, `category`, `state`, `assignment`, `cursor`) |
| `search_messages` | Search subjects, senders and categories |
| `get_message` | A thread, text only, with attachment metadata and notes; marks it read and seen |
| `reply` | Email the sender from the category address; auto-assigns an unassigned thread |
| `add_note` | Internal note |
| `set_state` | `open`, `pending` or `done` |
| `archive_message` | Archive, or move back to the inbox |
| `assign_message` | Assign to an admin email, or `null` |

`messageId` is the thread root or any message in it. An error comes back as a
tool error, `CODE: message`; a thread outside the owner's categories is
`MESSAGE_NOT_FOUND`, as in the API.

## Attribution

Everything an agent does is audited as the owner, with the token's name and
`via: mcp`. Replies are sent as the owner (`sentBy`), and colleague
notifications go out as for a human reply.
