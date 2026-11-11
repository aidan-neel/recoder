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

A review has a few reviewers, not one per kind of problem. The change is cut into one slice per reviewer, in folder order, and the same diff always gives the same slices. Every changed hunk belongs to exactly one slice, so every changed line has one reviewer. Each reviewer applies every kind of check to its slice: correctness, security, concurrency, API contracts, performance, repository rules, conventions and readability. A slice that only changes docs gets the rules and readability checks. A small change has fewer reviewers than a larger one (see the table below), and one with a single hunk has one.

A reviewer hands its deep dives to subagents: callers elsewhere in the repository, contracts defined outside its slice, paths through several modules, or a reproduction that needs its own run. Subagents run after the reviewers, up to the limit in Settings → Review harness: **Off**, **Up to 3**, **Up to 8** (the default), **Up to 12** or **Uncapped**. The token budget (see below) sets this limit too. Every reviewer lists its requests most important first, and the limit is filled with every reviewer’s first request, then every reviewer’s second, so one reviewer cannot use it all. Past the limit, requests are merged or dropped. Second looks that a server can turn on count inside the same limit, so the limit is the most agents a review adds after its reviewers. **Uncapped** runs as many as the review’s remaining model calls and time can pay for.

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

## Token budget

Settings → Review harness has a **Token budget**: **Low**, **Medium** (the default) or **High**. One pick trades cost for thoroughness by setting several things together.

| | Low | Medium | High |
| --- | --- | --- | --- |
| Reviewers | 1 | 2, or 3 for a larger change | 4 |
| Subagents | Up to 3 | Up to 8 | Up to 12 |
| Reasoning effort | Low | Medium | High |
| Turns for each reviewer | 8 | 12 | 16 |
| Turns for each subagent | 5 | 8 | 10 |
| Model calls | 80 plus 12 per reviewer, 9 per subagent | 120 plus 16 per reviewer, 12 per subagent | 160 plus 20 per reviewer, 14 per subagent |

A larger change is one whose patch is over 48,000 characters, roughly 12,000 tokens. A change never gets more reviewers than it has hunks, and a change to docs only has one. Verification is the same at every budget: each finding is still tried by a fresh agent. Every budget picks the closest effort a model offers, and a model with no reasoning levels is sent none. If you change Subagents or an effort after picking, the budget reads **Custom**, and the review uses the limits of the budget you picked. A review’s Token usage names the budget it ran on, so you can compare spend.

## Limits

A review gets a budget of model calls and time that grows with its size. On Medium that is 120 calls, plus 16 for each reviewer, 12 for each subagent the limit allows and one for each part the change’s summary is read in, up to 2,000, and 30 minutes plus a minute for each reviewer and subagent, up to 2 hours. Install time is added back, up to 14 minutes. A review that runs out of time still finishes: it shows what was verified by then and says time ran out.

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
