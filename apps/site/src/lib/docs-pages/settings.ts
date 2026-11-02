import type { DocPage } from '~/lib/docs';

export const settings: DocPage = {
	slug: 'settings',
	title: 'Settings',
	body: `Settings opens over the page you are on. Open it with the gear in the top bar, with \`⌘,\` (or Ctrl and comma), or by searching for a section with \`⌘K\`. Close it with \`Esc\` or the browser’s Back button.

Each section has its own address, \`?settings=<section>\`, so you can link to one: \`/?settings=connections\` opens Connections over the queue. Old \`/settings/<section>\` links redirect there.

Most changes save as soon as you make them.

## Agent (\`agent\`)

| Group | What it holds |
| --- | --- |
| Agent CLIs | OpenCode, Claude Code and Devin, each **Ready**, **Not installed**, **Can’t run** or **Not signed in**, with the command that fixes it and **Check again**. |
| Providers | Model providers connected through OpenCode. **Add provider** connects one with an API key or a sign-in. |
| Models | **Review model** and **Subagent model** (or **Same as Review model**), each with its reasoning effort. Shown once a CLI is ready or a model is saved. |

See [Models and agents](/docs/models).

## Connections (\`connections\`)

| Group | What it holds |
| --- | --- |
| Forges | GitHub and GitLab: who you are signed in as, **Connect** with a personal access token (and a **GitLab URL** for self-managed GitLab), and **Disconnect**. |
| Repositories | The repositories you track. **Add repository** browses yours or adds one by URL. |

See [GitHub and GitLab](/docs/git-hosts).

## Auto-review (\`auto-review\`)

| Group | Settings |
| --- | --- |
| Watcher | **Watch repositories** (off), **Check every** (1, 2, 5, 10 or 30 minutes; 2), the last and next check, **Check now**, and repositories the last check failed on. |
| Start a review when | **Someone mentions Recoder** (on), **Mention handle** (\`@recoder\`), **A pull request opens** (off), **New commits land on a reviewed pull request** (off), **Skip drafts** (on). |
| On the pull request | **Post results** (on). |
| Repositories | One switch per tracked repository, on by default. |
| Recent | The latest reviews auto-review started, and why. |
| Webhooks | The GitLab and GitHub webhook addresses, to copy. |

See [Auto-review](/docs/auto-review) and [Webhooks](/docs/webhooks).

## Review harness (\`harness\`)

| Setting | Default | What it does |
| --- | --- | --- |
| Token budget | Medium | How many tokens a review may spend: **Low**, **Medium** or **High**. A pick sets Subagents, both reasoning efforts and how long reviewers run, all at once. **Custom** appears by itself when you change Subagents or an effort afterwards; the review keeps the limits of the budget you picked. See [How reviews work](/docs/how-reviews-work). |
| Subagents | Up to 2 | How many subagents a review may run: **Off**, **Up to 2**, **Up to 4** or **Uncapped**. Uncapped runs one for every open question that warrants it, as far as the review’s model calls and time allow, and uses many more tokens. |
| Low severity findings | On | Off, reviews report medium and above. |
| Characters per file | 12,000 | Most characters one file read returns to a model. Longer files are cut. |
| Files per review | 20 | Saved, but no review stage reads it yet. |
| Diff characters | 60,000 | Saved, but no review stage reads it yet. |

**Storage** shows the path of the config file these are saved in.

## Guidelines (\`guidelines\`)

The global guidelines, under **Global**, and each tracked repository’s \`RECODER.md\`, under **Repositories**. Changes to a repository’s file are proposed as a pull request. See [Guidelines](/docs/guidelines).

## Appearance (\`appearance\`)

**Theme**: System, Light or Dark. It is saved in your browser, not on the server.

## Where settings are saved

Everything but the theme, OpenCode’s provider keys and the CLIs’ own sign-ins is saved in the server’s data directory (\`~/.recoder/data\`, or \`RECODER_DATA_DIR\`), readable only by the user running the server:

| File | Holds |
| --- | --- |
| \`review-config.json\` | Models, efforts and the review harness settings. |
| \`tokens.json\` | GitHub and GitLab tokens. |
| \`gitlab-host.json\` | The self-managed GitLab host. |
| \`review-guidelines.md\` | The global guidelines. |
| \`auto-review.json\` | Auto-review settings. |
| \`auto-review-state.json\` | What auto-review has already seen. |

OpenCode keeps provider keys in its own store on the same machine. Saved settings win over the matching environment variables, except tokens and the GitLab host, where \`GH_TOKEN\`, \`GITLAB_TOKEN\` and \`GITLAB_HOST\` win.`
};
