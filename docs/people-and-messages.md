# People and direct messages

Recoder profiles show a person's activity in tracked repositories, whether or not they signed in.
Only another active Recoder account can receive direct messages. Recoder doesn't queue messages or send invitations
for people who haven't joined, and bot profiles can't be invited or messaged.

| Route | Result |
| --- | --- |
| `GET /api/people` | The active accounts you can start a conversation with. |
| `GET /api/people/:provider/:login` | The person's profile, including open pulls, recent merges, reviews and findings. Supply `?host=` for self-managed GitLab. A forge failure on one repository doesn't hide the others. |
| `GET /api/messages` | Your conversations, newest message first. |
| `POST /api/messages` | Starts or retrieves a conversation with `{ accountId }`. An unavailable recipient returns 409. |
| `GET /api/messages/:id` | Up to 50 messages, oldest first, with a `before` cursor for the next older page. |
| `POST /api/messages/:id` | Sends `{ clientId, body, attachments }`. Retrying the same client ID returns the stored message. The limit is 30 sends per person per minute (429). |
| `POST /api/messages/:id/read` | Advances your read mark with `{ through }`, visible to the other participant. |
| `GET /api/messages/events` | Your live inbox. It sends a snapshot or replays changes after `Last-Event-ID`, and sends a new snapshot if that cursor is gone. Heartbeats have no event ID. |

Messages require a signed-in browser session, not the server's machine token. A conversation is readable only by its
participants; there's no admin inbox. If the admin removes someone, the other participant keeps the history but can't
send new messages. Messages aren't included in usage or telemetry. Direct messages are included in portable backups
and database backups. Anyone who can download or restore an archive can access its messages, so restrict backups
like the live database.
