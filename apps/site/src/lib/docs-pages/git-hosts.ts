import type { DocPage } from '~/lib/docs';

export const gitHosts: DocPage = {
	slug: 'git-hosts',
	title: 'GitHub and GitLab',
	body: `Recoder reviews pull requests on github.com and merge requests on gitlab.com or a self-managed GitLab. GitHub Enterprise Server isn’t supported: every GitHub call goes to github.com.

## Connect a token

Open Settings → Connections and press **Connect** next to GitHub or GitLab. Paste a personal access token. For GitLab, also enter your instance in **GitLab URL**, or leave it blank for gitlab.com.

Recoder checks that the token signs in (GitHub through \`gh api user\`, GitLab through \`/api/v4/user\`), then saves it in \`tokens.json\` in the data directory, readable only by you (\`0600\`). It doesn’t check the token’s scopes, so a token with too little access fails later, when Recoder first needs it. **Disconnect** forgets the saved token. A \`gh\` or \`glab\` CLI that is signed in on the server keeps working after that.

You can set tokens in the environment instead. \`GH_TOKEN\` and \`GITLAB_TOKEN\` win over a token saved in Settings, and \`GITLAB_HOST\` wins over the saved GitLab URL. Tokens from the environment are never written to disk.

## Token scopes

| To | GitHub | GitLab |
| --- | --- | --- |
| Review | \`repo\` (classic token) | \`read_api\` and \`read_repository\` |
| Post comments, react to mentions, open guideline changes | \`repo\` (classic token) | \`api\` |

With a fine-grained GitHub token, give it read access to the repository’s contents and pull requests, write access to pull requests to post comments, and write access to contents to open guideline changes. Public GitHub repositories can be reviewed without a token.

Comments appear under the token’s account. To have them come from a bot, connect a token that belongs to a service account, or a GitLab project or group access token.

## Self-managed GitLab

1. Connect a token with your instance in **GitLab URL**, like \`gitlab.acme.com\`, or set \`GITLAB_HOST=gitlab.acme.com\` on the server.
2. Track your repositories after that. Recoder knows a URL is GitLab when its host contains \`gitlab.\` or matches the configured host, so a repository on a host like \`git.acme.com\` is refused until the host is set.

Things to know:

- Recoder reaches the API over HTTPS only, at \`https://<host>/api/v4/\`.
- Recoder has no setting for a private certificate authority. If your instance uses one, the server’s runtime and \`git\` on that machine must already trust it. A DNS or TLS failure shows up as a network error that names the host.
- Recoder keeps one GitLab token and one GitLab host. Use the instance your repositories live on.
- An instance on a non-default port isn’t fully supported: reading and writing guideline files drops the port.
- Merge request diffs come from the \`/diffs\` endpoint (GitLab 15.7 and later), with a fallback to \`/changes\` on older versions.

## Track repositories

In Settings → Connections → Repositories, press **Add repository**. With a token connected, you can search your repositories (the first 50 on GitHub, the projects you are a member of on GitLab) and press **Add**. Or use **Add by URL**: \`owner/name\` means GitHub, and any link into a repository works, including SSH addresses and GitLab subgroups.

Recoder doesn’t check access when you add a repository. A repository you can’t read fails when its pull requests load.

## How code is fetched

Recoder clones each repository with \`git\` into its work directory (\`/tmp/recoder-work\` unless you set \`RECODER_WORKDIR\`) and fetches the pull request’s head (\`pull/<n>/head\` on GitHub, \`merge-requests/<n>/head\` on GitLab). Tokens never go into clone URLs or command lines:

- **GitHub:** \`git\` asks \`gh\` for credentials (\`gh auth git-credential\`), so \`gh\` must be installed and signed in, or have \`GH_TOKEN\` or a connected token.
- **GitLab:** \`git\` gets the connected token as its password, for the configured host only. Without a token, only public projects can be cloned.

On GitHub, pull request lists, details and diffs come through \`gh\`; comments and file reads use the REST API. \`GITHUB_TOKEN\` is the last fallback for those REST calls, after a connected token and \`GH_TOKEN\`. On GitLab, everything goes through the REST API when a token is connected, and through \`glab\` when there is none and \`glab\` is installed.`
};
