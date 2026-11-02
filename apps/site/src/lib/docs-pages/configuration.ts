import type { DocPage } from '~/lib/docs';

export const configuration: DocPage = {
	slug: 'configuration',
	title: 'Environment',
	body: `The server reads the variables below. All are optional. Most settings live in the app instead, and a value saved in Settings wins over its variable, except \`GH_TOKEN\`, \`GITLAB_TOKEN\` and \`GITLAB_HOST\`, which win over Settings.

With Bun, set them in the shell that runs \`bun run dev\`. With Docker, only the variables listed in \`docker-compose.yml\` reach the server; add others under the \`server\` service’s \`environment\`.

## Server

| Variable | Default | What it does |
| --- | --- | --- |
| \`PORT\` | \`3001\` | Port the server listens on. |
| \`HOST\` | \`0.0.0.0\` | Address it listens on. Set \`127.0.0.1\` to accept only local connections. |
| \`FRONTEND_URL\` | \`http://localhost:3000\` | The app’s address. Routes that sign in or change tokens accept it, and, unless \`NODE_ENV=production\`, any \`http://localhost\` address. |
| \`NODE_ENV\` | none | \`production\` stops the server from trusting every \`localhost\` address. The Docker image sets it. |
| \`RECODER_DATA_DIR\` | \`~/.recoder/data\` | Where reviews, settings, tokens and guidelines are kept. Docker uses \`/app/data\` in a volume. |
| \`RECODER_WORKDIR\` | \`/tmp/recoder-work\` | Where repositories are checked out. |

The app reads one variable when it is built: \`NEXT_PUBLIC_API_URL\`, the server’s address as your browser reaches it (default \`http://localhost:3001\`). Docker passes \`PUBLIC_API_URL\` from \`.env\` into it, so rebuild the app image after changing it.

## GitHub and GitLab

| Variable | What it does |
| --- | --- |
| \`GH_TOKEN\` | GitHub token. Wins over a token saved in Settings. |
| \`GITHUB_TOKEN\` | GitHub token for REST calls (comments, file reads, auto-review polling) when neither a saved token nor \`GH_TOKEN\` is there. |
| \`GITLAB_TOKEN\` | GitLab token. Wins over a token saved in Settings. |
| \`GITLAB_HOST\` | Self-managed GitLab host, like \`gitlab.acme.com\`. Wins over the URL saved in Settings. Unset, the host is gitlab.com. |
| \`GITHUB_WEBHOOK_SECRET\` | Secret for the GitHub webhook’s signature. Unset, signatures aren’t checked. |
| \`GITLAB_WEBHOOK_SECRET\` | Secret the GitLab webhook sends in \`X-Gitlab-Token\`. Unset, the token isn’t checked. |

## Models

| Variable | Default | What it does |
| --- | --- | --- |
| \`RECODER_REVIEW_BASE_URL\` | none | OpenAI-compatible endpoint, used while no model is picked in Settings. |
| \`RECODER_REVIEW_API_KEY\` | none | Key for that endpoint. |
| \`RECODER_REVIEW_MODEL\` | none | Model id on that endpoint. |
| \`RECODER_OPENCODE_BIN\` | found on \`PATH\` | OpenCode binary. Empty turns OpenCode off. |
| \`RECODER_CLAUDE_BIN\` | found on \`PATH\` | Claude Code binary. Empty turns it off. |
| \`RECODER_DEVIN_BIN\` | found on \`PATH\` | Devin binary. Empty turns it off. |
| \`RECODER_LLM_CONCURRENCY\` | \`64\` | Most model calls in flight per endpoint. |
| \`RECODER_CLAUDE_CODE_CONCURRENCY\` | \`8\` | Most Claude Code processes at once. |
| \`RECODER_DEVIN_CONCURRENCY\` | \`4\` | Most Devin processes at once. |
| \`RECODER_LLM_RETRIES\` | \`5\` | Retries for a call that failed for a passing reason. |
| \`RECODER_LLM_IDLE_MS\` | \`45000\` | A streaming reply silent this long is dropped as stalled (OpenAI-compatible endpoints only). |

\`.env.example\` also lists \`RECODER_SECURITY_MODEL\`, \`RECODER_PERF_MODEL\`, \`RECODER_CORRECTNESS_MODEL\` and \`RECODER_DOCS_MODEL\`. The server doesn’t read them.

## Reviews

| Variable | Default | What it does |
| --- | --- | --- |
| \`RECODER_REVIEW_MAX_FILE_CHARS\` | \`12000\` | Most characters one file read returns. Settings → Review harness wins. |
| \`RECODER_REVIEW_EXCLUDE\` | none | Comma-separated text. Changed files whose path contains any of it, in any case, are left out of the review. |
| \`RECODER_EXEC\` | on | \`off\` stops reviews from running code. |
| \`RECODER_REVIEW_MAX_FILES\`, \`RECODER_REVIEW_MAX_DIFF_CHARS\` | \`20\`, \`60000\` | Shown in Settings, but no review stage reads them yet. |

## Sandbox

| Variable | Default | What it does |
| --- | --- | --- |
| \`RECODER_SANDBOX_CPUS\` | all CPUs but a quarter (at least 2 kept free) | CPUs sandboxed commands are pinned to (Linux, with \`taskset\`). |
| \`RECODER_SANDBOX_RUNS\` | half the sandbox CPUs, at least 2 | Reviewer and verifier commands at once, across all reviews. |
| \`RECODER_SANDBOX_PREP\` | a quarter of the sandbox CPUs, at least 1 | Installs and baseline checks at once, across all reviews. |
| \`RECODER_SANDBOX_MIN_FREE_MB\` | \`1536\` | A command waits until this much memory is free, for up to a minute (Linux). |

## Commands

| Variable | Default | What it does |
| --- | --- | --- |
| \`RECODER_ALLOWED_COMMANDS\` | \`echo,git,gh,glab,bun\` | Programs the server may start for Git work. They run without a shell. The Docker and \`.env.example\` defaults leave out \`glab\`. |
| \`RECODER_COMMAND_TIMEOUT_MS\` | \`120000\` | Time limit for each of those commands. |

Experiment flags and tuning knobs for the review pipeline are listed in [docs/review/configuration.md](https://github.com/aidan-neel/recoder/blob/main/docs/review/configuration.md) in the repository.`
};
