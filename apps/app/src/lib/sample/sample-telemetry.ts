import type {
	Provider,
	ReportPerson,
	TelemetryDay,
	TelemetryPerson,
	TelemetryRepo,
	TelemetryReport,
	TelemetryTotals,
	UsageDays
} from '@recoder/shared';

import type { TelemetryApi } from '../api/telemetry';

const DAY_MS = 86_400_000;

interface SampleRepoSpec {
	repoId: string;
	name: string;
	provider: Provider;
	tokensPerReview: number;
}

const SAMPLE_REPOS: readonly SampleRepoSpec[] = [
	{ repoId: 'repo-core', name: 'recoder/recoder', provider: 'github', tokensPerReview: 214_000 },
	{ repoId: 'repo-sdk', name: 'recoder/sdk', provider: 'github', tokensPerReview: 148_000 },
	{ repoId: 'repo-gateway', name: 'acme/gateway', provider: 'gitlab', tokensPerReview: 192_000 },
	{ repoId: 'repo-billing', name: 'acme/billing', provider: 'github', tokensPerReview: 165_000 }
];

interface SamplePersonSpec extends ReportPerson {
	rate: number;
	startDay: number;
	repos: readonly string[];
}

const SAMPLE_PEOPLE: readonly SamplePersonSpec[] = [
	{
		accountId: 'sample',
		role: 'admin',
		provider: 'github',
		host: null,
		login: 'you',
		rate: 2.2,
		startDay: 0,
		repos: ['repo-core', 'repo-sdk', 'repo-billing']
	},
	{
		accountId: 'sample-mira',
		role: 'member',
		provider: 'github',
		host: null,
		login: 'mira',
		rate: 1.5,
		startDay: 0,
		repos: ['repo-core', 'repo-gateway']
	},
	{
		accountId: 'sample-tomas',
		role: 'member',
		provider: 'gitlab',
		host: 'git.acme.dev',
		login: 'tomas',
		rate: 0.95,
		startDay: 0,
		repos: ['repo-gateway', 'repo-billing']
	},
	{
		accountId: 'sample-noor',
		role: 'member',
		provider: 'github',
		host: null,
		login: 'noor',
		rate: 0.65,
		startDay: 6,
		repos: ['repo-sdk', 'repo-core']
	}
];

function pulse(seed: number, step: number): number {
	const wave = Math.sin(step * 9.173 + seed * 41.89) * 19_483.31;

	return wave - Math.floor(wave);
}

function totalsFromPrs(prsReviewed: number, tokensPerReview: number, seed: number): TelemetryTotals {
	if (prsReviewed === 0) {
		return {
			prsReviewed: 0,
			prsMerged: 0,
			reviews: 0,
			autoReviews: 0,
			findings: 0,
			highFindings: 0,
			mediumFindings: 0,
			lowFindings: 0,
			findingsAccepted: 0,
			findingsDismissed: 0,
			findingsBlocking: 0,
			findingsResolved: 0,
			findingsPosted: 0,
			reviewTokens: 0,
			avgTokensPerReview: null
		};
	}

	const reviews = Math.max(prsReviewed, Math.round(prsReviewed * (1.32 + (seed % 3) * 0.08)));
	const autoReviews = Math.round(reviews * 0.58);
	const prsMerged = Math.min(prsReviewed, Math.round(prsReviewed * 0.78));
	const findings = Math.max(1, Math.round(prsReviewed * 1.85));
	const highFindings = Math.round(findings * 0.24);
	const mediumFindings = Math.round(findings * 0.49);
	const lowFindings = Math.max(0, findings - highFindings - mediumFindings);
	const findingsAccepted = Math.round(findings * 0.66);
	const findingsDismissed = Math.min(findings - findingsAccepted, Math.round(findings * 0.16));
	const findingsBlocking = Math.min(findings - findingsDismissed, highFindings + Math.round(mediumFindings * 0.45));
	const findingsResolved = Math.min(findings, Math.round(findingsAccepted * 0.76));
	const findingsPosted = Math.min(findings, Math.round(findings * 0.82));
	const reviewTokens = reviews * tokensPerReview;

	return {
		prsReviewed,
		prsMerged,
		reviews,
		autoReviews,
		findings,
		highFindings,
		mediumFindings,
		lowFindings,
		findingsAccepted,
		findingsDismissed,
		findingsBlocking,
		findingsResolved,
		findingsPosted,
		reviewTokens,
		avgTokensPerReview: Math.round(reviewTokens / reviews)
	};
}

function combineTotals(parts: readonly TelemetryTotals[]): TelemetryTotals {
	const sum = (pick: (item: TelemetryTotals) => number) => parts.reduce((acc, item) => acc + pick(item), 0);
	const reviews = sum((item) => item.reviews);
	const reviewTokens = sum((item) => item.reviewTokens);

	return {
		prsReviewed: sum((item) => item.prsReviewed),
		prsMerged: sum((item) => item.prsMerged),
		reviews,
		autoReviews: sum((item) => item.autoReviews),
		findings: sum((item) => item.findings),
		highFindings: sum((item) => item.highFindings),
		mediumFindings: sum((item) => item.mediumFindings),
		lowFindings: sum((item) => item.lowFindings),
		findingsAccepted: sum((item) => item.findingsAccepted),
		findingsDismissed: sum((item) => item.findingsDismissed),
		findingsBlocking: sum((item) => item.findingsBlocking),
		findingsResolved: sum((item) => item.findingsResolved),
		findingsPosted: sum((item) => item.findingsPosted),
		reviewTokens,
		avgTokensPerReview: reviews === 0 ? null : Math.round(reviewTokens / reviews)
	};
}

/** Deterministic telemetry sample over `days` UTC days ending at `now`. */
export function sampleTelemetryReport(days: UsageDays, now = Date.now()): TelemetryReport {
	const start = now - (days - 1) * DAY_MS;

	const daily: TelemetryDay[] = Array.from({ length: days }, (_, offset) => {
		const stamp = start + offset * DAY_MS;
		const day = new Date(stamp).toISOString().slice(0, 10);
		const weekday = new Date(stamp).getUTCDay();
		const quiet = offset === 4;
		const factor = weekday === 0 || weekday === 6 ? 0.25 : 1;

		const byPerson: Record<string, number> = {};
		const byRepo: Record<string, number> = {};
		const byPersonRepo: Record<string, Record<string, number>> = {};

		if (!quiet) {
			SAMPLE_PEOPLE.forEach((person, pIndex) => {
				if (offset < person.startDay) return;

				const count = Math.round(person.rate * factor * (0.55 + pulse(pIndex + 1, offset) * 0.95));

				if (count <= 0) return;

				byPerson[person.accountId] = count;

				const repoCounts: Record<string, number> = {};

				for (let step = 0; step < count; step++) {
					const repoId = person.repos[(offset + step + pIndex) % person.repos.length];

					repoCounts[repoId] = (repoCounts[repoId] ?? 0) + 1;
					byRepo[repoId] = (byRepo[repoId] ?? 0) + 1;
				}

				byPersonRepo[person.accountId] = repoCounts;
			});
		}

		const prsReviewed = Object.values(byPerson).reduce((sum, count) => sum + count, 0);
		const dayStats = totalsFromPrs(prsReviewed, 185_000, offset);

		return {
			day,
			prsReviewed,
			prsMerged: dayStats.prsMerged,
			reviews: dayStats.reviews,
			findings: dayStats.findings,
			findingsAccepted: dayStats.findingsAccepted,
			findingsDismissed: dayStats.findingsDismissed,
			findingsBlocking: dayStats.findingsBlocking,
			byPerson,
			byRepo,
			byPersonRepo
		};
	});

	const repoMap = new Map(SAMPLE_REPOS.map((repo) => [repo.repoId, repo]));
	const grandPrs = daily.reduce((sum, day) => sum + day.prsReviewed, 0);

	const people: TelemetryPerson[] = SAMPLE_PEOPLE.map((spec, pIndex) => {
		const repoPrs = new Map<string, number>();

		for (const day of daily) {
			for (const [repoId, count] of Object.entries(day.byPersonRepo[spec.accountId] ?? {})) {
				repoPrs.set(repoId, (repoPrs.get(repoId) ?? 0) + count);
			}
		}

		const personPrs = [...repoPrs.values()].reduce((sum, count) => sum + count, 0);

		const repos: TelemetryRepo[] = [...repoPrs.entries()]
			.map(([repoId, prs], rIndex) => {
				const repo = repoMap.get(repoId) ?? SAMPLE_REPOS[0];

				return {
					repoId: repo.repoId,
					name: repo.name,
					provider: repo.provider,
					...totalsFromPrs(prs, repo.tokensPerReview, pIndex + rIndex),
					share: personPrs === 0 ? 0 : prs / personPrs
				};
			})
			.sort((a, b) => b.prsReviewed - a.prsReviewed);

		const { accountId, role, provider, host, login } = spec;

		return {
			accountId,
			role,
			provider,
			host,
			login,
			...combineTotals(repos),
			share: grandPrs === 0 ? 0 : personPrs / grandPrs,
			repos
		};
	}).sort((a, b) => b.prsReviewed - a.prsReviewed);

	const repos: TelemetryRepo[] = SAMPLE_REPOS.map((spec, rIndex) => {
		const prs = daily.reduce((sum, day) => sum + (day.byRepo[spec.repoId] ?? 0), 0);

		return {
			repoId: spec.repoId,
			name: spec.name,
			provider: spec.provider,
			...totalsFromPrs(prs, spec.tokensPerReview, rIndex),
			share: grandPrs === 0 ? 0 : prs / grandPrs
		};
	})
		.filter((repo) => repo.prsReviewed > 0)
		.sort((a, b) => b.prsReviewed - a.prsReviewed);

	return {
		days,
		from: daily[0].day,
		to: daily[daily.length - 1].day,
		totals: combineTotals(repos),
		people,
		repos,
		daily
	};
}

/** The sample's telemetry report; answers from memory with no server. */
export function createSampleTelemetry(): TelemetryApi {
	return { report: async (days) => sampleTelemetryReport(days) };
}
