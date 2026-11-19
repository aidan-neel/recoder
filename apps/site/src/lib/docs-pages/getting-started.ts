import type { DocPage } from '~/lib/docs';

export const gettingStarted: DocPage = {
	slug: 'getting-started',
	title: 'Getting started',
	body: `Recoder reviews GitHub pull requests and GitLab merge requests on a machine you run, with the models you choose. It checks out each change, runs reviewers over it, tries to prove every finding by running code in a sandbox, and shows you only what needs your decision.

## What runs where

- **The server** (\`apps/server\`, port 3001) clones repositories, runs reviews, talks to GitHub, GitLab and your model, and keeps everything in its data directory, \`~/.recoder/data\` unless you set \`RECODER_DATA_DIR\`.
- **The app** (\`apps/app\`) is the web page you review in. It talks to the server from your browser.
- **Your model provider** sees the code under review, because the reviewers send it in their prompts.

Recoder is single-user. The first time you connect GitHub or GitLab, the server makes one account from it, and from then on the API needs that sign-in. Until then anyone who can reach its port can start reviews with your tokens and models, so keep it on your own machine or behind your network’s access control until you have signed in. From any other machine, the app asks for a setup code first: find it in the server log (the line that starts with \`setup code:\`) or in the \`setup-code\` file in the data directory. The server listens on every interface (\`HOST=0.0.0.0\`) unless you set \`HOST=127.0.0.1\`.

## Requirements

- [Bun](https://bun.sh). The repository pins Bun 1.3.11.
- \`git\`.
- For GitHub, the [GitHub CLI](https://cli.github.com) (\`gh\`). Recoder lists, reads and clones pull requests through it, even when you connect a token.
- For GitLab, nothing extra. Recoder uses the GitLab REST API with your token. The \`glab\` CLI is optional.
- A model. Either an agent CLI on the server machine (OpenCode, Claude Code or Devin), or an OpenAI-compatible endpoint set in the environment.
- To let reviews run code: Linux with [bubblewrap](https://github.com/containers/bubblewrap) (\`bwrap\`), or macOS, which has its own sandbox. On Windows, run the server under WSL. The repository’s own tools must be on the server’s \`PATH\` too: \`bun\`, \`pnpm\`, \`yarn\` or \`npm\` for JavaScript, \`uv\`, \`poetry\` or \`python3\` for Python, \`go\` and \`cargo\`. Without a sandbox, reviews still run, but only read the code.

## Run with Bun

This is the setup that supports everything.

\`\`\`bash
git clone https://github.com/aidan-neel/recoder
cd recoder
bun install
bun run dev
\`\`\`

\`bun run dev\` starts the server on port 3001 and the app on [localhost:5180](http://localhost:5180). The sample review at [localhost:5180/sample](http://localhost:5180/sample) works without the server.

## Run with Docker

\`\`\`bash
git clone https://github.com/aidan-neel/recoder
cd recoder
cp .env.example .env
docker compose up --build --remove-orphans
\`\`\`

The app and API share [localhost:3001](http://localhost:3001). Settings, tokens and reviews stay in the \`recoder-data\` volume, mounted at \`/app/data\`. If you used the old two-container Compose setup, this command removes the old app container without removing its volumes.

Know the image’s limits before you choose it:

- **No agent CLIs and no bubblewrap.** The server image has \`git\`, \`gh\` and \`glab\`, nothing else. You can’t add a provider through OpenCode in Settings, so point Recoder at a model with the \`RECODER_REVIEW_*\` variables. Reviews only read code: findings can’t be reproduced by running it.
- **Only listed variables reach the server.** To use a variable not listed in \`docker-compose.yml\`, such as \`RECODER_REVIEW_MODEL\` or \`GH_TOKEN\`, add it under the \`server\` service’s \`environment\`.
- **Set the public origin at runtime.** Set \`PORT\` to change the host port. If you put Recoder behind a reverse proxy, set \`RECODER_PUBLIC_URL\` to the public HTTPS origin so sign-in and OAuth callbacks use it. Neither change requires rebuilding the image.
- **\`glab\` is blocked by default.** The compose default for \`RECODER_ALLOWED_COMMANDS\` leaves it out. That is fine once a GitLab token is connected, since Recoder then uses the REST API.

## First review

Until reviews can run, the app shows three steps in place of the pull request list:

1. **Connect a model provider.** Add one through OpenCode, or sign in to Claude Code or Devin.
2. **Pick a model.** The Review model runs the reviewers.
3. **Track a repository.** Connect GitHub or GitLab to browse yours, or add one by URL.

Then the pull request list shows the open pull requests of every repository you track. Select one with \`j\` and \`k\` and press \`r\`, or press its Review button. To review a pull request from somewhere else, press \`c\` for a new review and paste its link.

To look around first, choose **Look at a sample** on the first-run screen.

## Review from a terminal or an agent

The [CLI](/docs/cli) runs the same review without the server or the app, and [MCP](/docs/mcp) serves it as tools for a coding agent.`
};
