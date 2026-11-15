import { afterEach, expect, test } from 'bun:test';
import { pathToFileURL } from 'node:url';
import { ORCHESTRATOR_ID, emptyReviewProgress, type Repo } from '@recoder/shared';
import { ReviewChatError, startReviewChat } from '../../../src/review/chat/review-chat';
import { attachedReviewSkills } from '../../../src/review/chat/chat-skills';
import { waitReviewChat } from '../../../src/review/chat/chat-replies';
import { clearReviewEvents } from '../../../src/review/session/events';
import { getStoredSettings, setReviewOverrides } from '../../../src/review/session/review-settings';
import { db, reviewProgress } from '../../../src/store';
import { commitAll, git, useCommittedRepos, writeTree } from '../../helpers/git';
import { testReview } from '../../helpers/review';

const originalFetch = globalThis.fetch;
const originalSettings = getStoredSettings();
const committed = useCommittedRepos('recoder-ask-skills-');
const reviewIds: string[] = [];

afterEach(async () => {
	globalThis.fetch = originalFetch;
	setReviewOverrides(originalSettings);
	await db.repos.clear();

	for (const id of reviewIds.splice(0)) {
		await db.reviews.delete(id);
		await clearReviewEvents(id);
	}
});

function skill(name: string, body: string): string {
	return `---\nname: ${name}\n---\n${body}\n`;
}

/** A tracked repo whose main has `base`, and a review whose head commit adds `head-only` and changes `shared`. */
async function reviewWithHeadSkills() {
	const root = await committed({
		'.agents/skills/base/SKILL.md': skill('base', 'base text'),
		'.agents/skills/shared/SKILL.md': skill('shared', 'main text')
	});

	git(root, ['branch', '-M', 'main']);
	git(root, ['checkout', '-q', '-b', 'feature']);

	await writeTree(root, {
		'.agents/skills/head-only/SKILL.md': skill('head-only', 'head-only text'),
		'.agents/skills/shared/SKILL.md': skill('shared', 'feature text')
	});

	commitAll(root, 'feature');

	const headSha = git(root, ['rev-parse', 'HEAD']);

	git(root, ['checkout', '-q', 'main']);

	const at = new Date().toISOString();

	const repo: Repo = await db.repos.set({
		id: crypto.randomUUID(),
		name: 'acme/shop',
		url: pathToFileURL(root).href,
		provider: 'local',
		defaultBranch: 'main',
		createdAt: at,
		updatedAt: at
	});

	const review = testReview({ repoId: repo.id, headSha, source: 'local', status: 'passed' });

	reviewIds.push(review.id);
	await db.reviews.set(review);
	await reviewProgress.set(emptyReviewProgress(review.id));

	return review;
}

test('skills attached to an Ask message are read at the review head, then at the default branch', async () => {
	const review = await reviewWithHeadSkills();
	const loaded = await attachedReviewSkills(review, { attached: ['shared', 'head-only', 'base'], mentioned: [] });

	expect(loaded.map((item) => item.name)).toEqual(['shared', 'head-only', 'base']);
	expect(loaded[0].text).toContain('feature text');
	expect(loaded[1].text).toContain('head-only text');
	expect(loaded[2].text).toContain('base text');
});

test('an Ask message with a skill the repository lacks is refused with 400 naming it, and the chat stays free', async () => {
	const review = await reviewWithHeadSkills();

	const refused = startReviewChat(review.id, ORCHESTRATOR_ID, 'Use this', { skills: ['shared', 'ghost'] });

	await expect(refused).rejects.toBeInstanceOf(ReviewChatError);
	await expect(refused).rejects.toMatchObject({ status: 400, message: expect.stringContaining('"ghost"') });

	setReviewOverrides({
		baseUrl: 'http://model.test/v1',
		apiKey: 'test',
		models: [{ id: 'lead', label: 'Lead', model: 'lead' }],
		orchestratorModelId: 'lead'
	});

	const bodies: string[] = [];

	globalThis.fetch = (async (_url, init) => {
		bodies.push(init?.body as string);

		return Response.json({ choices: [{ message: { content: 'Noted.' } }] });
	}) as typeof fetch;

	const sent = await startReviewChat(review.id, ORCHESTRATOR_ID, 'Use this', { skills: ['shared'] });

	await waitReviewChat(review.id, ORCHESTRATOR_ID);
	expect(sent.skills).toEqual(['shared']);
	expect(bodies[0]).toContain('feature text');
});
