import type { Provider, Repo, RepoOverview, ReviewListItem } from '@recoder/shared';

import { openBugs } from '../pulls/open-bugs';
import type { PullRow, PullRowStatus } from '../pulls/types';
import type { RowEntry } from '../pulls/use-rows';
import { repoHref } from '../shell/routes';
import { byUrgency, chartOf } from './repo-page';
import type { ReviewChart } from './types';

/** Which repositories the page shows: all, those with something to do, those with nothing, those auto review skips. */
export type FleetScope = 'all' | 'needs-you' | 'quiet' | 'auto-off';

/** The scopes in the order the page lists them, each with its name. */
export const FLEET_SCOPES: readonly { id: FleetScope; label: string }[] = [
	{ id: 'all', label: 'All' },
	{ id: 'needs-you', label: 'Needs you' },
	{ id: 'quiet', label: 'Quiet' },
	{ id: 'auto-off', label: 'Auto review off' }
];

/** The scope an address names (`?scope=quiet`); every repository when it names none or one the page does not have. */
export function fleetScopeOf(value: string | null): FleetScope {
	return FLEET_SCOPES.find((scope) => scope.id === value)?.id ?? 'all';
}

/** Where a repository's overview stands: its month of reviews, its merges and whether auto review watches it. */
type FleetOverview =
	| { phase: 'loading' }
	| { phase: 'failed' }
	| { phase: 'ready'; autoReview: boolean; merged: number; days: number; chart: ReviewChart };

/** A repository's open findings as its tile counts them: its bugs when it has any, else its warnings. */
interface FleetBugs {
	count: number;
	/** True when `count` is bugs, false when it is warnings. */
	high: boolean;
}

/** The fact after the open count: what waits for a review, or with nothing open what merged in the window. */
export type FleetSecond =
	{ kind: 'waiting'; count: number } | { kind: 'none-waiting' } | { kind: 'merged'; count: number; days: number };

/** The tile's last line: the pull request to look at next, that auto review skips it, or that nothing is open. */
export type FleetFoot =
	{ kind: 'next'; row: PullRow } | { kind: 'auto-off' } | { kind: 'caught-up'; lastReviewAt: string | null };

/** One tracked repository as a tile of the Repositories page. */
export interface FleetTile {
	id: string;
	/** The owner, shown faint before the name; null for a repository without one. */
	owner: string | null;
	name: string;
	href: string;
	provider: Provider;
	/** Its open pull requests; null until the list answers. */
	open: number | null;
	second: FleetSecond | null;
	bugs: FleetBugs | null;
	/** True when a review of an open pull request found nothing and no bug is open. */
	clean: boolean;
	/** True when a pull request waits for a review or has an open bug. */
	needsYou: boolean;
	foot: FleetFoot;
	overview: FleetOverview;
}

/** The statuses of a pull request that waits for a review: none yet, one out of date, or one that failed. */
const WAITING: ReadonlySet<PullRowStatus['kind']> = new Set(['not-reviewed', 'outdated', 'review-failed']);

/** The statuses of a pull request whose review at its head found nothing. */
const CLEAN: ReadonlySet<PullRowStatus['kind']> = new Set(['ready', 'reviewed']);

/** A repository's overview as the page last read it, or where that read stands. */
export type OverviewRead = RepoOverview | 'loading' | 'failed';

interface FleetInput {
	repos: readonly Repo[];
	/** Every open pull request the list holds, newest activity first. */
	entries: readonly RowEntry[];
	/** Each repository's open pull requests as its forge counts them; null until the list answers. */
	openCounts: Record<string, number> | null;
	/** The reviews the sidebar reads; null until they answer. */
	reviews: readonly ReviewListItem[] | null;
	overviewOf: (repoId: string) => OverviewRead;
	base: string;
}

/** The overview as the tile reads it: the chart's bars and the two facts beside them. */
function overviewFacts(overview: OverviewRead): FleetOverview {
	if (overview === 'loading' || overview === 'failed') return { phase: overview };

	return {
		phase: 'ready',
		autoReview: overview.autoReview,
		merged: overview.mergedPulls,
		days: overview.days,
		chart: chartOf(overview)
	};
}

/** The open findings across a repository's pull requests: the bugs when there are any, else the warnings. */
function bugsOf(entries: readonly RowEntry[]): FleetBugs | null {
	const bugs = entries.reduce((sum, entry) => sum + openBugs(entry), 0);
	const warnings = entries.reduce((sum, { row }) => sum + (row.status.kind === 'bugs' ? row.status.warnings : 0), 0);

	if (bugs > 0) return { count: bugs, high: true };

	return warnings > 0 ? { count: warnings, high: false } : null;
}

/** What follows the open count: the pull requests waiting, that none is, or with nothing open what merged. */
function secondOf(open: number | null, waiting: number, overview: FleetOverview): FleetSecond | null {
	if (waiting > 0) return { kind: 'waiting', count: waiting };
	if (open === null) return null;
	if (open > 0) return { kind: 'none-waiting' };

	return overview.phase === 'ready' ? { kind: 'merged', count: overview.merged, days: overview.days } : null;
}

/** When a review of the repository last changed, as an ISO time; null with none. Draft sessions are not reviews. */
function lastReviewOf(reviews: readonly ReviewListItem[] | null, repoId: string): string | null {
	const times = (reviews ?? [])
		.filter((review) => review.repoId === repoId && review.status !== 'draft')
		.map((review) => review.updatedAt)
		.sort();

	return times.at(-1) ?? null;
}

/**
 * The tile's last line. A repository with something to do names the pull request to open first. Otherwise one
 * auto review skips says so, one with pull requests open names the most urgent, and one with none is caught up.
 */
function footOf(
	tile: Pick<FleetTile, 'needsYou' | 'overview'>,
	next: PullRow | null,
	lastReviewAt: string | null
): FleetFoot {
	if (next && tile.needsYou) return { kind: 'next', row: next };
	if (tile.overview.phase === 'ready' && !tile.overview.autoReview) return { kind: 'auto-off' };

	return next ? { kind: 'next', row: next } : { kind: 'caught-up', lastReviewAt };
}

/** One repository as a tile: its name split from its owner, its figures, its month and its last line. */
function tileOf(repo: Repo, input: FleetInput): FleetTile {
	const entries = input.entries.filter((entry) => entry.row.repoId === repo.id);
	const slash = repo.name.lastIndexOf('/');
	const open = input.openCounts ? (input.openCounts[repo.id] ?? entries.length) : null;
	const waiting = entries.filter(({ row }) => WAITING.has(row.status.kind)).length;
	const bugs = bugsOf(entries);
	const overview = overviewFacts(input.overviewOf(repo.id));
	const needsYou = waiting > 0 || bugs !== null;

	return {
		id: repo.id,
		owner: slash > 0 ? repo.name.slice(0, slash) : null,
		name: slash > 0 ? repo.name.slice(slash + 1) : repo.name,
		href: repoHref(input.base, repo.id),
		provider: repo.provider,
		open,
		second: secondOf(open, waiting, overview),
		bugs,
		clean: bugs === null && entries.some(({ row }) => CLEAN.has(row.status.kind)),
		needsYou,
		foot: footOf({ needsYou, overview }, byUrgency(entries)[0] ?? null, lastReviewOf(input.reviews, repo.id)),
		overview
	};
}

/** Every tracked repository as a tile, those with something to do first, then by name. */
export function fleetTiles(input: FleetInput): FleetTile[] {
	return input.repos
		.map((repo) => tileOf(repo, input))
		.sort(
			(left, right) =>
				Number(right.needsYou) - Number(left.needsYou) ||
				left.name.localeCompare(right.name) ||
				(left.owner ?? '').localeCompare(right.owner ?? '')
		);
}

/** True when the tile belongs under the scope. */
export function inScope(tile: FleetTile, scope: FleetScope): boolean {
	if (scope === 'needs-you') return tile.needsYou;
	if (scope === 'quiet') return !tile.needsYou;
	if (scope === 'auto-off') return tile.overview.phase === 'ready' && !tile.overview.autoReview;

	return true;
}

/** How many tiles each scope holds. */
export function scopeCounts(tiles: readonly FleetTile[]): Record<FleetScope, number> {
	const count = (scope: FleetScope) => tiles.filter((tile) => inScope(tile, scope)).length;

	return { all: count('all'), 'needs-you': count('needs-you'), quiet: count('quiet'), 'auto-off': count('auto-off') };
}

/** True when every word of the filter is in the repository's owner or name. */
export function matchesFilter(tile: FleetTile, query: string): boolean {
	const text = `${tile.owner ?? ''}/${tile.name}`.toLowerCase();

	return query
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.every((term) => text.includes(term));
}
