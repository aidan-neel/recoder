import type { DocPage } from '~/lib/docs';

export const troubleshooting: DocPage = {
	slug: 'troubleshooting',
	title: 'Troubleshooting',
	body: `Start with the server. \`curl http://localhost:3001/health\` answers when it is up, and its terminal (or \`docker compose logs server\`) prints every request and error.

## The app says the server is offline

The app reaches the server at the address built into it: \`NEXT_PUBLIC_API_URL\`, default \`http://localhost:3001\`. Start the server with \`bun run dev\`, or rebuild the Docker app image after changing \`PUBLIC_API_URL\`.

## “Untrusted origin”

The server accepts sign-ins and token changes only from \`FRONTEND_URL\`, plus any \`http://localhost\` address when \`NODE_ENV\` isn’t \`production\`. Set \`FRONTEND_URL\` to the address you open the app at.

## Setup is stuck on “Connect a model provider”

Providers are added through OpenCode. If the step says OpenCode isn’t installed, install it on the server machine with the command shown, then press **Check again**. Signing in to Claude Code or Devin, or setting the \`RECODER_REVIEW_*\` variables, also completes the step.

## “No model is set up. Pick one in Settings → Agent.”

No Review model is picked and the \`RECODER_REVIEW_*\` variables aren’t set. Pick one in Settings → Agent → Models.

## A token is rejected

**Connect** only checks that the token signs in. “Token rejected by …” means the token is wrong or expired, or, for self-managed GitLab, the **GitLab URL** points at the wrong host. Connecting a GitHub token needs the \`gh\` CLI on the server.

## “Recoder tracks GitHub and GitLab repositories.”

Your GitLab host doesn’t contain \`gitlab.\`, so Recoder doesn’t know it is GitLab yet. Connect your GitLab token with the instance in **GitLab URL**, or set \`GITLAB_HOST\`, then add the repository again.

## “… rejected the token (403). It needs the api scope.”

The GitLab token can read but not write. Posting comments, reacting to mentions and opening guideline changes need the \`api\` scope.

## GitLab requests fail with a network error

The error names the host. A self-managed instance usually fails on DNS or TLS: check that the server machine resolves the host and trusts its certificate. Recoder reaches GitLab over HTTPS only.

## “command "glab" is not allowlisted”

\`RECODER_ALLOWED_COMMANDS\` leaves out \`glab\`, which is the Docker default. Connect a GitLab token, so Recoder uses the REST API, or add \`glab\` to the list.

## Reviews don’t run code

The review says why. The usual reasons:

- “Running code needs bubblewrap (\`bwrap\`).” Install bubblewrap on the Linux server.
- “Running code is not supported on native Windows.” Run the server under WSL.
- “Code execution is turned off (RECODER_EXEC=off).”
- The Docker image has no sandbox, so reviews there only read code.

Bugs that couldn’t be reproduced then show as **Not proven**.

## Auto-review doesn’t start a review

- Check that **Watch repositories** is on and the repository’s switch is on under **Repositories**.
- Check the **Watcher** group for a failed repository and its error.
- The first check of a repository only records the time. Comments from before it don’t count.
- A mention must use the handle as a whole word, outside code and quotes.
- **A pull request opens** and **New commits land on a reviewed pull request** are off by default, and drafts are skipped unless someone mentions Recoder.
- A Review model must be picked.

## A webhook answers 401

The secret on GitLab or GitHub doesn’t match \`GITLAB_WEBHOOK_SECRET\` or \`GITHUB_WEBHOOK_SECRET\` on the server. With Docker, set them in \`.env\` and recreate the server container. Other answers are listed in [Webhooks](/docs/webhooks).

## A comment fails to post

The toast gives the reason, and the warning on **Comment on PR** repeats it in its tooltip. See [PR comments](/docs/pr-comments).`
};
