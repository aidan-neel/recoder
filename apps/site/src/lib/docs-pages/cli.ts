import type { DocPage } from '~/lib/docs';

export const cli: DocPage = {
	slug: 'cli',
	title: 'CLI',
	body: `\`recoder\` runs a review from a terminal, with no server and no app. You can run it yourself and read the report where you work, or hand it to a coding agent such as Claude Code, Codex or OpenCode, which reviews a change and acts on the findings. It runs the same review as the server and reads the same saved settings and tokens.

## Install

On macOS or Linux (on Windows, use WSL):

\`\`\`bash
curl -fsSL https://recoder.dev/install.sh | sh
\`\`\`

This downloads one binary for your machine from the latest release, checks it against the release’s checksums and puts it in \`~/.local/bin\`. It needs nothing else installed. Set \`RECODER_VERSION\` to install a given release tag, or \`RECODER_INSTALL_DIR\` to use another folder. Run the same command again to update.

## Set up

\`\`\`bash
recoder init
\`\`\`

\`init\` asks where to set Recoder up, then does the rest:

- **This project** (\`recoder init --project\`) installs the agent skill into \`.claude/skills\` and \`.agents/skills\` and creates \`RECODER.md\`, where you write the rules reviewers follow in this repository. Commit both, and everyone who clones the repository has them.
- **This machine** (\`recoder init --global\`) installs the skill into your home folder, for every project you open.

Either way it asks which model reviews should run on when none is chosen yet, and checks that the machine can run a review. Run it again after an update to refresh the skill. \`--yes\` asks nothing, \`--agent claude\` or \`--agent agents\` picks the skills folder, \`--reviewer <model id>\` saves the model without asking, and \`--mcp\` also adds the [MCP](/docs/mcp) server to the project's \`.mcp.json\`.

To check the machine at any time:

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

While it runs you see each stage and what every reviewer is doing. Then the report prints: the findings most severe first, each with where it is, how it was verified, a suggestion and, when there is one, a patch that was checked in the sandbox. Your working tree is only read: the review runs in a throwaway checkout, which is removed when it ends.

\`--format markdown\` prints a document and \`--format json\` every field; \`--output <file>\` writes the report to a file. The report goes to standard output and progress to standard error, so \`recoder review > review.txt\` saves it without the progress, and without colors.

Useful flags:

- \`--repo <path>\` reviews another repository.
- \`--budget low|medium|high\` sets how much the review spends. \`low\` is the default, since agents run reviews often.
- \`--reviewer <model id>\` and \`--worker <model id>\` pick the models for one run. \`recoder models\` lists the ids.
- \`--instructions <text>\` says what to look for or leave out.
- \`--min-severity\` and \`--include-unconfirmed\` filter the report; \`--fail-on <severity>\` exits 1 when a finding meets it.
- \`--no-exec\` runs no code, so bugs are reported unverified.

\`recoder review --help\` lists every flag.

## Long reviews

A review takes 5 to 40 minutes. To get your terminal back, start it in the background:

\`\`\`bash
recoder review --detach   # starts the review and returns at once
recoder wait              # shows its progress until it ends
recoder result            # prints the report
\`\`\`

A detached review keeps going when the terminal closes. \`status\`, \`wait\`, \`result\` and \`cancel\` act on the newest run unless you name one. \`recoder runs\` lists them, and the six characters it shows are enough to name a run, as in \`recoder result a1b2c3\`.

## For agents and scripts: \`-p\`

Add \`-p\` (\`--programmatic\`) to any command and it prints JSON, with fields that keep their shape, and plain progress lines:

\`\`\`bash
recoder review -p --detach             # one JSON line with the runId
recoder wait -p <run-id> --timeout 5   # the run's status after 5 minutes, or when it ends
recoder result -p <run-id>             # the report as JSON
\`\`\`

A review outlasts most agents' shell time limits, so an agent starts it with \`--detach\` and calls \`wait\` again while \`state\` is \`running\`. The agent skill teaches exactly this loop. Without \`-p\` the output is written for a person and may change between releases, so do not parse it.

## Commands

| Command | What it does |
| --- | --- |
| \`recoder review\` | Run one review and print the report. |
| \`recoder runs\` | List recent runs, newest first. |
| \`recoder status [run]\` | Show how a run is doing. |
| \`recoder wait [run]\` | Follow a run until it ends. |
| \`recoder result [run]\` | Print a finished run’s report. |
| \`recoder cancel [run]\` | Stop a running review. |
| \`recoder init\` | Set Recoder up for your agents, in this project or on this machine. |
| \`recoder doctor\` | Check that a review can run on this machine. |
| \`recoder models\` | List the model ids \`--reviewer\` and \`--worker\` accept. |
| \`recoder skill install\` | Install the agent skill by itself. |
| \`recoder mcp\` | Serve these commands as MCP tools. See [MCP](/docs/mcp). |

Every command takes \`-p\` and \`--help\`.

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

The skill tells a coding agent when to review and how to use the commands. \`recoder init\` installs it. To install only the skill:

\`\`\`bash
recoder skill install
\`\`\`

Add \`--scope project\` to install it in the current repository, \`--agent agents\` for agents that read \`~/.agents/skills\`, or \`--dir <path>\` for any other skills folder. Once it is installed, ask your agent to review a change with recoder.

## Where runs are kept

Every review is recorded under \`~/.recoder/data/cli-runs/<run-id>/\` (or \`$RECODER_DATA_DIR/cli-runs\`), with its report, progress and log. The 50 newest finished runs are kept. Reports quote your code, so these folders are readable only by you.`
};
