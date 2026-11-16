import type { Provider } from '@recoder/shared';

import type { PullRow } from '../pulls/types';

/** The repository the page is about, as its header shows it. */
export interface RepoFacts {
	id: string;
	/** The owner or group part of `owner/name`; null for a repository named without one. */
	owner: string | null;
	name: string;
	provider: Provider;
	/** The repository on its forge, and the forge's name; null for a local repository. */
	forge: { url: string; label: string } | null;
	defaultBranch: string;
	/** "Tracked since Sep 3". */
	tracked: string;
	/** Auto review watches the repository. */
	autoReview: boolean;
}

/** One figure in the row under the header: a label over a number, with a quieter fact beside the number. */
export interface RepoFigure {
	id: 'open' | 'bugs' | 'merged' | 'accepted' | 'typical';
	label: string;
	value: string;
	detail: string | null;
	/** `high` colours the fact as a high-severity bug does. */
	tone: 'high' | null;
}

/** One day's bar in the reviews chart. */
interface ReviewBar {
	day: string;
	/** The day as a tip names it: "Thu, Nov 13". */
	label: string;
	reviews: number;
	withBugs: number;
	/** The bar's height as a share of the busiest day, and the share of the bar that found a bug. */
	height: number;
	bugShare: number;
}

/** The reviews chart: a bar a day, oldest first, and the words at either end of the axis. */
export interface ReviewChart {
	title: string;
	bars: ReviewBar[];
	first: string;
	last: string;
	/** What the chart says when no review started in the window; null when one did. */
	empty: string | null;
	/** What a screen reader hears instead of the bars. */
	summary: string;
}

/** A directory where bugs land, with its share of the busiest one. */
export interface HotspotRow {
	path: string;
	findings: number;
	share: number;
}

/** A pull request that merged after a review. */
export interface MergedRow {
	key: string;
	number: number;
	title: string;
	mergedAt: string;
	/** "3 fixed" or "Clean". */
	outcome: string;
	href: string;
}

/** The repository's own data once it is all in. */
export interface RepoPageData {
	repo: RepoFacts;
	figures: RepoFigure[];
	/** The open pull requests, most urgent first, at most five. */
	needsYou: PullRow[];
	/** "All 9 pull requests". */
	allPullsLabel: string;
	merged: MergedRow[];
	chart: ReviewChart;
	/** "30 days", for the titles of the parts that look back. */
	window: string;
	hotspots: HotspotRow[];
}

/** Everything the repository page shows and does. */
export interface RepoPageView {
	/** `loading` until the repository, its pull requests and its overview are in; the page paints once, whole. */
	phase: 'loading' | 'ready' | 'missing' | 'failed';
	data: RepoPageData | null;
	/** The repository's short name for the bar, as soon as the tracked list has it; null before or when it is not tracked. */
	name: string | null;
	/** Why the page failed, when `phase` is `failed`. */
	error: string | null;
	/** True when the review server did not answer at all. */
	offline: boolean;
	retry: () => void;
	/** Keys of the rows whose review start is in flight. */
	starting: ReadonlySet<string>;
	/** Starts a review of a row's pull request; a refusal shows as a toast and the row goes back. */
	review: (row: PullRow) => void;
	/** Reads a row's page once the pointer rests on it, so the click that follows finds it loaded. */
	warm: (row: PullRow) => void;
	/** The pull request list, shown for this repository alone. */
	pullsHref: string;
	showPulls: () => void;
	/** The New screen, set to this repository: for a review or for a chat. */
	newHref: string;
	prepareReview: () => void;
	prepareAsk: () => void;
}
