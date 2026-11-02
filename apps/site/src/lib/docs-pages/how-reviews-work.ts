import type { DocPage } from '~/lib/docs';

export const howReviewsWork: DocPage = {
	slug: 'how-reviews-work',
	title: 'How reviews work',
	body: `A review checks out the pull request, works out what it is for, runs reviewers over it, tries to prove each finding, and merges what survives.

## Checkout

Recoder clones the repository into its work directory and checks out the pull request’s head commit.

## Understand

Recoder reads the repository’s instructions (\`AGENTS.md\`, \`CLAUDE.md\` and \`CONTRIBUTING.md\` at the root, in \`.github/\` or in \`docs/\`) and your [guidelines](/docs/guidelines). It reads the pull request’s description and the recent history of the code it changes, to work out what the change is for. Instructions you gave (a comment that mentions Recoder, or what you told Orchestrator before starting) guide the review too.

## Install and run checks

Recoder installs dependencies in the sandbox from the repository’s lockfiles, with install scripts turned off: \`bun\`, \`pnpm\`, \`yarn\` or \`npm\` for JavaScript, \`uv\`, \`poetry\` or \`pip\` for Python, \`go mod download\` and \`cargo fetch\`. A tool missing from the server’s \`PATH\` is reported and skipped.

For JavaScript, it then runs the type check (\`typecheck\` or \`check\`), \`lint\` and \`test\` scripts of the packages the change touches, on the pull request’s head. Verifiers see the results.

## Review

The change is cut into review units: related files, packed by folder up to a size limit. The same diff always gives the same units. Each unit gets one reviewer per kind of problem: correctness, security, concurrency, API contracts, performance, repository rules, conventions and readability. A unit that only changes docs gets the rules and readability reviewers.

The correctness reviewer can hand a deep question to a subagent. Subagents run after the reviewers, up to the limit in Settings → Review harness: **Off**, **Up to 2** (the default), **Up to 4** or **Uncapped**. Past the limit, requests are merged or dropped. **Uncapped** runs as many as the review’s remaining model calls and time can pay for.

Static checks run beside the reviewers. They look for dead code, complex functions, duplicated code, weakened tests and breaks of your repository’s rules.

A reviewer that fails is run once more. Findings that point outside the change, cite evidence that was never gathered, or match one you marked **Not an issue** are dropped.

## Verify

Each finding goes to a fresh agent as soon as it is reported, which tries to reproduce it by running code.

- A finding a run disproves is dropped.
- A proven finding is marked **Reproduced**, with the command that proved it, or **Traced in code**.
- A finding from a static check or one of your rules is marked **Checked**.
- Findings no one could prove are hidden, except where code can’t run (no sandbox, no checks to run, or none of them pass). There, bugs are shown as **Not proven** instead.

Recoder also runs the proving command on the base branch, to tell a bug the change introduced from one that was already there.

## Consolidate

Findings at the same place in the code are merged into one. Low-severity findings are shown unless you turn **Low severity findings** off in Settings → Review harness.

## Limits

A review gets a budget of model calls and time that grows with its size: 320 calls plus 8 per reviewer, up to 2,000, and 30 minutes plus 30 seconds per reviewer, up to 2 hours. Install time is added back, up to 14 minutes. A review that runs out of time still finishes: it shows what was verified by then and says time ran out.

A newer automatic review of the same pull request cancels an older one that is still running.

## Sandbox

Commands run in [bubblewrap](https://github.com/containers/bubblewrap) on Linux and in the built-in \`sandbox-exec\` on macOS.

- Only the checkout is writable. Your home directory and Recoder’s data directory are hidden.
- There is no network, except for the dependency install, which runs with install scripts off.
- Edits to tracked files are undone after every command.

On native Windows, in the Docker image, or anywhere without a sandbox, reviews only read the code. Run the server under WSL to run code on Windows. Set \`RECODER_EXEC=off\` to turn running code off everywhere.

## What stays on your machine

Checkouts live in the work directory (\`RECODER_WORKDIR\`, default \`/tmp/recoder-work\`). Reviews, settings, tokens and guidelines live in the data directory (\`RECODER_DATA_DIR\`, default \`~/.recoder/data\`). The code reviewers read is sent to your model provider.`
};
