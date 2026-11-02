import type { DocPage } from '~/lib/docs';

export const reviewing: DocPage = {
	slug: 'reviewing',
	title: 'Reviewing',
	body: `The queue lists open pull requests, a review runs while you watch, and then you decide each finding and question it raised.

## The queue

The queue shows the open pull requests of every repository you track, in groups: **Needs you**, **Reviewing**, **Not reviewed**, **With the agent** and **Ready to merge**. Empty groups are hidden.

- Move with \`j\` and \`k\`, open with \`Enter\`.
- Start a review with \`r\` or the row’s button: **Review**, **Review again** after new commits, or **Continue** after a failed run.
- Right-click a row for **Talk it through first**, which opens the review as a draft. Tell Orchestrator what to focus on, then press **Start review**.
- To review a pull request the queue doesn’t list, press \`⌘K\` (\`Ctrl K\`), choose **Review a pull request…**, then paste its link or type its number (\`12\`, or \`api#12\` to pick the repository). A pull request from a repository you don’t track offers **Track a repository**.

Every open review gets a tab in the top bar, next to Queue.

## While it runs

The review page shows each stage as it happens: Checkout, Understand changes, Running checks, Reviewing, Running subagents, Verifying findings and Consolidation. Findings appear as soon as they are verified, so you can start deciding before the review ends.

**Pause** stops new model calls until you **Resume**. **Cancel review** stops it and keeps what it found. A failed review can **Continue** from where it stopped. These are also in the **…** menu, with **Token usage**.

## The overview

The overview says how many changed lines need your eyes and about how long they take. The rail beside it lists:

- **Needs you**: findings, and questions no reviewer could settle.
- **Checked for you**: what reviewers looked into and found sound, with CI checks and the commands they ran.
- **Files**: the change map. Each changed line is marked **Read** (it has an open decision, or no reviewer covered it), **Checked** (reviewers examined it and nothing is open), **Tests** or **Skim** (lockfiles, docs, generated output).

Each finding shows how it was proven: **Reproduced** (a command showed it), **Traced in code**, **Checked** (a static check or one of your rules), or **Not proven**.

## Decide

Press **Start with the riskiest** (\`Enter\`), then decide each item:

| Key | Decision | Meaning |
| --- | --- | --- |
| \`a\` | Accept | A real point that ships as is. |
| \`s\` | Send back | It goes to the coding agent in the hand-off. |
| \`x\` | Not an issue | Findings only. Recoder won’t raise it again in this repository. |

Deciding moves to the next open item. \`u\` undoes the last decision. Decisions belong to one review: after new commits, **Review again** starts a fresh one.

## Hand off

Press \`h\` (**Hand off to the agent**) when you have sent items back. Recoder writes one prompt listing each item with its severity, location, the command that reproduced it, any suggested fix and your note. Press **Copy prompt** and paste it into the agent that opened the pull request.

When nothing is open and nothing was sent back, the page offers **Approve on GitHub** or **Approve on GitLab**. That opens the pull request; Recoder doesn’t approve it for you.

## Ask

Press \`q\` to ask about what you’re reading. On a finding you talk to the reviewer that raised it (**Ask the reviewer**). On the overview you talk to Orchestrator about the whole review (**Ask Orchestrator**).

## Comment on the pull request

**Comment on PR** in the review header posts the summary and findings as one comment, and **Post to PR** on a finding comments it on its line. See [PR comments](/docs/pr-comments).

## Shortcuts

| Key | Where | Does |
| --- | --- | --- |
| \`⌘K\` | anywhere | Search and actions |
| \`⌘,\` | anywhere | Settings |
| \`?\` | anywhere | All shortcuts |
| \`j\` \`k\` | queue, review | Next and previous |
| \`r\` | queue | Review the selected pull request |
| \`f\` | review | Open the file |
| \`o\` | review | Back to the overview |

\`Ctrl\` works in place of \`⌘\`.`
};
