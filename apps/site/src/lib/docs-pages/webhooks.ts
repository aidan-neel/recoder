import type { DocPage } from '~/lib/docs';

export const webhooks: DocPage = {
	slug: 'webhooks',
	title: 'Webhooks',
	body: `A webhook lets GitLab or GitHub tell Recoder about a new comment, pull request or push the moment it happens, instead of waiting for the next [auto-review](/docs/auto-review) check.

Webhooks follow the auto-review settings. An event starts a review only when **Watch repositories** is on, the repository is tracked and not switched off under **Repositories**, and the event matches a switch under **Start a review when**. Settings → Auto-review → **Webhooks** shows both addresses with a copy button.

Recoder has no sign-in, so GitLab or GitHub must reach the server without one. If you expose the server for webhooks, expose only \`/api/webhooks/\` (with a reverse proxy, for example) and set a secret.

## GitLab

In the project (or group), open Settings → Webhooks → **Add new webhook**:

- **URL:** \`https://<your-server>/api/webhooks/gitlab\`
- **Secret token:** the value of \`GITLAB_WEBHOOK_SECRET\` on the server
- **Trigger:** Merge request events and Comments

Recoder compares the hook’s \`X-Gitlab-Token\` header with \`GITLAB_WEBHOOK_SECRET\` and answers \`401 invalid token\` when they differ. With the variable unset, every request is accepted.

It acts on:

- a merge request opened or reopened;
- a merge request update that adds commits;
- a comment on an open merge request (system notes are ignored).

## GitHub

In the repository, open Settings → Webhooks → **Add webhook**:

- **Payload URL:** \`https://<your-server>/api/webhooks/github\`
- **Content type:** \`application/json\`
- **Secret:** the value of \`GITHUB_WEBHOOK_SECRET\` on the server
- **Events:** Pull requests, Issue comments and Pull request review comments

Recoder checks the \`X-Hub-Signature-256\` signature and answers \`401 invalid signature\` when it doesn’t match. With the variable unset, every request is accepted. A \`ping\` event answers \`pong\`.

It acts on:

- a pull request opened or reopened;
- a pull request synchronized (new commits);
- a new comment on an open pull request, in the conversation or on a line of the diff.

## What the server answers

The answer shows in the delivery log on GitLab or GitHub:

| Status | Body | Meaning |
| --- | --- | --- |
| \`201\` | \`reviewCreated: true\` and the review’s id | A review started. |
| \`200\` | \`reason: "auto-review is off"\` | **Watch repositories** is off. |
| \`200\` | \`reason: "repo not tracked"\` | No tracked repository matches the payload’s URLs. |
| \`200\` | \`reason: "repo excluded from auto-review"\` | The repository is switched off under **Repositories**. |
| \`200\` | \`reason: "nothing to review"\` | The event doesn’t match a setting, the commit is already reviewed, or the comment was already handled. |
| \`200\` | another \`reason\` | The review couldn’t start, for example because no Review model is picked. |

Any other event is acknowledged and ignored. Recoder matches the repository by host and path, so its HTTPS, \`.git\` and SSH addresses all match.

## Docker

\`docker-compose.yml\` passes \`GITLAB_WEBHOOK_SECRET\` and \`GITHUB_WEBHOOK_SECRET\` from \`.env\` to the server.`
};
