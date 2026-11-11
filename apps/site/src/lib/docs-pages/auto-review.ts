import type { DocPage } from '~/lib/docs';

export const autoReview: DocPage = {
	slug: 'auto-review',
	title: 'Auto-review',
	body: `Auto-review starts reviews without you: when someone mentions Recoder in a pull request comment, and optionally when a pull request opens or gets new commits. It is off until you turn it on in Settings → Auto-review.

## Turn it on

1. Pick a Review model (Settings → Agent). Without one, auto-review can’t start anything and says so under the watcher.
2. Track the repositories to watch (Settings → Connections).
3. In Settings → Auto-review, switch on **Watch repositories**.

The server must be running for anything to happen. Reviews it starts show under **Recent** and in the queue like any other.

## How it notices

Every **Check every** interval (1, 2, 5, 10 or 30 minutes; 2 by default), Recoder asks GitHub or GitLab for pull requests updated since its last check, with their new comments. **Check now** runs a round at once. Each round’s time, the number of repositories watched and any repository that failed show under **Watcher**.

The first check of a repository only records the time. Pull requests and comments that were already there are history and never start a review.

To react within seconds instead, point a [webhook](/docs/webhooks) at Recoder. Polling keeps running beside it, and the two share their record of what they have seen, so one comment or commit never starts two reviews.

## What starts a review

Settings → Auto-review → **Start a review when**:

| Setting | Default | Starts a review when |
| --- | --- | --- |
| Someone mentions Recoder | On | A new comment contains the mention handle. |
| Mention handle | \`@recoder\` | The word that counts as a mention. |
| A pull request opens | Off | A pull request is opened after Recoder started watching. |
| New commits land on a reviewed pull request | Off | A pull request Recoder reviewed automatically gets new commits. |
| Skip drafts | On | Opens and pushes on draft pull requests are ignored. A mention still works. |

A pull request whose current commit already has a review isn’t reviewed again when it opens or gets a push. A mention always starts a review.

## Mentions

\`@recoder focus on the auth changes\` starts a review and gives it “focus on the auth changes” as instructions, up to 2,000 characters. A bare \`@recoder\` starts a plain review.

- The handle matches as a whole word, in any case. \`@recoder-bot\` and \`x@recoder.dev\` don’t count.
- Mentions inside code, inline code or quoted lines (\`>\`) don’t count.
- When several new comments mention it, the newest wins.
- Recoder’s own comments never count, even when it posts with the same account that mentioned it.

The handle doesn’t need to be a real account: Recoder reads comments itself. If an account with that name exists on your GitHub or GitLab, it gets notified each time someone types it, so pick a handle no one has, or the account Recoder posts as. A handle is one word that starts with \`@\`, using letters, digits, \`_\`, \`-\` and \`.\`.

## On the pull request

With **Post results** on (the default), Recoder reacts 👀 to the comment that mentioned it, then posts one comment on the pull request and updates it as the review runs and when it ends. On GitLab, a review started from a comment thread replies in that thread. See [PR comments](/docs/pr-comments). Posting needs a token with write access; a GitLab token needs the \`api\` scope. Without it the review still runs, and the comment’s failure shows on the review page.

Turn **Post results** off to keep results in Recoder.

## Repositories

Every tracked GitHub and GitLab repository is watched, including ones you track later. Switch one off under **Repositories** to leave it alone; webhooks for it are ignored too. Local repositories have nothing to watch.

## Good to know

- When a new automatic review of a pull request starts, an older one still running is cancelled.
- Recoder keeps the watcher’s settings in \`auto-review.json\` and what it has seen in \`auto-review-state.json\`, both in the data directory, so a restart never reviews the same comment twice. Pull requests untouched for 60 days are forgotten.
- Each round makes a few API requests per repository: the pull requests updated since the last check, then the new comments on each. Keep the interval at a few minutes when you watch many repositories. On GitHub, polling uses the REST API, so connect a token: without one, GitHub allows only 60 requests an hour.`
};
