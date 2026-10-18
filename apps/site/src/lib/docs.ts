export interface DocPage {
	slug: string;
	title: string;
	body: string;
}

/** Docs pages in nav order. Bodies are GFM Markdown rendered by the kit's Markdown. */
export const docs: DocPage[] = [
	{
		slug: 'getting-started',
		title: 'Getting started',
		body: `Recoder reviews pull requests on your own machine. It runs each change in a sandbox to prove what it reports, then shows you what needs your decision.

## Run with Docker

\`\`\`bash
git clone https://github.com/aidan-neel/recoder
cd recoder
cp .env.example .env
docker compose up --build
\`\`\`

The app opens on [localhost:3000](http://localhost:3000) and the server listens on port 3001.

## Run with Bun

\`\`\`bash
bun install
bun run dev
\`\`\`

\`bun run dev\` starts the server and the app. The app opens on [localhost:5180](http://localhost:5180) and the server listens on port 3001.

## First review

Until reviews can run, the app shows three steps:

1. Connect a model provider.
2. Pick a review model.
3. Track a repository. Connect GitHub or GitLab to list yours, or add one by URL.

Then the queue lists the open pull requests of the repositories you track, grouped by what they need: Needs you, Reviewing, Not reviewed, With the agent and Ready to merge. Select a pull request with \`j\` and \`k\`, then press \`r\` to start a review. To review one the queue doesn’t list, paste its link into the search (\`⌘K\` or \`Ctrl K\`).

To look around first, open the sample review from the search.`
	},
	{
		slug: 'configuration',
		title: 'Configuration',
		body: `Most settings live in the app. The server reads the rest from environment variables. With Docker, copy \`.env.example\` to \`.env\` and fill in what you need. Settings saved in the app take priority over the variables, except \`GH_TOKEN\`, \`GITLAB_TOKEN\` and \`GITLAB_HOST\`, which win over what is saved in Settings.

## Settings

| Section | What it holds |
| --- | --- |
| Agent | The agent CLIs, the model providers and the two models. |
| Connections | GitHub and GitLab tokens, and the repositories you track. |
| Review harness | Subagents, low severity findings and review limits. |
| Guidelines | Your global review guidelines. |
| Appearance | The theme. |

## Server

| Variable | Default | What it does |
| --- | --- | --- |
| \`PORT\` | \`3001\` | Port the server listens on. |
| \`NEXT_PUBLIC_API_URL\` | \`http://localhost:3001\` | Server address the app uses. It is read when the app is built, so Docker builds it into the app image. |
| \`FRONTEND_URL\` | \`http://localhost:3000\` | Public address of the app. With Docker, the server takes sign-ins only from this address. |
| \`RECODER_DATA_DIR\` | \`~/.recoder/data\` | Where settings, tokens and guidelines are saved. Docker uses a volume at \`/app/data\`. |
| \`RECODER_WORKDIR\` | \`/tmp/recoder-work\` | Where pull requests are checked out. |

## Reviews

| Variable | Default | What it does |
| --- | --- | --- |
| \`RECODER_REVIEW_MAX_FILE_CHARS\` | \`12000\` | Most characters returned by one file read. |
| \`RECODER_REVIEW_EXCLUDE\` | none | Comma-separated text. Files whose path contains any of it are left out of the review. |
| \`RECODER_LLM_CONCURRENCY\` | \`64\` | Most model requests running at once on one endpoint. |
| \`RECODER_CLAUDE_CODE_CONCURRENCY\` | \`8\` | Most Claude Code processes running at once. |
| \`RECODER_DEVIN_CONCURRENCY\` | \`4\` | Most Devin processes running at once. |
| \`RECODER_LLM_RETRIES\` | \`5\` | Retries for a failed model request. |

## Commands

| Variable | Default | What it does |
| --- | --- | --- |
| \`RECODER_ALLOWED_COMMANDS\` | \`echo,git,gh,glab,bun\` | Programs the server may run. They run without a shell. The Docker default leaves out \`glab\`. |
| \`RECODER_COMMAND_TIMEOUT_MS\` | \`120000\` | Time limit for each command. |`
	},
	{
		slug: 'models',
		title: 'Models',
		body: `Recoder runs its reviewers through an agent CLI on your machine: OpenCode, Claude Code or Devin.

## Agent CLIs

Settings → Agent lists each CLI and whether it is ready. A missing CLI shows the command that installs it, and a signed-out one shows the command that signs it in.

## Providers

OpenCode reaches model providers such as OpenRouter or OpenAI. Connect one under Providers in Settings → Agent, with an API key or a sign-in. OpenCode saves it on this machine. Claude Code and Devin offer their own models once you sign in to them.

## Models

Pick two models in Settings → Agent. The Review model runs the reviewers, writes the summary and answers in chat. The second, Subagents and verifiers, answers the questions reviewers hand off and checks each finding. Set it to Same as Review to use one model for both.

## Variables

\`\`\`bash
RECODER_REVIEW_BASE_URL=https://openrouter.ai/api/v1
RECODER_REVIEW_API_KEY=sk-or-...
RECODER_REVIEW_MODEL=qwen/qwen-2.5-coder-32b-instruct
\`\`\`

The variables point at any OpenAI-compatible endpoint, such as OpenRouter, vLLM or DashScope. The API key can be left empty for local servers that don’t need one. They are only used when no model is set in Settings, and every part of the review uses this one model.

## Reasoning effort

The effort select beside each model lists the levels that model supports.`
	},
	{
		slug: 'git-hosts',
		title: 'Git hosts',
		body: `Recoder reads pull requests from GitHub and merge requests from GitLab, including self-managed GitLab.

## GitHub

Connect a token in Settings → Connections, or set \`GH_TOKEN\`, which wins over a connected token. \`GITHUB_TOKEN\` is used when neither is there. The token needs the \`repo\` scope. Public repositories work without one. Private clones authenticate through the \`gh\` CLI, so tokens never go into clone URLs.

To review new pull requests automatically, add a webhook:

- URL: \`https://<your-server>/api/webhooks/github\`
- Content type: \`application/json\`
- Events: pull requests
- Secret: the value of \`GITHUB_WEBHOOK_SECRET\`

A review is queued when a pull request is opened, reopened or gets new commits, but only for repositories you already track. If \`GITHUB_WEBHOOK_SECRET\` is empty, requests are not signature-checked.

## GitLab

Connect a token in Settings → Connections, or set \`GITLAB_TOKEN\`, which wins over a connected token. The token needs \`read_api\` and \`read_repository\`. For a self-managed instance, enter its URL when you connect, or set \`GITLAB_HOST\` to its hostname, like \`gitlab.acme.com\`. \`GITLAB_HOST\` wins over the URL you enter.

Tokens connected in Settings are saved in the data directory with \`0600\` permissions.`
	},
	{
		slug: 'guidelines',
		title: 'Guidelines',
		body: `Guidelines tell Recoder what your team cares about. They are plain Markdown.

## Two layers

- **Global** guidelines apply to every repository. Edit them in Settings → Guidelines.
- **Repository** guidelines live in \`.recoder/REVIEW.md\`.

Recoder reads the repository file from the pull request’s base commit, so a pull request can’t change the rules it’s reviewed by.

## Template

\`\`\`markdown
## Focus
- Missing auth checks on new routes

## Ignore
- Generated files under src/gen

## Severity
- Treat unhandled promise rejections as high

## Conventions
- Errors are returned, not thrown, in the service layer
\`\`\``
	},
	{
		slug: 'how-reviews-work',
		title: 'How reviews work',
		body: `A review runs in a few steps. You can watch each one live, and pause or cancel it.

## Checkout

Recoder clones the repository into its work directory and checks out the pull request’s head commit.

## Understand

Recoder reads the repository’s instructions, such as \`AGENTS.md\` and \`CONTRIBUTING.md\`, and your guidelines. It also reads the recent history of the changed code to work out what the change is for.

## Run checks

Recoder installs the dependencies, then runs the type check, lint and tests from the \`package.json\` scripts of each JavaScript package the change touches. Verifiers see the results.

## Review

The change is cut into review units: groups of related files, packed by folder up to a size limit. The same diff always gives the same units. Each unit gets eight reviewers, one for each kind of problem: correctness, security, concurrency, API contracts, performance, repository rules, conventions and readability. A unit that only changes docs gets the rules and readability reviewers.

The correctness reviewer can hand a deep question to a subagent. Subagents run after the reviewers finish, up to a limit per review that you set in Settings → Review harness: Off, Up to 2 or Up to 4. The default is 2. Requests past the limit are merged or dropped.

Static checks run beside the reviewers. They look for dead code, complex functions, duplicated code, weakened tests and breaks of your repository’s rules.

If a reviewer fails, its unit runs once more. Findings that point outside the change, cite evidence that was never gathered, or match one you marked Not an issue are dropped as reviewers report them.

## Verify

Each finding goes to a fresh agent as soon as it is reported. The agent tries to reproduce it by running code. A finding a run disproves is dropped. A proven finding is marked Reproduced, with the command that proved it, or Traced in code. A finding from a static check or one of your rules is marked Checked. Findings no one could prove are hidden, except where code can’t run (see Sandbox): those show as Not proven.

## Consolidate

Findings at the same place in the code are merged into one.

## Sandbox

Commands run in [bubblewrap](https://github.com/containers/bubblewrap) on Linux and in the built-in \`sandbox-exec\` sandbox on macOS. Only the checkout is writable, your home and Recoder’s data directory are hidden, and there is no network. The dependency install is the one step with network access, and it runs with install scripts off. Edits to tracked files are undone after every command. On native Windows or without a sandbox, reviews only read the code. Bugs that can’t be reproduced there, or in a repository where none of the checks pass, are shown as Not proven. Run the server under WSL to run code on Windows. Set \`RECODER_EXEC=off\` to turn running code off.

## After the review

The overview says how many changed lines need your eyes, and about how long they take. The rail beside it lists:

- **Needs you**: findings, and questions no reviewer could settle.
- **Checked for you**: what reviewers looked into and found sound, with the command they ran.
- **Files**: the change map. Every changed line is marked Read, Checked, Tests or Skim.

Decide each item in Needs you:

- **Accept** (\`a\`): a real point that ships as is.
- **Send back** (\`s\`): it goes to the coding agent.
- **Not an issue** (\`x\`, findings only): Recoder won’t raise it again.

Deciding moves you to the next open item, and \`u\` undoes. A new push starts the decisions over.

Press \`h\` to hand off what you sent back. Recoder writes one prompt with each item’s location, repro command and your notes. Paste it into the agent that opened the pull request.

Press \`q\` to ask about what you’re reading. On a finding you talk to the reviewer that raised it, and on the overview you talk to Orchestrator about the whole review.`
	}
];

export function docBySlug(slug: string): DocPage | undefined {
	return docs.find((doc) => doc.slug === slug);
}

/** A page's first paragraph as plain text, for its meta description: links keep their text, code and bold marks go. */
export function docSummary(doc: DocPage): string {
	const [first = ''] = doc.body.split('\n');

	return first
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/\*\*([^*]+)\*\*/g, '$1');
}
