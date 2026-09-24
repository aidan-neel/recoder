import { Hono } from 'hono';
import { z } from 'zod';
import { GUIDELINES_PATH, MAX_GUIDELINES_CHARS, type GuidelinesOverview, type GuidelinesProposal, type RepoGuidelines } from '@recoder/shared';
import { GhError } from '../lib/gh';
import { GUIDELINES_TEMPLATE, normalize, readGlobalGuidelines, writeGlobalGuidelines } from '../lib/guidelines';
import { streamGuidelinesDraft } from '../lib/guidelines-draft';
import { LlmError } from '../lib/llm';
import { isReviewConfigured } from '../lib/models';
import { repoFileHost } from '../lib/repo-files';
import { db } from '../store';

/** Branches Recoder opens for guideline changes; one pending change per repo. */
const BRANCH_PREFIX = 'recoder/review-guidelines-';

const contentSchema = z.object({ content: z.string().max(MAX_GUIDELINES_CHARS * 2) });
const draftSchema = z.object({
	scope: z.enum(['global', 'repo']),
	repoId: z.string().max(200).optional(),
	prompt: z.string().max(4000),
	current: z.string().max(MAX_GUIDELINES_CHARS * 2).optional(),
	include: z.object({ instructions: z.boolean().optional(), findings: z.boolean().optional(), global: z.boolean().optional() }).optional()
});

const app = new Hono();

function providerError(err: unknown): { error: string; status: 401 | 404 | 502 } | null {
	if (!(err instanceof GhError)) return null;
	return { error: err.message, status: err.kind === 'auth' ? 401 : err.kind === 'not-found' ? 404 : 502 };
}

app.get('/', (c) => {
	const overview: GuidelinesOverview = {
		global: readGlobalGuidelines(),
		template: GUIDELINES_TEMPLATE,
		maxChars: MAX_GUIDELINES_CHARS,
		path: GUIDELINES_PATH,
		repos: db.repos.list()
			.map((repo) => ({ id: repo.id, name: repo.name, provider: repo.provider }))
			.sort((a, b) => a.name.localeCompare(b.name))
	};
	return c.json(overview);
});

app.put('/global', async (c) => {
	const parsed = contentSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: 'invalid body' }, 400);
	if (normalize(parsed.data.content).length > MAX_GUIDELINES_CHARS) {
		return c.json({ error: `Guidelines are limited to ${MAX_GUIDELINES_CHARS.toLocaleString()} characters.` }, 400);
	}
	try {
		return c.json(writeGlobalGuidelines(parsed.data.content));
	} catch (err) {
		return c.json({ error: err instanceof Error ? err.message : 'Could not save the guidelines.' }, 500);
	}
});

/** The repo's active file (default branch) and any open change to it. */
app.get('/repos/:id', async (c) => {
	const repo = db.repos.get(c.req.param('id'));
	if (!repo) return c.json({ error: 'repo not found' }, 404);
	const host = repoFileHost(repo);
	try {
		const head = await host.defaultBranch();
		const [file, pending] = await Promise.all([
			host.readFile(GUIDELINES_PATH, head.branch),
			host.findPending(BRANCH_PREFIX).catch(() => null)
		]);
		const pendingFile = pending ? await host.readFile(GUIDELINES_PATH, pending.branch).catch(() => null) : null;
		const body: RepoGuidelines = {
			repoId: repo.id,
			path: GUIDELINES_PATH,
			ref: head.branch,
			sha: head.sha || null,
			content: file?.content ?? null,
			pending: pending ? { ...pending, content: pendingFile?.content ?? null } : null,
			canPropose: host.canWrite()
		};
		return c.json(body);
	} catch (err) {
		const mapped = providerError(err);
		if (mapped) return c.json({ error: mapped.error }, mapped.status);
		throw err;
	}
});

/** Open a pull/merge request with the file, or push to the pending one. */
app.post('/repos/:id/propose', async (c) => {
	const repo = db.repos.get(c.req.param('id'));
	if (!repo) return c.json({ error: 'repo not found' }, 404);
	const parsed = contentSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: 'invalid body' }, 400);
	const content = normalize(parsed.data.content);
	if (content.length > MAX_GUIDELINES_CHARS) return c.json({ error: `Guidelines are limited to ${MAX_GUIDELINES_CHARS.toLocaleString()} characters.` }, 400);
	const host = repoFileHost(repo);
	if (!host.canWrite()) return c.json({ error: `Connect a ${repo.provider === 'gitlab' ? 'GitLab' : 'GitHub'} token with write access in Settings → Connections to open a pull request.` }, 401);
	try {
		const pending = await host.findPending(BRANCH_PREFIX);
		const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
		const result = await host.propose({
			path: GUIDELINES_PATH,
			content,
			branch: `${BRANCH_PREFIX}${stamp}`,
			pending,
			commitMessage: pending ? 'Update Recoder review guidelines' : 'Add Recoder review guidelines',
			title: 'Update Recoder review guidelines',
			body: [
				`Updates \`${GUIDELINES_PATH}\`, the review guidelines Recoder follows for this repository.`,
				'',
				'Recoder reads this file from the base branch of each pull request, so these rules apply to pull requests opened after this one merges.',
				'',
				'_Opened from Recoder._'
			].join('\n')
		});
		const body: GuidelinesProposal = { ...result, updated: !!pending };
		return c.json(body);
	} catch (err) {
		const mapped = providerError(err);
		if (mapped) return c.json({ error: mapped.error }, mapped.status);
		throw err;
	}
});

/** Draft or revise guidelines with the orchestrator model, streamed as SSE tokens. */
app.post('/draft', async (c) => {
	const parsed = draftSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: 'invalid body' }, 400);
	if (!isReviewConfigured()) return c.json({ error: 'Add a reviewer model in Settings → Models first.' }, 409);
	const repo = parsed.data.scope === 'repo' && parsed.data.repoId ? db.repos.get(parsed.data.repoId) ?? null : null;
	if (parsed.data.scope === 'repo' && !repo) return c.json({ error: 'repo not found' }, 404);
	const reviews = db.reviews.list().filter((review) => !repo || review.repoId === repo.id);
	const signal = c.req.raw.signal;
	const stream = new ReadableStream({
		async start(controller) {
			const send = (data: unknown) => controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
			try {
				const text = await streamGuidelinesDraft(parsed.data, { repo, host: repo ? repoFileHost(repo) : null, reviews }, (token) => send({ type: 'token', text: token }), signal);
				send({ type: 'done', text });
			} catch (err) {
				send({ type: 'error', error: err instanceof LlmError || err instanceof GhError ? err.message : 'The orchestrator did not respond.' });
			} finally {
				controller.close();
			}
		}
	});
	return new Response(stream, {
		headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }
	});
});

export default app;
