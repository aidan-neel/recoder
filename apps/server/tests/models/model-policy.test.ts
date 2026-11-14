import { afterEach, describe, expect, test } from 'bun:test';
import type { ModelPolicy } from '@recoder/shared';
import { configForOrchestrator, configForSubagent } from '../../src/models/models';
import {
	appliedModels,
	hiddenPickProblem,
	saveMemberPicks,
	withReviewModels,
	withStarterModels
} from '../../src/models/model-policy';
import { setReviewOverrides } from '../../src/review/session/review-settings';
import { collection } from '../../src/storage/backend';
import { db } from '../../src/store';
import { testReview } from '../helpers/review';
import { useTempStore } from '../helpers/temp-store';

const { track } = useTempStore('recoder-model-policy-');

const MEMBER = 'member:github::hubot';

const entry = (id: string) => ({
	id,
	label: id,
	model: id,
	provider: 'openai-compatible' as const,
	baseUrl: 'http://localhost:8000/v1',
	efforts: ['low', 'medium', 'high'] as ('low' | 'medium' | 'high')[]
});

const models = ['sol', 'mini', 'judge'].map(entry);

/** The admin runs `sol` for Review and `mini` for Subagent. */
function adminPicks(modelPolicy?: ModelPolicy): void {
	setReviewOverrides({
		models,
		orchestratorModelId: 'sol',
		orchestratorEffort: 'low',
		specialistModelId: 'mini',
		specialistEffort: 'high',
		...(modelPolicy ? { modelPolicy } : {})
	});
}

const reviewAndSubagent = () => [configForOrchestrator().model, configForSubagent().model];

afterEach(async () => {
	setReviewOverrides({});
	await db.reviews.clear();
	await collection('member_models').clear();
});

describe('the models a run resolves to', () => {
	test('the admin’s runs use the settings', async () => {
		adminPicks({
			kind: 'enforced',
			orchestratorModelId: 'judge',
			orchestratorEffort: null,
			specialistModelId: null,
			specialistEffort: null
		});

		expect(await withStarterModels('owner', reviewAndSubagent)).toEqual(['sol', 'mini']);
		expect(await withStarterModels(undefined, reviewAndSubagent)).toEqual(['sol', 'mini']);
	});

	test('a member with no picks follows the settings', async () => {
		adminPicks();

		expect(await withStarterModels(MEMBER, reviewAndSubagent)).toEqual(['sol', 'mini']);
		expect(await appliedModels(MEMBER)).toMatchObject({ orchestratorModelId: 'sol', enforced: false });
	});

	test('a member’s own picks replace the settings, and their effort goes with them', async () => {
		adminPicks();

		await saveMemberPicks(MEMBER, {
			orchestratorModelId: 'judge',
			orchestratorEffort: 'medium',
			specialistModelId: null
		});

		expect(await withStarterModels(MEMBER, reviewAndSubagent)).toEqual(['judge', 'judge']);
		expect(await withStarterModels(MEMBER, () => configForOrchestrator().reasoningEffort)).toBe('medium');
		expect(await withStarterModels('owner', reviewAndSubagent)).toEqual(['sol', 'mini']);
	});

	test('the enforced policy wins over a member’s own picks, and the admin keeps the settings', async () => {
		adminPicks();
		await saveMemberPicks(MEMBER, { orchestratorModelId: 'judge' });

		adminPicks({
			kind: 'enforced',
			orchestratorModelId: 'mini',
			orchestratorEffort: 'high',
			specialistModelId: 'mini',
			specialistEffort: 'low'
		});

		expect(await withStarterModels(MEMBER, reviewAndSubagent)).toEqual(['mini', 'mini']);
		expect(await appliedModels(MEMBER)).toMatchObject({ orchestratorModelId: 'mini', enforced: true });
		expect(await withStarterModels('owner', reviewAndSubagent)).toEqual(['sol', 'mini']);
		expect(await appliedModels('owner')).toMatchObject({ orchestratorModelId: 'sol', enforced: false });
	});

	test('a review’s follow-ups run on the models of the account that started it', async () => {
		adminPicks();
		await saveMemberPicks(MEMBER, { orchestratorModelId: 'judge' });

		const started = await db.reviews.set(testReview({ startedBy: MEMBER }));
		const old = await db.reviews.set(testReview());

		track(started.id);
		track(old.id);

		expect(await withReviewModels(started.id, reviewAndSubagent)).toEqual(['judge', 'mini']);
		expect(await withReviewModels(old.id, reviewAndSubagent)).toEqual(['sol', 'mini']);
	});
});

describe('hidden models', () => {
	const hidden = new Set(['judge']);

	test('a hidden model cannot be newly picked', () => {
		const current = {
			orchestratorModelId: 'sol',
			orchestratorEffort: null,
			specialistModelId: null,
			specialistEffort: null
		};

		expect(hiddenPickProblem({ orchestratorModelId: 'judge' }, current, hidden)).toContain('judge');
		expect(hiddenPickProblem({ specialistModelId: 'judge' }, current, hidden)).toContain('judge');
		expect(hiddenPickProblem({ orchestratorModelId: 'mini' }, current, hidden)).toBeNull();
	});

	test('a pick already saved keeps working after it is hidden', () => {
		const current = {
			orchestratorModelId: 'judge',
			orchestratorEffort: null,
			specialistModelId: null,
			specialistEffort: null
		};

		expect(hiddenPickProblem({ orchestratorModelId: 'judge', orchestratorEffort: 'low' }, current, hidden)).toBeNull();
	});
});
