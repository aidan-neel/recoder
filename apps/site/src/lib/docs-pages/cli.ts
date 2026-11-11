import type { DocPage } from '~/lib/docs';

export const cli: DocPage = {
	slug: 'cli',
	title: 'CLI',
	body: `\`recoder\` runs a review from a terminal, with no server and no app. It is made for coding agents such as Claude Code, Codex and OpenCode, which review a change and act on the findings, and it works just as well by hand. It runs the same review as the server and reads the same saved settings and tokens.

## Install

On macOS or Linux (on Windows, use WSL):

\`\`\`bash
curl -fsSL https://recoder.dev/install.sh | sh
\`\`\`

This downloads one binary for your machine from the latest release, checks it against the release’s checksums and puts it in \`~/.local/bin\`. It needs nothing else installed. Set \`RECODER_VERSION\` to install a given release tag, or \`RECODER_INSTALL_DIR\` to use another folder. Run the same command again to update.

Check the machine before your first review:

\`\`\`bash
recoder doctor
\`\`\`

It checks git, the data folder, the review model and its sign-in, and whether code can run in the sandbox. It exits 0 when a review can run and 4 when not, and each failed check says how to fix it.

## Review a change

Run it in the repository you want reviewed:

\`\`\`bash
recoder review                  # the current branch against the default branch
recoder review --uncommitted    # uncommitted work, untracked files included
recoder review --staged         # what is staged
recoder review --pull 214       # a pull or merge request (needs gh or glab)
recoder review --diff change.diff
\`\`\`

The report goes to standard output as JSON (\`--format markdown\` for a document) and progress goes to standard error. Your working tree is only read: the review runs in a throwaway checkout, which is removed when it ends.

Useful flags:

- \`--repo <path>\` reviews another repository.
- \`--budget low|medium|high\` sets how much the review spends. \`low\` is the default, since agents run reviews often.
- \`--reviewer <model id>\` and \`--worker <model id>\` pick the models for one run. \`recoder models\` lists the ids.
- \`--instructions <text>\` says what to look for or leave out.
- \`--min-severity\` and \`--include-unconfirmed\` filter the report; \`--fail-on <severity>\` exits 1 when a finding meets it.
- \`--no-exec\` runs no code, so bugs are reported unverified.

\`recoder review --help\` lists every flag.

## Long reviews

A review takes 5 to 40 minutes, longer than most agents’ shell time limits. Start it in the background and wait in steps:

\`\`\`bash
recoder review --detach           # prints the run, with its runId
recoder wait <run-id> --timeout 5 # returns after 5 minutes, or when the run ends
recoder result <run-id>           # prints the report once state is complete
\`\`\`

Call \`wait\` again while \`state\` is \`running\`. A detached review keeps going when the terminal closes.

## Commands

| Command | What it does |
| --- | --- |
| \`recoder review\` | Run one review and print the report. |
| \`recoder status <run-id>\` | Print a run’s status. |
| \`recoder wait <run-id>\` | Wait for a run to end, then print its status. |
| \`recoder result <run-id>\` | Print a finished run’s report. |
| \`recoder cancel <run-id>\` | Stop a running review. |
| \`recoder runs\` | List recent runs, newest first. |
| \`recoder models\` | List the model ids \`--reviewer\` and \`--worker\` accept. |
| \`recoder skill install\` | Install the agent skill. |
| \`recoder mcp\` | Serve these commands as MCP tools. See [MCP](/docs/mcp). |
| \`recoder doctor\` | Check that a review can run on this machine. |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Done. No finding met \`--fail-on\`. |
| 1 | A finding met \`--fail-on\`. |
| 2 | A flag or argument was wrong. Nothing ran. |
| 3 | The review did not finish. |
| 4 | The machine is not ready. Run \`recoder doctor\`. |
| 130 | Stopped by a signal or by \`--timeout\`. |

## The agent skill

The skill tells a coding agent when to review and how to use the commands. Install it for Claude Code:

\`\`\`bash
recoder skill install
\`\`\`

Add \`--scope project\` to install it in the current repository, \`--agent agents\` for agents that read \`~/.agents/skills\`, or \`--dir <path>\` for any other skills folder.

## Where runs are kept

Every review is recorded under \`~/.recoder/data/cli-runs/<run-id>/\` (or \`$RECODER_DATA_DIR/cli-runs\`), with its report, progress and log. The 50 newest finished runs are kept. Reports quote your code, so these folders are readable only by you.`
};
