import type {
	AutoReviewSettings,
	Finding,
	FindingSeverity,
	ModelCallRow,
	Provider,
	Repo,
	ReportPerson,
	Review,
	TelemetryDay,
	TelemetryPerson,
	TelemetryRepo,
	TelemetryReport,
	TelemetryTotals,
	UsageDays
} from '@recoder/shared';
import { ADMIN_ACCOUNT_ID } from '../accounts/account-records';
import { pullStateKey, type PullStateRecord } from '../forge/pulls/pull-states';
import { findingFingerprint } from '../forge/publish/render';
import { failsCheckThreshold } from '../forge/publish/review-check';
import { reportableFindings } from '../forge/publish/review-plan';
import { allReportPeople, groupBy, shareOf, utcDay, windowDayKeys } from '../usage/report-shared';

export interface TelemetryInput {
	days: UsageDays;
	/** The moment the window ends: its last day is this moment's UTC day. */
	now: Date;
	reviews: readonly Review[];
	repos: readonly Repo[];
	pullStates: readonly PullStateRecord[];
	/** Recorded model calls, used to compute `reviewTokens` and `avgTokensPerReview`. */
	calls: readonly ModelCallRow[];
	/** Every account to list, including those with no telemetry activity. */
	people: readonly ReportPerson[];
	settings: Pick<AutoReviewSettings, 'checkThreshold' | 'ignoredPaths'>;
}

interface ReviewEvent {
	prKey: string;
	repoId: string;
	day: string;
	account: string;
	auto: boolean;
	tokens?: number;
}

interface RaisedEvent {
	prKey: string;
	repoId: string;
	day: string;
	account: string;
	severity: FindingSeverity;
	blocking: boolean;
}

interface DecisionEvent {
	prKey: string;
	repoId: string;
	day: string;
	account: string;
	state: 'accepted' | 'dismissed';
}

interface PrEvent {
	prKey: string;
	repoId: string;
	day: string;
	account: string;
}

interface MergeEvent {
	prKey: string;
	repoId: string;
	day: string;
	accounts: ReadonlySet<string>;
}

interface WindowEvents {
	touches: PrEvent[];
	reviews: ReviewEvent[];
	raised: RaisedEvent[];
	decisions: DecisionEvent[];
	resolved: PrEvent[];
	posted: PrEvent[];
	merges: MergeEvent[];
}

interface RepoIdentity {
	repoId: string;
	name: string;
	provider: Provider;
}

/**
 * Builds the pull request and finding telemetry report over a UTC window. Pure: needs no storage or clock.
 *
 * Re-reviews of the same pull request share finding ids via `carryPriorFindings`, so each finding is counted
 * once on the review that first raised it, once by the newest passed review's decision, once when first
 * confirmed fixed, and once when first posted to the forge.
 */
export function buildTelemetryReport(input: TelemetryInput): TelemetryReport {
	const window = windowDayKeys(input.now, input.days);
	const inWindow = new Set(window);
	const tokensByReview = reviewTokenTotals(input.calls);
	const { events, seenAccounts, fallbackProviders } = collectWindowEvents(input, inWindow, tokensByReview);
	const reposById = knownRepos(input.repos, events, fallbackProviders);
	const totals = totalsOf(events);
	const repos = reposOf(events, reposById, totals.prsReviewed);
	const people = peopleOf(events, reposById, input.people, seenAccounts);

	return {
		days: input.days,
		from: window[0],
		to: window[window.length - 1],
		totals,
		people,
		repos,
		daily: dailyOf(events, window)
	};
}

/** Processed tokens (`input` plus `output`) per review id, for reviews that recorded at least one token count. */
function reviewTokenTotals(calls: readonly ModelCallRow[]): Map<string, number> {
	const totals = new Map<string, number>();

	for (const call of calls) {
		if (call.kind !== 'review' || !call.ownerId) continue;
		if (call.usage.inputTokens === null && call.usage.outputTokens === null) continue;

		const tokens = (call.usage.inputTokens ?? 0) + (call.usage.outputTokens ?? 0);

		totals.set(call.ownerId, (totals.get(call.ownerId) ?? 0) + tokens);
	}

	return totals;
}

function reviewTimestamp(review: Review): number {
	const primary = Date.parse(review.startedAt ?? review.createdAt);

	return Number.isNaN(primary) ? Date.parse(review.createdAt) : primary;
}

function reviewDayOf(review: Review): string | null {
	return utcDay(review.startedAt ?? review.createdAt) ?? utcDay(review.createdAt);
}

/** Walks every pull request's passed reviews chronologically and collects all events falling inside `inWindow`. */
function collectWindowEvents(
	input: TelemetryInput,
	inWindow: ReadonlySet<string>,
	tokensByReview: ReadonlyMap<string, number>
): { events: WindowEvents; seenAccounts: Set<string>; fallbackProviders: Map<string, Provider> } {
	const events: WindowEvents = {
		touches: [],
		reviews: [],
		raised: [],
		decisions: [],
		resolved: [],
		posted: [],
		merges: []
	};

	const seenAccounts = new Set<string>();
	const fallbackProviders = new Map<string, Provider>();
	const prParticipants = new Map<string, Set<string>>();

	const passed = input.reviews
		.filter((review) => review.status === 'passed' && reviewDayOf(review) !== null)
		.sort((a, b) => reviewTimestamp(a) - reviewTimestamp(b) || a.id.localeCompare(b.id));

	for (const [prKey, prReviews] of groupBy(passed, (review) => pullStateKey(review.repoId, review.prNumber))) {
		const participants = new Set<string>();

		prParticipants.set(prKey, participants);

		for (const review of prReviews) {
			if (review.source !== 'stub' && !fallbackProviders.has(review.repoId)) {
				fallbackProviders.set(review.repoId, review.source);
			}
		}

		collectPrReviewEvents(prKey, prReviews, input.settings, inWindow, tokensByReview, participants, events);

		for (const account of participants) {
			if (hasAccountWindowEvent(account, prKey, events)) seenAccounts.add(account);
		}
	}

	for (const record of input.pullStates) {
		if (record.state !== 'merged') continue;

		const day = utcDay(record.mergedAt ?? record.checkedAt);
		const participants = prParticipants.get(record.id);

		if (!day || !inWindow.has(day)) continue;
		if (!participants && !record.mergedBy) continue;

		const accounts = new Set<string>(participants ?? []);

		if (record.mergedBy) accounts.add(record.mergedBy);
		for (const account of accounts) seenAccounts.add(account);

		events.merges.push({ prKey: record.id, repoId: record.repoId, day, accounts });
	}

	return { events, seenAccounts, fallbackProviders };
}

function hasAccountWindowEvent(account: string, prKey: string, events: WindowEvents): boolean {
	return events.touches.some((touch) => touch.prKey === prKey && touch.account === account);
}

/** Collects deduplicated review, finding, decision, resolution and posting events for one pull request. */
function collectPrReviewEvents(
	prKey: string,
	prReviews: readonly Review[],
	settings: Pick<AutoReviewSettings, 'checkThreshold' | 'ignoredPaths'>,
	inWindow: ReadonlySet<string>,
	tokensByReview: ReadonlyMap<string, number>,
	participants: Set<string>,
	events: WindowEvents
): void {
	const repoId = prReviews[0].repoId;
	const latestFinding = new Map<string, Finding>();
	const decisionStamp = new Map<string, string>();
	const decisionFallback = new Map<string, string>();

	for (const review of prReviews) {
		const reviewer = review.startedBy ?? ADMIN_ACCOUNT_ID;

		participants.add(reviewer);

		for (const finding of review.findings) {
			latestFinding.set(finding.id, finding);

			if (finding.decision && decisionStamp.get(finding.id) !== finding.decision.decidedAt) {
				decisionStamp.set(finding.id, finding.decision.decidedAt);
				decisionFallback.set(finding.id, reviewer);
			}
		}
	}

	const seenRaised = new Set<string>();
	const seenResolved = new Set<string>();
	const seenPosted = new Set<string>();

	for (const review of prReviews) {
		const day = reviewDayOf(review)!;
		const account = review.startedBy ?? ADMIN_ACCOUNT_ID;
		const inRange = inWindow.has(day);
		const tokens = tokensByReview.get(review.id);

		if (inRange) {
			events.touches.push({ prKey, repoId, day, account });

			events.reviews.push({
				prKey,
				repoId,
				day,
				account,
				auto: review.trigger === 'webhook' || review.trigger === 'auto',
				...(tokens !== undefined ? { tokens } : {})
			});
		}

		const summarized = review.findingsReview?.state === 'posted' ? new Set(review.summarizedFindings ?? []) : null;

		for (const finding of review.findings) {
			const latest = latestFinding.get(finding.id) ?? finding;

			if (!seenRaised.has(finding.id)) {
				seenRaised.add(finding.id);

				if (!latest.topic?.quieted && inRange) {
					const blocking =
						reportableFindings([latest], settings.ignoredPaths).length > 0 &&
						failsCheckThreshold(latest, settings.checkThreshold);

					events.raised.push({ prKey, repoId, day, account, severity: latest.severity, blocking });
				}
			}

			const posted =
				Boolean(review.findingComments?.[finding.id]) || Boolean(summarized?.has(findingFingerprint(finding)));

			if (posted && !seenPosted.has(finding.id)) {
				seenPosted.add(finding.id);
				if (!latest.topic?.quieted && inRange) events.posted.push({ prKey, repoId, day, account });
			}
		}

		for (const item of review.resolved ?? []) {
			if (seenResolved.has(item.finding.id)) continue;
			seenResolved.add(item.finding.id);

			if (!item.finding.topic?.quieted && inRange) events.resolved.push({ prKey, repoId, day, account });
		}
	}

	for (const [findingId, latest] of latestFinding) {
		if (latest.topic?.quieted || !latest.decision) continue;

		const account = latest.decision.decidedBy ?? decisionFallback.get(findingId) ?? ADMIN_ACCOUNT_ID;
		const day = utcDay(latest.decision.decidedAt);

		participants.add(account);

		if (day && inWindow.has(day)) {
			events.touches.push({ prKey, repoId, day, account });
			events.decisions.push({ prKey, repoId, day, account, state: latest.decision.state });
		}
	}
}

function sliceEvents(events: WindowEvents, keep: { account?: string; repoId?: string }): WindowEvents {
	const matchItem = <T extends { account: string; repoId: string }>(item: T): boolean =>
		(keep.account === undefined || item.account === keep.account) &&
		(keep.repoId === undefined || item.repoId === keep.repoId);

	return {
		touches: events.touches.filter(matchItem),
		reviews: events.reviews.filter(matchItem),
		raised: events.raised.filter(matchItem),
		decisions: events.decisions.filter(matchItem),
		resolved: events.resolved.filter(matchItem),
		posted: events.posted.filter(matchItem),
		merges: events.merges.filter(
			(merge) =>
				(keep.repoId === undefined || merge.repoId === keep.repoId) &&
				(keep.account === undefined || merge.accounts.has(keep.account))
		)
	};
}

function totalsOf(events: WindowEvents): TelemetryTotals {
	const tracked = events.reviews.flatMap((review) => (review.tokens === undefined ? [] : [review.tokens]));
	const reviewTokens = tracked.reduce((sum, tokens) => sum + tokens, 0);

	return {
		prsReviewed: new Set(events.touches.map((touch) => touch.prKey)).size,
		prsMerged: events.merges.length,
		reviews: events.reviews.length,
		autoReviews: events.reviews.filter((review) => review.auto).length,
		findings: events.raised.length,
		highFindings: events.raised.filter((finding) => finding.severity === 'error').length,
		mediumFindings: events.raised.filter((finding) => finding.severity === 'warning').length,
		lowFindings: events.raised.filter((finding) => finding.severity === 'info').length,
		findingsAccepted: events.decisions.filter((decision) => decision.state === 'accepted').length,
		findingsDismissed: events.decisions.filter((decision) => decision.state === 'dismissed').length,
		findingsBlocking: events.raised.filter((finding) => finding.blocking).length,
		findingsResolved: events.resolved.length,
		findingsPosted: events.posted.length,
		reviewTokens,
		avgTokensPerReview: tracked.length === 0 ? null : Math.round(reviewTokens / tracked.length)
	};
}

function knownRepos(
	repos: readonly Repo[],
	events: WindowEvents,
	fallbackProviders: ReadonlyMap<string, Provider>
): Map<string, RepoIdentity> {
	const byId = new Map<string, RepoIdentity>(
		repos.map((repo) => [repo.id, { repoId: repo.id, name: repo.name, provider: repo.provider }])
	);

	const referenced = new Set([
		...events.touches.map((touch) => touch.repoId),
		...events.merges.map((merge) => merge.repoId)
	]);

	for (const repoId of referenced) {
		if (!byId.has(repoId)) {
			byId.set(repoId, { repoId, name: repoId, provider: fallbackProviders.get(repoId) ?? 'github' });
		}
	}

	return byId;
}

function compareTotals(a: TelemetryTotals, b: TelemetryTotals, aName: string, bName: string): number {
	return (
		b.prsReviewed - a.prsReviewed || b.reviews - a.reviews || b.prsMerged - a.prsMerged || aName.localeCompare(bName)
	);
}

function reposOf(
	events: WindowEvents,
	reposById: ReadonlyMap<string, RepoIdentity>,
	wholePrs: number,
	account?: string
): TelemetryRepo[] {
	const repoIds = new Set([
		...events.touches.map((touch) => touch.repoId),
		...events.merges.map((merge) => merge.repoId)
	]);

	return [...repoIds]
		.map((repoId) => {
			const identity = reposById.get(repoId) ?? { repoId, name: repoId, provider: 'github' as const };
			const totals = totalsOf(sliceEvents(events, { account, repoId }));

			return { ...identity, ...totals, share: shareOf(totals.prsReviewed, wholePrs) };
		})
		.filter((repo) => repo.prsReviewed > 0 || repo.prsMerged > 0)
		.sort((a, b) => compareTotals(a, b, a.name, b.name));
}

function peopleOf(
	events: WindowEvents,
	reposById: ReadonlyMap<string, RepoIdentity>,
	known: readonly ReportPerson[],
	seenAccounts: Iterable<string>
): TelemetryPerson[] {
	const raw = allReportPeople(known, seenAccounts).map((identity) => {
		const personEvents = sliceEvents(events, { account: identity.accountId });
		const totals = totalsOf(personEvents);

		return {
			identity,
			totals,
			repos: reposOf(personEvents, reposById, totals.prsReviewed, identity.accountId)
		};
	});

	const wholePersonPrs = raw.reduce((sum, entry) => sum + entry.totals.prsReviewed, 0);

	return raw
		.map(({ identity, totals, repos }) => ({
			...identity,
			...totals,
			share: shareOf(totals.prsReviewed, wholePersonPrs),
			repos
		}))
		.sort((a, b) => compareTotals(a, b, a.login, b.login));
}

function dailyOf(events: WindowEvents, window: readonly string[]): TelemetryDay[] {
	const touchesByDay = groupBy(events.touches, (touch) => touch.day);
	const reviewsByDay = groupBy(events.reviews, (review) => review.day);
	const raisedByDay = groupBy(events.raised, (finding) => finding.day);
	const decisionsByDay = groupBy(events.decisions, (decision) => decision.day);
	const mergesByDay = groupBy(events.merges, (merge) => merge.day);

	return window.map((day) => {
		const touches = touchesByDay.get(day) ?? [];
		const reviews = reviewsByDay.get(day) ?? [];
		const raised = raisedByDay.get(day) ?? [];
		const decisions = decisionsByDay.get(day) ?? [];
		const merges = mergesByDay.get(day) ?? [];

		const byPerson: Record<string, number> = {};
		const byRepo: Record<string, number> = {};
		const byPersonRepo: Record<string, Record<string, number>> = {};

		for (const [account, items] of groupBy(touches, (touch) => touch.account)) {
			byPerson[account] = new Set(items.map((item) => item.prKey)).size;

			const repoCounts: Record<string, number> = {};

			for (const [repoId, repoItems] of groupBy(items, (item) => item.repoId)) {
				repoCounts[repoId] = new Set(repoItems.map((item) => item.prKey)).size;
			}

			byPersonRepo[account] = repoCounts;
		}

		for (const [repoId, items] of groupBy(touches, (touch) => touch.repoId)) {
			byRepo[repoId] = new Set(items.map((item) => item.prKey)).size;
		}

		return {
			day,
			prsReviewed: new Set(touches.map((touch) => touch.prKey)).size,
			prsMerged: merges.length,
			reviews: reviews.length,
			findings: raised.length,
			findingsAccepted: decisions.filter((decision) => decision.state === 'accepted').length,
			findingsDismissed: decisions.filter((decision) => decision.state === 'dismissed').length,
			findingsBlocking: raised.filter((finding) => finding.blocking).length,
			byPerson,
			byRepo,
			byPersonRepo
		};
	});
}
