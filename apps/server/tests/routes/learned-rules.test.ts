import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LearnedRuleProposal } from '@recoder/shared';
import { proposeQuieting } from '../../src/review/guidelines/learned/proposals';
import { topicTallies } from '../../src/review/guidelines/learned/votes';
import { db } from '../../src/store';
import { send } from './reviews/finding-requests';

const TOPIC = 'smell:magic-value';
const REPO = 'learned-rules-repo';

beforeEach(async () => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-learned-rules-'));

	const now = new Date().toISOString();

	await db.repos.set({
		id: REPO,
		name: 'fixture',
		url: 'https://example.invalid/repo',
		provider: 'github',
		defaultBranch: 'main',
		createdAt: now,
		updatedAt: now
	});
});

const rulesPath = (topicId?: string) =>
	`/api/repos/${REPO}/learned-rules${topicId ? `/${encodeURIComponent(topicId)}` : ''}`;

test('a proposed rule is listed for its repository and applies only once a person approves it', async () => {
	proposeQuieting(REPO, { id: TOPIC, label: 'Magic value' }, { dismissed: 3, useful: 0 });

	expect(await (await send(rulesPath(), 'GET')).json()).toMatchObject([{ topic: { id: TOPIC }, state: 'proposed' }]);
	expect(topicTallies(REPO).get(TOPIC)?.quietApproved).toBeUndefined();

	const approved = (await (await send(rulesPath(TOPIC), 'PUT', { state: 'approved' })).json()) as LearnedRuleProposal;

	expect(approved).toMatchObject({ state: 'approved', votes: { dismissed: 3 } });
	expect(topicTallies(REPO).get(TOPIC)?.quietApproved).toBe(true);
});

test('a rejected rule never applies and is not proposed again by later dismissals', async () => {
	proposeQuieting(REPO, { id: TOPIC, label: 'Magic value' }, { dismissed: 3, useful: 0 });
	await send(rulesPath(TOPIC), 'PUT', { state: 'rejected' });
	proposeQuieting(REPO, { id: TOPIC, label: 'Magic value' }, { dismissed: 5, useful: 0 });

	expect(await (await send(rulesPath(), 'GET')).json()).toMatchObject([{ state: 'rejected', votes: { dismissed: 3 } }]);
	expect(topicTallies(REPO).get(TOPIC)?.quietApproved).toBeUndefined();
});

test('an unknown repository or rule is a 404, and a decision must be approve or reject', async () => {
	expect((await send('/api/repos/missing/learned-rules', 'GET')).status).toBe(404);
	expect((await send(rulesPath(TOPIC), 'PUT', { state: 'approved' })).status).toBe(404);
	expect((await send(rulesPath(TOPIC), 'PUT', { state: 'proposed' })).status).toBe(400);
});
