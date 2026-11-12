# Custom command adapter

Run reviews through your own agent program. Recoder starts the command once per turn, writes one JSON request to
its stdin, and reads JSON events from its stdout, one object per line. The protocol is versioned; the schemas are
in `apps/server/src/agents/custom/custom-protocol.ts` and the adapter in
`apps/server/src/agents/custom/custom-command.ts`. It follows the [adapter contract](adapter-contract.md).

## Configure it

Set `RECODER_CUSTOM_AGENT` in the server's environment to JSON:

```json
{ "argv": ["/opt/my-agent/bin/my-agent", "--recoder"], "name": "My agent", "maxOutputBytes": 8388608 }
```

| Field            | Meaning                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `argv`           | The command and its arguments, as an array. It is run as given, never through a shell. The first entry is an absolute path or a command on `PATH`. |
| `name`           | What Settings and error messages call it. Default `Custom command`.                           |
| `maxOutputBytes` | The most a turn may print to stdout; past it the command is killed. Default 8 MiB, at most 64 MiB. |

The command runs in an empty directory. Its environment is the server's without `RECODER_*`, `OPENAI_*`,
`ANTHROPIC_*`, `*_TOKEN`, `*_API_KEY` and anything named like a secret or password, so give it its own
credentials in its own config. Its models are listed as `custom-command:<model id>`.

## Protocol version 1

Every request and every event carries `"protocol": "recoder.agent"` and `"version": 1`. A command that prints
another version fails the turn with an error naming both versions.

### Requests

`describe` asks who the command is and which models it runs. Recoder sends it for the status check and the
model list, and waits at most 10 seconds.

```json
{ "protocol": "recoder.agent", "version": 1, "kind": "describe" }
```

`turn` runs the model on the conversation until it answers:

```json
{
	"protocol": "recoder.agent",
	"version": 1,
	"kind": "turn",
	"model": "deep",
	"reasoningEffort": "high",
	"system": "You review one slice of a pull request…",
	"messages": [{ "role": "user", "content": "Review the change to src/cart.ts." }],
	"session": null,
	"tools": [
		{
			"name": "read_diff",
			"description": "Read the pull request patch for one file, or for the hunks named.",
			"inputSchema": { "type": "object", "properties": { "path": { "type": "string" } }, "required": [] }
		}
	],
	"mcp": { "server": "recoder1", "url": "http://127.0.0.1:41234/mcp/3q2…" },
	"schema": { "type": "object" },
	"timeoutMs": 600000
}
```

| Field             | Meaning                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `messages`        | The conversation so far, oldest first (`user` and `assistant`). The last one is the one to answer.       |
| `session`         | The `session` the previous turn's result returned, so the command can resume its own state; else null. |
| `tools`, `mcp`    | The Recoder tools this turn may call, served over MCP (streamable HTTP, JSON-RPC `tools/list` and `tools/call`) at `mcp.url`. Null and empty when the turn has none. These are the command's only way to the repository: reads are limited to what the review permits, and `run` executes in Recoder's sandbox. |
| `schema`          | The JSON schema of the answer, or null for free text.                                                   |
| `timeoutMs`       | When Recoder stops the turn. Recoder also kills the command when the review is cancelled.               |

### Events

| `type`      | Fields                                                              | Meaning                                         |
| ----------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| `describe`  | `name?`, `agentVersion`, `models: [{id, label, contextWindow?, efforts?, defaultEffort?}]` | The answer to `describe`.  |
| `step`      | `id?`                                                               | A model call starts. Each one counts against the review's call budget. |
| `text`      | `text`                                                              | Answer text as it streams.                      |
| `reasoning` | `text`                                                              | Reasoning text as it streams.                   |
| `usage`     | `id?`, `inputTokens?`, `outputTokens?`, `cachedInputTokens?`, `cacheWriteInputTokens?`, `reasoningOutputTokens?` | A model call ended, having used this much. |
| `warning`   | `message`                                                           | Something the turn survives; Recoder logs it.   |
| `error`     | `kind`, `message`                                                   | The turn failed. `kind` is `auth` (sign in), `usage_limit` (plan spent), `rate_limit` (retry later), `overloaded`, `invalid_request` or `other`. |
| `result`    | `text`, `structured?`, `session?`                                   | The answer. With a schema, `text` holds the JSON (or put the object in `structured`). |

A turn ends with exactly one `result` or `error` event, then the command exits 0. Recoder fails the turn when a
line is not JSON or does not match its event, when anything is printed after the last event, when the command
exits without a result or with a non-zero code (the last stderr line is quoted), when it passes the output cap,
and when it runs out of time.

A complete turn's output:

```json
{"protocol":"recoder.agent","version":1,"type":"step","id":"call-1"}
{"protocol":"recoder.agent","version":1,"type":"reasoning","text":"The total skips the discount."}
{"protocol":"recoder.agent","version":1,"type":"text","text":"{\"message\":\"One bug.\",\"findings\":[]}"}
{"protocol":"recoder.agent","version":1,"type":"usage","id":"call-1","inputTokens":5120,"outputTokens":240}
{"protocol":"recoder.agent","version":1,"type":"result","text":"{\"message\":\"One bug.\",\"findings\":[]}","session":"abc"}
```

The answer to `describe`:

```json
{"protocol":"recoder.agent","version":1,"type":"describe","name":"My agent","agentVersion":"0.4.1","models":[{"id":"deep","label":"Deep","efforts":["low","high"],"defaultEffort":"high"}]}
```
