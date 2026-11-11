import type { DocPage } from '~/lib/docs';

export const mcp: DocPage = {
	slug: 'mcp',
	title: 'MCP',
	body: `\`recoder mcp\` serves Recoder’s review as MCP tools, for an agent that calls tools instead of running shell commands. It is the [CLI](/docs/cli) behind a different door: the same reviews, settings and runs. Install the CLI first.

## Add it to your agent

The server speaks MCP over standard input and output. Start it with the command \`recoder\` and the argument \`mcp\`:

\`\`\`json
{ "mcpServers": { "recoder": { "command": "recoder", "args": ["mcp"] } } }
\`\`\`

In Claude Code:

\`\`\`bash
claude mcp add recoder -- recoder mcp
\`\`\`

Paths in the tools’ arguments are read from the folder the server started in. If your agent starts it somewhere else, pass \`repo\`.

## Tools

| Tool | What it does |
| --- | --- |
| \`recoder_doctor\` | Checks that a review can run on this machine. |
| \`recoder_models\` | Lists the model ids a review accepts. Takes \`provider\` and \`search\`. |
| \`recoder_review\` | Starts a review in the background and returns its \`runId\`. Takes the same options as \`recoder review\`. |
| \`recoder_wait\` | Waits for a run to end, \`timeoutSeconds\` at a time: 45 by default, 600 at most. |
| \`recoder_status\` | Returns a run’s status at once. |
| \`recoder_result\` | Returns a finished run’s report. Takes \`format\`, \`min-severity\` and \`include-unconfirmed\`. |
| \`recoder_cancel\` | Stops a running review. |
| \`recoder_runs\` | Lists recent runs, to find a \`runId\` again. Takes \`repo\` and \`limit\`. |

## A review, start to finish

1. Call \`recoder_review\` and keep the \`runId\` it returns.
2. Call \`recoder_wait\` with that \`runId\` until \`state\` is no longer \`running\`. A review takes 5 to 40 minutes.
3. Call \`recoder_result\` to read the findings.

A review runs in its own process, so it goes on if the MCP server stops. \`recoder_runs\` finds it again.

Files go by path: \`diff\`, \`body-file\` and \`instructions-file\` must each name a regular file, since standard input carries the protocol. A tool that fails returns an error with one line saying why.`
};
