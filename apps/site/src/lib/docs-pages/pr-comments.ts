import type { DocPage } from '~/lib/docs';

export const prComments: DocPage = {
	slug: 'pr-comments',
	title: 'PR comments',
	body: `Recoder can post its results on the pull or merge request: one summary comment that it keeps up to date, and a comment per finding on its line of the diff. Nothing is posted unless you ask, or [auto-review](/docs/auto-review) is set to post results.

## The summary comment

Press **Comment on PR** in the review header. Recoder posts one comment with the review’s summary and its findings grouped by severity, each linking to its place in the diff. Low-severity findings fold into a closed section.

- While the review runs, the comment reads **Reviewing \`<commit>\`…** with the current stage, and Recoder edits it at most every 20 seconds as the review moves on.
- When the review ends, Recoder edits it once more: **Reviewed \`<commit>\`** with the results, or **Review failed** or **Review cancelled**.
- The button then reads **Update PR comment**, and an icon beside it opens the comment.

There is one summary comment per pull request. A later review of the same pull request edits that comment instead of posting another, and if someone deletes it, the next update posts it again. Recoder finds its own comments by a hidden marker, so this survives a server restart.

Recoder breaks every \`@name\` it quotes with an invisible character, so its comments never notify anyone or summon a bot.

## A finding on its line

On a finding, press **Post to PR**. Recoder comments it on its line of the diff. When the diff doesn’t show that line, it posts a plain comment that links to it instead. Posting the same finding again edits its comment, and the button reads **Update on PR**. Questions have no line, so they can’t be posted.

## When it is posted for you

With auto-review’s **Post results** on, a review that auto-review starts posts the summary comment as soon as it starts, and Recoder reacts 👀 to the comment that mentioned it. On GitLab, a review started from a comment replies in that comment’s thread.

## What it needs

| Forge | Needs |
| --- | --- |
| GitHub | A token with write access to pull requests (classic \`repo\`), connected in Settings → Connections or set as \`GH_TOKEN\` or \`GITHUB_TOKEN\`. A signed-in \`gh\` alone isn’t used for comments. |
| GitLab | A token with the \`api\` scope. \`read_api\` is enough to review but not to comment. Without any token, Recoder posts through a signed-in \`glab\`. |

Comments appear under the token’s account.

The buttons appear only on started reviews of GitHub and GitLab pull requests: not on drafts, local repositories or the sample.

## When it fails

A failed post shows a toast with the reason. **Comment on PR** also shows a warning until the next post succeeds; its tooltip repeats the reason. Common reasons:

- **“Add a GitHub API token with pull request write access in Settings → Connections.”** No GitHub token is connected or set.
- **“Connect a GitLab token with the api scope in Settings → Connections.”** No GitLab token is connected and \`glab\` isn’t signed in.
- **“… rejected the token (403). It needs the api scope.”** The GitLab token is read-only.
- **“A newer review of this pull request keeps its comment up to date.”** Post from the newest review.`
};
