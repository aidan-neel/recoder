# Auto-review

Recoder watches the repositories you track and starts reviews on its own. It
works with GitLab (gitlab.com and self-managed) and GitHub. Local repositories
are never watched.

## Settings

Settings → Auto-review, stored in `<data dir>/auto-review.json`. It is off
until you turn it on.

| Setting | Default | What it does |
| --- | --- | --- |
| On | off | Nothing below happens while it is off, webhooks included. |
| Check every | 2 minutes | How often each repository is polled. |
| On mention | on | Review when a comment mentions the handle. |
| Handle | `@recoder` | One word starting with `@`. |
| When opened | off | Review every pull request when it opens. |
| On new commits | off | Review again when a pull request Recoder reviewed automatically gets new commits. |
| Skip drafts | on | Drafts wait for a mention. |
| Post results | on | React 👀 to the mention, keep one Recoder comment on the pull request up to date, and submit the verified findings as a review when it finishes. |
| Excluded repositories | none | Tracked repositories the watcher leaves alone. |
| Ignored paths (`ignoredPaths`) | none | Globs such as `docs/**` or `**/*.md`. Findings in these files are never posted and never fail the check. |
| Inline comments (`maxInlineComments`) | 25 | The most findings posted on their lines in one review, worst first (0 to 100). The rest are listed in the review's summary. |
| Check (`checkThreshold`) | `error` | Verified findings at or above this severity (`info`, `warning`, `error`) fail the `recoder` commit status. `off` sets no status. |

The same settings are `GET` and `PUT /api/settings/auto-review`, and
`POST /api/settings/auto-review/check` runs one check now.

## Posting findings

When an automatic review with **Post results** on finishes, Recoder submits
its verified findings to the pull request. A review started from the app
posts them when someone calls `POST /api/reviews/<id>/findings-review`.

- **One review.** On GitHub, the summary and every inline comment go up in
  one "create review" request. On GitLab, each finding becomes a diff
  discussion with a position, and the summary note follows.
- **Anchoring.** A finding sits on its line when the pull request's diff
  shows that line. A finding without a shown line, one the forge refuses to
  place, or one past the inline limit is listed in the summary instead.
- **Suggestions.** A finding's checked patch becomes a one-click suggestion
  only when it is small (20 changed lines at most), replaces one run of lines
  in the finding's own file that the diff shows, and covers the finding's
  lines. Any other patch is left out of the comment.
- **Evidence.** Each finding names its evidence in the words the app uses:
  *Reproduced* (the command, its output and how the base commit compares),
  *Traced in code* (the source path, or the deterministic check), or
  *Repository rule* (the quoted rule and where it is written). Unverified,
  dismissed and quieted findings are not posted and do not count toward the
  check.
- **Check.** The `recoder` commit status on the head commit (GitHub status,
  GitLab commit status) fails when a verified finding is at or above the
  check threshold.
- **New commits.** A finding already commented on the pull request is not
  posted again, nor is one carried from an earlier review that submitted its
  findings. When a later review shows an earlier finding fixed, Recoder
  resolves that finding's thread and lists it as fixed.
- **No duplicates.** The summary carries a hidden marker for the pull
  request and head commit, and each comment one for its finding. A repeated
  webhook delivery, a retry or a second review of the same commit finds
  them and posts nothing twice. With several replicas, posting runs under
  the shared publication lock.

Recoder only writes comments, thread resolutions and commit statuses. It
never pushes to the pull request's branch; applying a suggestion is the
author's choice.

## Mentions

Comment on a merge request or pull request:

```
@recoder focus on the migration and the retry logic
```

Everything after the handle becomes the review's instructions, the same as
typing them to the orchestrator before a review starts. A bare `@recoder`
runs a plain review. Mentions inside code, inline code or a quote don't
count, and Recoder never answers its own comments. A newer mention or push
cancels the pull request's automatic review that is still running.

Each comment starts at most one review, even across restarts and when both
polling and a webhook see it: what the watcher has seen is kept in
`<data dir>/auto-review-state.json`. The first check of a repository only
records where things stand, so old comments never start reviews.

## Polling or webhooks

Polling is the default and needs nothing from the forge, which suits a
server on a laptop that GitLab can't reach. Each check lists the open pull
requests updated since the last one and reads their comments.

If GitLab or GitHub can reach the server, add a webhook as well, so reviews
start within seconds. Polling can stay on: the two never start the same
review twice.

**GitLab** (project or group → Settings → Webhooks):

- URL: `https://<server>/api/webhooks/gitlab`
- Secret token: any value, also set as `GITLAB_WEBHOOK_SECRET` on the server.
  When the variable is set, a request without the matching token is refused.
- Trigger: **Merge request events** and **Comments**.

**GitHub** (repository → Settings → Webhooks):

- URL: `https://<server>/api/webhooks/github`, content type `application/json`
- Secret: the value of `GITHUB_WEBHOOK_SECRET`.
- Events: **Pull requests**, **Issue comments** and **Pull request review comments**.

A webhook follows the same settings as polling: it does nothing while
auto-review is off, for excluded repositories, or for an event the settings
don't review.

## Token scopes

Connect tokens in Settings → Connections, or set `GITLAB_TOKEN` / `GH_TOKEN`.

- GitLab: `read_api` is enough to watch. Posting results and the 👀 reaction
  need `api`. Without a token, Recoder falls back to the `glab` CLI's login.
- GitHub: read access to watch public repositories (private ones need a
  token). Posting results and reactions need pull request (and issue) write
  access: a fine-grained token with **Pull requests: Read and write**, or a
  classic token with `repo`. The check also needs **Commit statuses: Read
  and write** (classic: `repo:status`, included in `repo`).
