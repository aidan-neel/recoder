import type { DocPage } from '~/lib/docs';

export const guidelines: DocPage = {
	slug: 'guidelines',
	title: 'Guidelines',
	body: `Guidelines tell reviewers what your team cares about: what to look for, what to ignore, how to rank severity and which conventions to hold code to. They are plain Markdown, up to 8,000 characters per layer.

## Two layers

- **Global** guidelines apply to every repository. Edit them in Settings → Guidelines → Global. A fresh install starts with Recoder’s defaults; saving replaces them, and saving an empty text turns the layer off.
- **Repository** guidelines live in \`RECODER.md\` at the repository root. Repositories that already have \`.recoder/REVIEW.md\` keep working. Recoder reads the first of the two that exists and ignores the other, so \`RECODER.md\` wins when both are there.

Recoder reads the repository file from the pull request’s base commit, so a pull request can’t change the rules it is reviewed by. A change to \`RECODER.md\` applies to pull requests opened against the branch after it merges.

## Which rules win

1. Recoder’s own safety rules.
2. Repository guidelines. Where they disagree with the global layer, the repository wins.
3. Global guidelines.
4. \`AGENTS.md\`, \`CLAUDE.md\`, \`CONTRIBUTING.md\` and the pull request’s own text. Reviewers read these as context, not as orders.

## Edit a repository’s guidelines from Recoder

Settings → Guidelines → Repositories lists each tracked repository with the state of its file, like **Active · main** or **Pending in #12**. Edit the text and press **Open pull request**. Recoder commits the file on a new branch and opens a pull or merge request for your team to review. A repository on \`.recoder/REVIEW.md\` keeps that path; one with neither file gets \`RECODER.md\`. While that request is open, saving again updates it (**Update pull request**).

This needs a token that can push a branch and open a pull request (GitHub \`repo\`, GitLab \`api\`). You can also edit \`RECODER.md\` in your editor and merge it like any other change.

## Draft with Orchestrator

**Draft with Orchestrator** writes or revises guidelines from a short description, like “stop flagging naming”. Under **Sources** you can also let it read the repository’s instruction files, the global guidelines and the findings of recent reviews.

## Template

\`\`\`markdown
## Focus
- Missing auth checks on new routes

## Ignore
- Generated files under src/gen

## Severity
- Treat unhandled promise rejections as high

## Conventions
- Errors are returned, not thrown, in the service layer
\`\`\`

## One-off instructions

To steer a single review, mention Recoder in a comment with what you want, like \`@recoder focus on the auth changes\` (see [Auto-review](/docs/auto-review)), or choose **Talk it through first** in the queue and tell Orchestrator before you start.`
};
