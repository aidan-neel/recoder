import { expect, test } from 'bun:test';
import { emptyTokenUsage, type ModelCallRow, type ModelCost, type TokenUsage, type UsageModel } from '@recoder/shared';
import type { PriceLookup } from '../../src/models/model-prices';
import { buildUsageReport, type UsageIdentity, type UsageInput } from '../../src/usage/usage-report';

const NOW = new Date('2026-11-13T15:00:00.000Z');

const OPUS_PRICE: ModelCost = { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 };
const NO_CACHE_PRICE: ModelCost = { input: 1, output: 2, cacheRead: null, cacheWrite: null };

/** Prices `opus` fully and `glm` without cache prices; every other model is unpriced. */
const priceOf: PriceLookup = (model) => ({ opus: OPUS_PRICE, glm: NO_CACHE_PRICE })[model] ?? null;

const admin: UsageIdentity = { accountId: 'owner', role: 'admin', provider: 'github', host: null, login: 'octocat' };

const member: UsageIdentity = {
	accountId: 'member:github::hubot',
	role: 'member',
	provider: 'github',
	host: null,
	login: 'hubot',
	avatarUrl: 'https://avatars.test/hubot'
};

const idle: UsageIdentity = {
	accountId: 'member:github::idle',
	role: 'member',
	provider: 'github',
	host: null,
	login: 'idle'
};

/** The pieces of a call that vary in the report's eyes; `session` gives it an owner and a person. */
function call(model: string, usage: Partial<TokenUsage>, at?: string): Partial<ModelCallRow> & { model: string } {
	return {
		model,
		usage: { ...emptyTokenUsage(), ...usage },
		...(at ? { at } : {})
	};
}

/** The calls of one review or repository chat: `id` is their owner and `startedBy` their person. */
function session(
	id: string,
	startedBy: string | undefined,
	calls: (Partial<ModelCallRow> & { model: string })[],
	kind: 'review' | 'chat' = 'review'
): ModelCallRow[] {
	return calls.map((partial) => ({
		id: crypto.randomUUID(),
		at: '2026-11-13T10:00:00.000Z',
		person: startedBy ?? null,
		kind,
		ownerId: id,
		provider: 'openai-compatible',
		usage: emptyTokenUsage(),
		outcome: 'ok',
		...partial
	}));
}

/** A call outside any review or chat: no person, no owner. */
function otherCall(model: string, usage: Partial<TokenUsage>, overrides: Partial<ModelCallRow> = {}): ModelCallRow {
	return {
		id: crypto.randomUUID(),
		at: '2026-11-13T10:00:00.000Z',
		person: null,
		kind: 'other',
		ownerId: null,
		provider: 'openai-compatible',
		model,
		usage: { ...emptyTokenUsage(), ...usage },
		outcome: 'ok',
		...overrides
	};
}

function report(calls: ModelCallRow[], overrides: Partial<UsageInput> = {}) {
	return buildUsageReport({ days: 7, now: NOW, calls, people: [admin, member, idle], priceOf, ...overrides });
}

test('the window has one zero-filled UTC day for each of its days, oldest first, ending today', () => {
	const { daily, from, to } = report(session('a', 'owner', [call('opus', { inputTokens: 100, outputTokens: 10 })]));

	expect(daily.map((day) => day.day)).toEqual([
		'2026-11-07',
		'2026-11-08',
		'2026-11-09',
		'2026-11-10',
		'2026-11-11',
		'2026-11-12',
		'2026-11-13'
	]);

	expect([from, to]).toEqual(['2026-11-07', '2026-11-13']);
	expect(daily.map((day) => day.tokens)).toEqual([0, 0, 0, 0, 0, 0, 110]);
	expect(daily[6].byPerson).toEqual({ owner: 110 });
});

test('a call counts on the day it started, and calls outside the window are left out', () => {
	const { daily, totals } = report(
		session('a', 'owner', [
			call('opus', { inputTokens: 10, outputTokens: 0 }, '2026-11-09T23:59:59.000Z'),
			call('opus', { inputTokens: 20, outputTokens: 0 }, '2026-11-06T23:59:59.000Z'),
			call('opus', { inputTokens: 40, outputTokens: 0 }, '2026-11-14T00:00:00.000Z')
		])
	);

	expect(daily.find((day) => day.day === '2026-11-09')?.tokens).toBe(10);
	expect(totals.tokens).toBe(10);
});

test('each day splits tokens by model and by person and model, and a zero-token call adds no entry', () => {
	const { daily } = report([
		...session('a', 'owner', [
			call('opus', { inputTokens: 60, outputTokens: 40 }),
			call('glm', { inputTokens: 30, outputTokens: 0 }),
			call('opus', { inputTokens: 0, outputTokens: 0 })
		]),
		...session('b', member.accountId, [call('glm', { inputTokens: 10, outputTokens: 10 })])
	]);

	expect(daily[6]).toMatchObject({
		tokens: 150,
		byPerson: { owner: 130, 'member:github::hubot': 20 },
		byModel: { opus: 100, glm: 50 },
		byPersonModel: { owner: { opus: 100, glm: 30 }, 'member:github::hubot': { glm: 20 } }
	});

	expect(daily[5]).toEqual({ day: '2026-11-12', tokens: 0, byPerson: {}, byModel: {}, byPersonModel: {} });
});

test('tokens are split per person, with people who used nothing listed last and shares adding to one', () => {
	const { people } = report([
		...session('a', 'owner', [call('opus', { inputTokens: 300, outputTokens: 100 })]),
		...session('b', member.accountId, [call('opus', { inputTokens: 80, outputTokens: 20 })])
	]);

	expect(people.map((person) => [person.login, person.tokens, person.share, person.sessions])).toEqual([
		['octocat', 400, 0.8, 1],
		['hubot', 100, 0.2, 1],
		['idle', 0, 0, 0]
	]);

	expect(people[1]).toMatchObject({ role: 'member', avatarUrl: 'https://avatars.test/hubot', costComplete: true });
	expect(people[2]).toMatchObject({ costUsd: 0, costComplete: true });
});

test('a call recorded with no person counts for the admin', () => {
	const { people, daily } = report(session('old', undefined, [call('opus', { inputTokens: 50, outputTokens: 50 })]));

	expect(people[0]).toMatchObject({ accountId: 'owner', tokens: 100, sessions: 1 });
	expect(daily[6].byPerson).toEqual({ owner: 100 });
});

test('a removed member’s calls still show under the login their account id names', () => {
	const gone = 'member:gitlab:git.example.com:8443:ghost';

	const { people } = report(session('a', gone, [call('opus', { inputTokens: 10, outputTokens: 10 })]), {
		people: [admin]
	});

	expect(people.find((person) => person.accountId === gone)).toMatchObject({
		role: 'member',
		provider: 'gitlab',
		host: 'git.example.com:8443',
		login: 'ghost',
		tokens: 20
	});
});

test('each person lists the models their calls used, most tokens first, each sharing the person’s tokens', () => {
	const { people } = report([
		...session('a', 'owner', [
			call('opus', { inputTokens: 300, outputTokens: 0 }),
			call('glm', { inputTokens: 100, outputTokens: 0 })
		]),
		...session('b', member.accountId, [call('glm', { inputTokens: 50, outputTokens: 50 })])
	]);

	expect(people[0].models.map((model) => [model.model, model.tokens, model.share])).toEqual([
		['opus', 300, 0.75],
		['glm', 100, 0.25]
	]);

	expect(people[1].models.map((model) => [model.model, model.tokens, model.share])).toEqual([['glm', 100, 1]]);
});

test('a person with no calls lists no models', () => {
	const { people } = report(session('a', 'owner', [call('opus', { inputTokens: 10, outputTokens: 10 })]));

	expect(people.find((person) => person.accountId === idle.accountId)?.models).toEqual([]);
});

test('models are grouped by provider and id, most tokens first, with their share', () => {
	const { models } = report(
		session('a', 'owner', [
			call('opus', { inputTokens: 100, outputTokens: 100 }),
			call('opus', { inputTokens: 100, outputTokens: 100 }),
			call('glm', { inputTokens: 100, outputTokens: 0 })
		])
	);

	expect(models.map((model) => [model.model, model.tokens, model.share])).toEqual([
		['opus', 400, 0.8],
		['glm', 100, 0.2]
	]);
});

test('a person’s model totals add up to the person’s own totals, cost rules included', () => {
	const { people } = report([
		...session('a', 'owner', [
			call('opus', {
				inputTokens: 1_000_000,
				cachedInputTokens: 600_000,
				cacheWriteInputTokens: 100_000,
				outputTokens: 100_000
			})
		]),
		...session('b', 'owner', [call('glm', { inputTokens: 500, cachedInputTokens: 100, outputTokens: 50 })])
	]);

	const [octocat] = people;
	const sum = (pick: (model: UsageModel) => number) => octocat.models.reduce((total, model) => total + pick(model), 0);

	expect(sum((model) => model.tokens)).toBe(octocat.tokens);
	expect(sum((model) => model.input)).toBe(octocat.input);
	expect(sum((model) => model.cacheRead)).toBe(octocat.cacheRead);
	expect(sum((model) => model.cacheWrite)).toBe(octocat.cacheWrite);
	expect(sum((model) => model.output)).toBe(octocat.output);
	expect(sum((model) => model.sessions)).toBe(octocat.sessions);
	expect(sum((model) => model.costUsd ?? 0)).toBeCloseTo(octocat.costUsd ?? 0, 6);

	expect(octocat.costComplete).toBe(false);
	expect(octocat.models.find((model) => model.model === 'glm')).toMatchObject({ costUsd: null, costComplete: false });
});

/** 300k uncached at 15, 600k read at 1.5, 100k written at 18.75 and 100k output at 75, per million. */
test('cost counts uncached input, cache reads, cache writes and output each at their own price', () => {
	const { totals } = report(
		session('a', 'owner', [
			call('opus', {
				inputTokens: 1_000_000,
				cachedInputTokens: 600_000,
				cacheWriteInputTokens: 100_000,
				outputTokens: 100_000
			})
		])
	);

	expect(totals.costUsd).toBeCloseTo(4.5 + 0.9 + 1.875 + 7.5, 6);
	expect(totals.costComplete).toBe(true);
	expect(totals.tokens).toBe(1_100_000);
	expect(totals).toMatchObject({ input: 1_000_000, cacheRead: 600_000, cacheWrite: 100_000, output: 100_000 });
});

test('cache savings are what the cache reads would have cost at the input price, less what they cost', () => {
	const { totals } = report(
		session('a', 'owner', [call('opus', { inputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 0 })])
	);

	expect(totals.cacheSavingsUsd).toBeCloseTo(15 - 1.5, 6);
});

test('cache savings are null when no call with cache reads has both prices', () => {
	const { totals } = report(
		session('a', 'owner', [call('glm', { inputTokens: 1000, cachedInputTokens: 500, outputTokens: 0 })])
	);

	expect(totals.cacheSavingsUsd).toBeNull();
});

test('a model with no price has no cost, and a group of only such calls reports null', () => {
	const { totals, models } = report(
		session('a', 'owner', [call('mystery', { inputTokens: 1000, outputTokens: 1000 })])
	);

	expect(totals).toMatchObject({ costUsd: null, costComplete: false, tokens: 2000 });
	expect(models[0]).toMatchObject({ model: 'mystery', costUsd: null, costComplete: false });
});

test('a group mixing priced and unpriced calls sums the priced ones and says it is incomplete', () => {
	const { totals } = report(
		session('a', 'owner', [
			call('opus', { inputTokens: 1_000_000, outputTokens: 0 }),
			call('mystery', { inputTokens: 1_000_000, outputTokens: 0 })
		])
	);

	expect(totals.costUsd).toBeCloseTo(15, 6);
	expect(totals.costComplete).toBe(false);
});

test('a call that used cache tokens the model has no price for has no cost', () => {
	const { totals } = report(
		session('a', 'owner', [call('glm', { inputTokens: 1000, cachedInputTokens: 400, outputTokens: 10 })])
	);

	expect(totals).toMatchObject({ costUsd: null, costComplete: false });
});

test('a session counts once for each group however many calls it made', () => {
	const { totals, models } = report([
		...session('a', 'owner', [
			call('opus', { inputTokens: 1, outputTokens: 1 }),
			call('opus', { inputTokens: 1, outputTokens: 1 })
		]),
		...session('b', 'owner', [call('glm', { inputTokens: 1, outputTokens: 1 })])
	]);

	expect(totals.sessions).toBe(2);

	expect(models.map((model) => [model.model, model.sessions])).toEqual([
		['opus', 1],
		['glm', 1]
	]);
});

test('a call outside a review or chat counts as other, under the admin, as no session', () => {
	const { totals, kinds, people } = report([otherCall('opus', { inputTokens: 100, outputTokens: 50 })]);

	expect(totals).toMatchObject({ tokens: 150, sessions: 0, calls: 1 });
	expect(people[0]).toMatchObject({ accountId: 'owner', tokens: 150 });
	expect(kinds.map((entry) => entry.kind)).toEqual(['review', 'chat', 'other']);
	expect(kinds[2]).toMatchObject({ tokens: 150, calls: 1, sessions: 0 });
	expect(kinds[0]).toMatchObject({ tokens: 0, calls: 0 });
});

test('each call kind totals its own calls, and a kind with none is all zero', () => {
	const { kinds } = report([
		...session('a', 'owner', [call('opus', { inputTokens: 100, outputTokens: 50 })]),
		...session('b', member.accountId, [call('glm', { inputTokens: 20, outputTokens: 10 })], 'chat'),
		otherCall('opus', { inputTokens: 30, outputTokens: 10 })
	]);

	expect(kinds.map((entry) => [entry.kind, entry.tokens, entry.calls, entry.sessions])).toEqual([
		['review', 150, 1, 1],
		['chat', 30, 1, 1],
		['other', 40, 1, 0]
	]);
});

test('call counts, failed counts and median durations land per person and per model', () => {
	const { totals, people, models } = report(
		session('a', 'owner', [
			call('opus', { inputTokens: 10, outputTokens: 5 }, '2026-11-13T10:00:00.000Z'),
			{
				model: 'opus',
				usage: { ...emptyTokenUsage(), inputTokens: 5 },
				outcome: 'failed' as const,
				durationMs: 4_000
			},
			call('opus', { inputTokens: 20, outputTokens: 5 })
		])
	);

	expect(totals).toMatchObject({ calls: 3, failedCalls: 1 });

	expect(people[0]).toMatchObject({ calls: 3, failedCalls: 1 });
	expect(models[0]).toMatchObject({ calls: 3, failedCalls: 1 });
});

test('median duration is the middle of the calls that recorded one, null when none did', () => {
	const { totals } = report(
		session('a', 'owner', [
			{ model: 'opus', usage: emptyTokenUsage(), durationMs: 1_000 },
			{ model: 'opus', usage: emptyTokenUsage(), durationMs: 9_000 },
			{ model: 'opus', usage: emptyTokenUsage(), durationMs: 3_000 },
			call('opus', { inputTokens: 10 })
		])
	);

	expect(totals.medianDurationMs).toBe(3_000);
	expect(report(session('b', 'owner', [call('opus', { inputTokens: 1 })])).totals.medianDurationMs).toBeNull();
});
