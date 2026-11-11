import type { DocPage } from '~/lib/docs';

export const models: DocPage = {
	slug: 'models',
	title: 'Models and agents',
	body: `Recoder calls models through an agent CLI installed on the server machine (OpenCode, Claude Code or Devin), through a vLLM server you connect, or through an OpenAI-compatible endpoint you set in the environment.

## Agent CLIs

Settings → Agent → Agent CLIs shows each CLI as **Ready**, **Not installed**, **Can’t run** or **Not signed in**, with the command that fixes it. Run the command in a terminal on the server machine, then press **Check again**.

| CLI | Sign in | Pin its path |
| --- | --- | --- |
| OpenCode | through Providers, below | \`RECODER_OPENCODE_BIN\` |
| Claude Code | \`claude auth login\` | \`RECODER_CLAUDE_BIN\` |
| Devin | \`devin auth login\` | \`RECODER_DEVIN_BIN\` |

Install them with their own installers:

\`\`\`bash
curl -fsSL https://opencode.ai/install | bash      # OpenCode
curl -fsSL https://claude.ai/install.sh | bash     # Claude Code
curl -fsSL https://cli.devin.ai/install.sh | bash  # Devin
\`\`\`

Recoder looks for each CLI on \`PATH\`, then where its installer puts it (\`~/.opencode/bin/opencode\`, \`~/.local/bin/claude\`, \`~/.local/bin/devin\`). Set the pin variable to use another binary, or set it empty to turn that CLI off.

## Providers

OpenCode reaches most model providers. In Settings → Agent → Providers, press **Add provider** and pick one: OpenCode Zen, OpenCode Go, Anthropic, OpenAI, GitHub Copilot, OpenRouter, Google, xAI and DeepSeek are listed first, and **All providers** shows the rest. Connect with an API key or, where the provider offers it, a browser sign-in. OpenCode saves the key on the server machine, not Recoder.

Claude Code and Devin bring their own models once you sign in to them. They don’t appear under Providers.

## vLLM servers

If your company serves models with vLLM, connect the server and Recoder reads the model list from it. You never type a model in by hand.

In Settings → Agent → vLLM servers, press **Add server**, enter the server address and, only if the server was started with \`--api-key\`, the key. Recoder adds \`/v1\` if you leave it off, lists the server’s models to check the address, and saves it. If no Review model is picked yet, it picks the first one.

The models come from the server’s own \`GET /v1/models\`. Each model is named by the id the server serves it under, and its context window is the server’s \`max_model_len\`. They appear in both pickers under the server’s address. Reviews call the server directly, over its OpenAI-compatible API, naming that id. No agent CLI is needed.

Recoder checks the list again:

- when you connect the server, and when Recoder starts,
- when you open Settings,
- every 5 minutes while Recoder runs,
- when you press **Refresh**.

New models show up on their own. A model the server stops serving is dropped, unless a review is set to it. That one stays in the list as **Not served**, its picker shows it as missing, and reviews set to it stop with a message telling you to pick another model. Recoder never quietly runs a review on a different model. If the server can’t be reached, Recoder keeps the last list it got and shows why under the server’s name.

Use **Disconnect** to forget a server and its key. You can connect more than one. Connecting the same address again keeps the models you picked.

Recoder keeps the address and key in \`vllm-servers.json\` in its data folder, readable only by you. The key never leaves the server in full; the page only sees its last four characters.

If reviews fail on tool calls, start vLLM with tool calling turned on (\`--enable-auto-tool-choice\` and a \`--tool-call-parser\` for your model).

## Pick models

Settings → Agent → Models has two pickers:

- **Review model** runs the reviewers, writes the summary and answers as Orchestrator in chat.
- **Subagent model** answers the questions reviewers hand off and checks each finding. Leave it on **Same as Review model** to use one model for both.

The effort select beside a model appears when the model has reasoning levels, and lists only the ones it supports: Minimal, Low, Medium, High, Extra high or Max.

A review reads both picks once, when it starts. Changing them affects reviews started after.

## Environment fallback

\`\`\`bash
RECODER_REVIEW_BASE_URL=https://openrouter.ai/api/v1
RECODER_REVIEW_API_KEY=sk-or-...
RECODER_REVIEW_MODEL=qwen/qwen-2.5-coder-32b-instruct
\`\`\`

These point at any endpoint that serves \`POST <base URL>/chat/completions\`, such as OpenRouter, vLLM or DashScope. For vLLM, prefer connecting the server in Settings, which keeps the model list current. Leave the key empty for a local server that needs none. They apply only while no model is picked in Settings, and then every part of the review uses that one model. This is the way to give the Docker image a model.

## Limits

- \`RECODER_LLM_CONCURRENCY\` (default 64) caps model calls in flight per endpoint, across all reviews.
- \`RECODER_CLAUDE_CODE_CONCURRENCY\` (default 8) and \`RECODER_DEVIN_CONCURRENCY\` (default 4) cap the CLI processes running at once. Each call starts one.
- \`RECODER_LLM_RETRIES\` (default 5) retries a call that failed for a passing reason, while time is left.

## What the CLIs can do

Recoder uses the CLIs to reach models, not to act on your machine. Claude Code starts with its own tools, slash commands, MCP servers and your customizations turned off, and without Recoder’s, Anthropic’s or OpenAI’s environment variables or any variable that holds a token, key, secret or password. Devin starts with every one of its tools denied. Reviewers work through Recoder’s own tools, which read the checkout and run commands in the sandbox.`
};
