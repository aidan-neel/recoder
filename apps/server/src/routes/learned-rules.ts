import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { LearnedRuleDecision, Repo } from '@recoder/shared';
import { decideProposal, listProposals } from '../review/guidelines/learned/proposals';
import { db } from '../store';
import { parseBody } from './parse-body';

const app = new Hono();

const decisionSchema: z.ZodType<LearnedRuleDecision> = z.object({ state: z.enum(['approved', 'rejected']) });

/** The `:repoId` repository, or the 404 that ends the request. */
async function requireRepo(c: Context): Promise<Repo | Response> {
	return (await db.repos.get(c.req.param('repoId') ?? '')) ?? c.json({ error: 'repo not found' }, 404);
}

/** The repository's learned-rule proposals, newest first, in every state. */
app.get('/:repoId/learned-rules', async (c) => {
	const repo = await requireRepo(c);

	if (repo instanceof Response) return repo;

	return c.json(listProposals(repo.id));
});

/**
 * Approve or reject a learned rule. Only an approved rule applies: later
 * reviews of the repository quiet its topic's findings. Answers the proposal
 * as saved.
 */
app.put('/:repoId/learned-rules/:topicId', async (c) => {
	const body = await parseBody(c, decisionSchema);

	if (body instanceof Response) return body;

	const repo = await requireRepo(c);

	if (repo instanceof Response) return repo;

	const decided = decideProposal(repo.id, c.req.param('topicId'), body.state);

	return decided ? c.json(decided) : c.json({ error: 'learned rule not found' }, 404);
});

export default app;
