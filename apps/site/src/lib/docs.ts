import BookOpen from '@lucide/svelte/icons/book-open';
import Cpu from '@lucide/svelte/icons/cpu';
import GitBranch from '@lucide/svelte/icons/git-branch';
import Rocket from '@lucide/svelte/icons/rocket';
import ScanSearch from '@lucide/svelte/icons/scan-search';
import Settings2 from '@lucide/svelte/icons/settings-2';
import type { Component } from 'svelte';

export interface DocPage {
	slug: string;
	title: string;
	icon: Component<{ size?: number | string; strokeWidth?: number | string }>;
	body: string;
}

/** Docs pages in nav order. Bodies are GFM Markdown rendered by Sivir's Markdown. */
export const docs: DocPage[] = [
	{
		slug: 'getting-started',
		title: 'Getting started',
		icon: Rocket,
		body: `Recoder reviews pull requests on your own machine. It checks out each change, reads the code around it and shows findings you can discuss, fix or dismiss.

## Run with Docker

\`\`\`bash
git clone https://github.com/aidan-neel/recoder
cd recoder
cp .env.example .env
docker compose up --build
\`\`\`

The web app opens on [localhost:3000](http://localhost:3000) and the server listens on port 3001.

## Run with Bun

\`\`\`bash
bun install
bun run dev
\`\`\`

The web app opens on [localhost:5173](http://localhost:5173) and the server listens on port 3001.

## First review

1. Add a model in Settings, or set the \`RECODER_REVIEW_*\` variables.
2. Connect GitHub or GitLab in Settings so Recoder can read your pull requests.
3. On Home, pick an open pull request or paste its URL. Press \`R\` to start a new review.`
	},
	{
		slug: 'configuration',
		title: 'Configuration',
		icon: Settings2,
		body: `Recoder reads its settings from environment variables. With Docker, copy \`.env.example\` to \`.env\` and fill in what you need. Model settings saved in the app take priority over the variables.

## Server

| Variable | Default | What it does |
| --- | --- | --- |
| \`PORT\` | \`3001\` | Port the server listens on. |
| \`PUBLIC_API_URL\` | \`http://localhost:3001\` | Server address the browser uses. Docker builds it into the web image. |
| \`FRONTEND_URL\` | \`http://localhost:3000\` | Public address of the web app. Docker passes it to the web container as \`ORIGIN\`. |
| \`RECODER_DATA_DIR\` | \`~/.recoder/data\` | Where settings, tokens and guidelines are saved. Docker uses a volume at \`/app/data\`. |
| \`RECODER_WORKDIR\` | \`/tmp/recoder-work\` | Where pull requests are checked out. |

## Reviews

| Variable | Default | What it does |
| --- | --- | --- |
| \`RECODER_REVIEW_MAX_FILE_CHARS\` | \`12000\` | Most characters returned by one file read. |
| \`RECODER_REVIEW_EXCLUDE\` | none | Comma-separated text. Files whose path contains any of it are left out of the review. |
| \`RECODER_LLM_CONCURRENCY\` | \`8\` | Most model requests running at once. |
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
		icon: Cpu,
		body: `Recoder works with any OpenAI-compatible endpoint, such as OpenRouter, vLLM or DashScope. You can also sign in with ChatGPT in Settings and use your ChatGPT plan.

## Settings

Add models in Settings. Pick one for the orchestrator, which plans the review, and optionally a different one for each specialist. Models added here take priority over the variables below.

## Variables

\`\`\`bash
RECODER_REVIEW_BASE_URL=https://openrouter.ai/api/v1
RECODER_REVIEW_API_KEY=sk-or-...
RECODER_REVIEW_MODEL=qwen/qwen-2.5-coder-32b-instruct
\`\`\`

The API key can be left empty for local servers that don't need one.

## Per-role models

Each review is split across specialists. They all use \`RECODER_REVIEW_MODEL\` unless you set a role's variable. These are only used when no models are added in Settings.

| Variable | Role |
| --- | --- |
| \`RECODER_SECURITY_MODEL\` | Security |
| \`RECODER_PERF_MODEL\` | Performance |
| \`RECODER_CORRECTNESS_MODEL\` | Correctness |
| \`RECODER_DOCS_MODEL\` | Docs |
| \`RECODER_DEDUP_MODEL\` | Duplication |
| \`RECODER_PATTERNS_MODEL\` | Repository consistency |
| \`RECODER_TESTING_MODEL\` | Testing |
| \`RECODER_ERRORS_MODEL\` | Errors |
| \`RECODER_CONCURRENCY_MODEL\` | Concurrency |
| \`RECODER_API_MODEL\` | API design |

## Reasoning effort

The model picker lists the effort levels the chosen model supports.`
	},
	{
		slug: 'git-hosts',
		title: 'Git hosts',
		icon: GitBranch,
		body: `Recoder reads pull requests from GitHub and merge requests from GitLab, including self-managed GitLab.

## GitHub

Connect a token in Settings, or set \`GH_TOKEN\` or \`GITHUB_TOKEN\`. The token needs the \`repo\` scope. Public repositories work without one. Private clones authenticate through the \`gh\` CLI, so tokens never go into clone URLs.

To review new pull requests automatically, add a webhook:

- URL: \`https://<your-server>/api/webhooks/github\`
- Content type: \`application/json\`
- Events: pull requests
- Secret: the value of \`GITHUB_WEBHOOK_SECRET\`

A review is queued when a pull request is opened, reopened or gets new commits, but only for repositories you already track. If \`GITHUB_WEBHOOK_SECRET\` is empty, requests are not signature-checked.

## GitLab

Connect a token in Settings, or set \`GITLAB_TOKEN\`. The token needs \`read_api\` and \`read_repository\`. For a self-managed instance, enter its URL in Settings or set \`GITLAB_HOST\` to its hostname, like \`gitlab.acme.com\`.

Tokens connected in Settings are saved in the data directory with \`0600\` permissions.`
	},
	{
		slug: 'guidelines',
		title: 'Guidelines',
		icon: BookOpen,
		body: `Guidelines tell Recoder what your team cares about. They are plain Markdown.

## Two layers

- **Global** guidelines apply to every repository. Edit them in Settings.
- **Repository** guidelines live in \`.recoder/REVIEW.md\`.

Recoder reads the repository file from the pull request's base commit, so a pull request can't change the rules it's reviewed by.

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
		icon: ScanSearch,
		body: `A review runs in a few steps. You can watch each one live, and pause or cancel it.

## Checkout

Recoder clones the repository into its work directory and checks out the pull request's head commit.

## Plan

An orchestrator reads the change and assigns parts of it to specialists. There are ten: security, performance, correctness, docs, duplication, repository consistency, testing, errors, concurrency and API design.

## Run checks

Recoder installs the dependencies, then runs the type checks, lint and tests the orchestrator picked for the changed packages. Every specialist sees the results.

## Investigate

Each specialist reads the diff and the checkout, runs commands, and writes small repro tests to prove what it reports.

## Verify

Every finding goes to a fresh agent that tries to reproduce it by running code. A finding a run disproves is dropped. The rest are marked Verified, with the command that proved it, or Unverified, with the reason.

## Consolidate

Findings that point outside the change, or cite evidence that was never gathered, are dropped. Duplicates are merged.

## Sandbox

Commands run in [bubblewrap](https://github.com/containers/bubblewrap) on Linux. Only the checkout is writable, your home and Recoder's data directory are hidden, and there is no network. The dependency install is the one step with network access, and it runs with install scripts off. Edits to tracked files are undone after every command. Without bubblewrap, reviews only read the code, and every finding is marked Unverified. Set \`RECODER_EXEC=off\` to turn running code off.

## After the review

- Discuss a finding. The reviewer sees the finding and the code around it.
- Apply a suggested fix. Recoder commits it and pushes it to the pull request's branch.
- Leave notes on lines of the diff and re-review. Recoder answers each note and can add new findings.
- Dismiss findings you don't need.`
	}
];

export function docBySlug(slug: string): DocPage | undefined {
	return docs.find((doc) => doc.slug === slug);
}
