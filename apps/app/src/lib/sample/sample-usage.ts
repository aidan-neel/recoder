import type { UsageDay, UsageDays, UsageModel, UsagePerson, UsageReport, UsageTotals } from '@recoder/shared';

import type { UsageApi } from '../api/usage';

const MS_PER_DAY = 86_400_000;

/** How a model's tokens split by kind, as a share of its processed tokens. */
const CACHE_READ_SHARE = 0.965;
const CACHE_WRITE_SHARE = 0.018;
const OUTPUT_SHARE = 0.004;

/** About how many tokens one model call processes, and the part of calls that fail. */
const TOKENS_PER_CALL = 6000;
const FAILED_CALL_SHARE = 0.02;

/** About how many tokens one session processes. */
const TOKENS_PER_SESSION = 38_000_000;

interface SampleModel {
	model: string;
	provider: string;
	/** USD per million tokens, or null for a model with no known price. */
	pricePerMillion: number | null;
	/** The typical time one call takes, in ms. */
	medianDurationMs: number;
}

const MODELS: readonly SampleModel[] = [
	{ model: 'claude-opus-5-5', provider: 'claude-code', pricePerMillion: 0.31, medianDurationMs: 31000 },
	{ model: 'claude-sonnet-5-5', provider: 'claude-code', pricePerMillion: 0.09, medianDurationMs: 14000 },
	{ model: 'claude-haiku-5-5', provider: 'claude-code', pricePerMillion: 0.03, medianDurationMs: 3200 },
	{ model: 'gpt-5.2', provider: 'codex', pricePerMillion: 0.12, medianDurationMs: 22000 },
	{ model: 'glm-5.2', provider: 'opencode', pricePerMillion: null, medianDurationMs: 38000 }
];

interface SamplePerson {
	accountId: string;
	role: 'admin' | 'member';
	provider: 'github' | 'gitlab';
	host: string | null;
	login: string;
	/** How many tokens a typical day takes, before the day's own swing. */
	dailyTokens: number;
	/** The first day of the window they used anything: someone new to the team has none before it. */
	firstDay: number;
	/** What the person's tokens go to, by model, as weights. */
	mix: readonly (readonly [string, number])[];
}

const PEOPLE: readonly SamplePerson[] = [
	{
		accountId: 'sample',
		role: 'admin',
		provider: 'github',
		host: null,
		login: 'you',
		dailyTokens: 1_350_000_000,
		firstDay: 0,
		mix: [
			['claude-opus-5-5', 7],
			['claude-sonnet-5-5', 2],
			['claude-haiku-5-5', 1]
		]
	},
	{
		accountId: 'sample-mira',
		role: 'member',
		provider: 'github',
		host: null,
		login: 'mira',
		dailyTokens: 780_000_000,
		firstDay: 0,
		mix: [
			['claude-opus-5-5', 5],
			['claude-sonnet-5-5', 3],
			['gpt-5.2', 2]
		]
	},
	{
		accountId: 'sample-tomas',
		role: 'member',
		provider: 'gitlab',
		host: 'git.acme.dev',
		login: 'tomas',
		dailyTokens: 410_000_000,
		firstDay: 0,
		mix: [
			['claude-sonnet-5-5', 4],
			['glm-5.2', 4],
			['claude-haiku-5-5', 2]
		]
	},
	{
		accountId: 'sample-noor',
		role: 'member',
		provider: 'github',
		host: null,
		login: 'noor',
		dailyTokens: 150_000_000,
		firstDay: 9,
		mix: [
			['gpt-5.2', 6],
			['claude-haiku-5-5', 4]
		]
	}
];

/** A repeatable number from 0 to 1 for a person and day, so the sample looks the same on every load. */
function swing(person: number, day: number): number {
	const raw = Math.sin(day * 12.9898 + person * 78.233) * 43758.5453;

	return raw - Math.floor(raw);
}

/** The day nobody used anything, so the chart has a gap to hover. */
const QUIET_DAY = 3;

/** How much of a weekday's work a weekend day sees. */
const WEEKEND_SHARE = 0.16;

const SATURDAY = 6;
const SUNDAY = 0;

/** About how many days one swing of a person's workload takes. */
const SWING_DAYS = 5;

/**
 * Tokens a person processed on the `day`th day of the window, which falls on
 * `date`: a slow swing in their workload, some day-to-day noise, the team's
 * quiet weekends and now and then a spike.
 */
function tokensOn(person: SamplePerson, index: number, day: number, date: number): number {
	if (day === QUIET_DAY || day < person.firstDay) return 0;

	const weekday = new Date(date).getUTCDay();
	const weekend = weekday === SATURDAY || weekday === SUNDAY ? WEEKEND_SHARE : 1;
	const trend = 1 + 0.3 * Math.sin(day / SWING_DAYS + index * 1.7);
	const noise = 0.75 + swing(index, day) * 0.5;
	const spike = (day * 3 + index * 5) % 17 === 4 ? 1.9 : 1;

	return Math.round(person.dailyTokens * trend * noise * weekend * spike);
}

/** One person's tokens on a day split across their models, which each take a different share from day to day. */
function splitByModel(person: SamplePerson, index: number, day: number, tokens: number): Record<string, number> {
	if (tokens === 0) return {};

	const weights = person.mix.map(([, part], position) => part * (0.7 + swing(index * 7 + position, day) * 0.6));
	const weight = weights.reduce((sum, part) => sum + part, 0);

	const split = person.mix.map(
		([model], position) => [model, Math.floor((tokens * weights[position]) / weight)] as const
	);

	const remainder = tokens - split.reduce((sum, [, part]) => sum + part, 0);

	return Object.fromEntries(split.map(([model, part], position) => [model, part + (position === 0 ? remainder : 0)]));
}

function dayLabel(offset: number, from: number): string {
	return new Date(from + offset * MS_PER_DAY).toISOString().slice(0, 10);
}

function tally(
	tokens: number,
	model: SampleModel,
	sessions: number
): Pick<
	UsageTotals,
	| 'tokens'
	| 'input'
	| 'cacheRead'
	| 'cacheWrite'
	| 'output'
	| 'sessions'
	| 'costUsd'
	| 'calls'
	| 'failedCalls'
	| 'medianDurationMs'
> {
	const output = Math.round(tokens * OUTPUT_SHARE);
	const calls = Math.max(1, Math.round(tokens / TOKENS_PER_CALL));

	return {
		tokens,
		input: tokens - output,
		cacheRead: Math.round(tokens * CACHE_READ_SHARE),
		cacheWrite: Math.round(tokens * CACHE_WRITE_SHARE),
		output,
		sessions,
		costUsd: model.pricePerMillion === null ? null : (tokens / 1e6) * model.pricePerMillion,
		calls,
		failedCalls: Math.round(calls * FAILED_CALL_SHARE),
		medianDurationMs: model.medianDurationMs
	};
}

/** Adds up groups of totals; a group with no known cost adds nothing and makes the sum partial. */
function sumTotals(groups: readonly UsageTotals[]): UsageTotals {
	const known = groups.filter((group) => group.costUsd !== null);
	const timed = groups.filter((group) => group.medianDurationMs !== null);
	const timedCalls = timed.reduce((sum, group) => sum + group.calls, 0);

	return {
		tokens: groups.reduce((sum, group) => sum + group.tokens, 0),
		input: groups.reduce((sum, group) => sum + group.input, 0),
		cacheRead: groups.reduce((sum, group) => sum + group.cacheRead, 0),
		cacheWrite: groups.reduce((sum, group) => sum + group.cacheWrite, 0),
		output: groups.reduce((sum, group) => sum + group.output, 0),
		sessions: groups.reduce((sum, group) => sum + group.sessions, 0),
		costUsd: known.length === 0 ? null : known.reduce((sum, group) => sum + (group.costUsd ?? 0), 0),
		costComplete: groups.every((group) => group.costComplete),
		calls: groups.reduce((sum, group) => sum + group.calls, 0),
		failedCalls: groups.reduce((sum, group) => sum + group.failedCalls, 0),
		medianDurationMs:
			timedCalls === 0
				? null
				: Math.round(timed.reduce((sum, group) => sum + (group.medianDurationMs ?? 0) * group.calls, 0) / timedCalls)
	};
}

function modelTotals(model: SampleModel, tokens: number): UsageTotals {
	const sessions = Math.max(1, Math.round(tokens / TOKENS_PER_SESSION));

	return { ...tally(tokens, model, sessions), costComplete: model.pricePerMillion !== null };
}

function sumValues(values: readonly number[]): number {
	return values.reduce((sum, value) => sum + value, 0);
}

/** The window's days, each with its tokens split by person and by model, the way the server reports them. */
function buildDays(days: UsageDays, from: number): UsageDay[] {
	return Array.from({ length: days }, (_, day) => {
		const byPersonModel: UsageDay['byPersonModel'] = {};
		const byModel: Record<string, number> = {};

		PEOPLE.forEach((person, index) => {
			const split = splitByModel(person, index, day, tokensOn(person, index, day, from + day * MS_PER_DAY));

			if (Object.keys(split).length === 0) return;

			byPersonModel[person.accountId] = split;

			for (const [model, tokens] of Object.entries(split)) byModel[model] = (byModel[model] ?? 0) + tokens;
		});

		const byPerson = Object.fromEntries(
			Object.entries(byPersonModel).map(([accountId, split]) => [accountId, sumValues(Object.values(split))])
		);

		return { day: dayLabel(day, from), tokens: sumValues(Object.values(byPerson)), byPerson, byModel, byPersonModel };
	});
}

/** What `tokens` of the model `id` come to, as `share` of `whole` tokens. */
function modelOf(id: string, tokens: number, whole: number): UsageModel {
	const model = MODELS.find((item) => item.model === id) ?? MODELS[0];

	return { model: model.model, provider: model.provider, ...modelTotals(model, tokens), share: tokens / whole };
}

/** The models a person's calls used, most tokens first, each with its share of that person's tokens. */
function personModels(accountId: string, daily: readonly UsageDay[], personTokens: number): UsageModel[] {
	const tokens = new Map<string, number>();

	for (const day of daily) {
		for (const [model, count] of Object.entries(day.byPersonModel[accountId] ?? {})) {
			tokens.set(model, (tokens.get(model) ?? 0) + count);
		}
	}

	return [...tokens].map(([model, count]) => modelOf(model, count, personTokens)).sort((a, b) => b.tokens - a.tokens);
}

/** The cache's saving: what the cache reads would have cost at the input price (taken as 10 times the cache price). */
function cacheSavings(totals: UsageTotals): number | null {
	return totals.costUsd === null ? null : totals.costUsd * 6.5;
}

/** How the sample's work splits by kind: the part of tokens each takes and how long its calls take against all calls. */
const KIND_MIX = [
	{ kind: 'review', share: 0.72, duration: 1.15 },
	{ kind: 'chat', share: 0.27, duration: 0.55 },
	{ kind: 'other', share: 0.01, duration: 0.1 }
] as const;

/** The part `share` of `totals`: its counts scaled, its calls taking `duration` times as long. */
function kindTotals(totals: UsageTotals, share: number, duration: number): UsageTotals {
	const scale = (value: number) => Math.round(value * share);

	return {
		tokens: scale(totals.tokens),
		input: scale(totals.input),
		cacheRead: scale(totals.cacheRead),
		cacheWrite: scale(totals.cacheWrite),
		output: scale(totals.output),
		sessions: scale(totals.sessions),
		costUsd: totals.costUsd === null ? null : totals.costUsd * share,
		costComplete: totals.costComplete,
		calls: scale(totals.calls),
		failedCalls: scale(totals.failedCalls),
		medianDurationMs: totals.medianDurationMs === null ? null : Math.round(totals.medianDurationMs * duration)
	};
}

/** A report built from fixed people and models over `days`, ending today, the same on every load. */
export function sampleUsageReport(days: UsageDays, now = Date.now()): UsageReport {
	const from = now - (days - 1) * MS_PER_DAY;
	const daily = buildDays(days, from);
	const grand = sumValues(daily.map((day) => day.tokens));

	const people: UsagePerson[] = PEOPLE.map((person) => {
		const tokens = sumValues(daily.map((day) => day.byPerson[person.accountId] ?? 0));
		const models = personModels(person.accountId, daily, tokens);
		const { accountId, role, provider, host, login } = person;

		return { accountId, role, provider, host, login, ...sumTotals(models), share: tokens / grand, models };
	});

	const models: UsageModel[] = MODELS.map((model) =>
		modelOf(model.model, sumValues(daily.map((day) => day.byModel[model.model] ?? 0)), grand)
	)
		.filter((model) => model.tokens > 0)
		.sort((a, b) => b.tokens - a.tokens);

	const totals = sumTotals(models);

	return {
		days,
		from: dayLabel(0, from),
		to: dayLabel(days - 1, from),
		totals: { ...totals, cacheSavingsUsd: cacheSavings(totals) },
		people: people.sort((a, b) => b.tokens - a.tokens),
		models,
		kinds: KIND_MIX.map(({ kind, share, duration }) => ({ kind, ...kindTotals(totals, share, duration) })),
		daily
	};
}

/** The sample's usage report; it answers at once, as the server does for a small window. */
export function createSampleUsage(): UsageApi {
	return { report: async (days) => sampleUsageReport(days) };
}
