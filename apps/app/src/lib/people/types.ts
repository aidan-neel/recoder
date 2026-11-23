import type { PersonIdentity, PersonRef, PullAttachment } from '@recoder/shared';

import type { PullRow } from '../pulls/types';
import type { MergedRow, RepoFigure } from '../repo/types';

/** Where the person stands on this server, as the header's pill says it. */
export interface PersonStanding {
	label: string;
	tone: 'ok' | 'neutral' | 'danger';
}

/** A tracked repository the person works in, linked to its page. */
interface PersonRepoRow {
	repoId: string;
	name: string;
	/** "6 pull requests". */
	pulls: string;
	href: string;
}

/** A review the person started, linked to its pull request's Review tab. */
export interface PersonReviewRow {
	id: string;
	title: string;
	/** `api #211`. */
	ref: string;
	/** What it found, worded as the list words it: "2 bugs", "No bugs", "Failed", "Reviewing". */
	outcome: string;
	tone: 'high' | 'medium' | 'ok' | 'danger' | 'neutral';
	href: string;
}

/** Everything the profile page shows once the profile is in. */
export interface PersonPageData {
	person: PersonIdentity;
	/** The name the page leads with: their forge name, else their login. */
	name: string;
	/** Their login as the forge spells it, without a bot's `[bot]`. */
	handle: string;
	forge: { url: string; label: string };
	standing: PersonStanding;
	/** "Member since Nov 1"; null for someone who never signed in. */
	since: string | null;
	/** The account to message; null when they can't be messaged. */
	accountId: string | null;
	/** True for someone who never signed in and could: not a bot, not removed. */
	invitable: boolean;
	figures: RepoFigure[];
	open: PullRow[];
	merged: MergedRow[];
	repos: PersonRepoRow[];
	reviews: PersonReviewRow[];
	/** Tracked repositories that did not answer: the profile says so and shows the rest. */
	failures: string[];
	/** "30 days", for the parts that look back. */
	window: string;
}

/** Everything the profile page shows and does. */
export interface PersonPageView {
	phase: 'loading' | 'ready' | 'missing' | 'failed';
	ref: PersonRef;
	data: PersonPageData | null;
	error: string | null;
	retry: () => void;
	starting: ReadonlySet<string>;
	review: (row: PullRow) => void;
	warm: (row: PullRow) => void;
	/** Opens the conversation with them, carrying `attach` into its next message. */
	message: (attach?: PullAttachment) => Promise<void>;
	/** True while the conversation is being opened. */
	messaging: boolean;
}
