import type { AccountRole, SignInForge } from './accounts';
import type { PullListItem } from './pulls';
import type { ReviewListItem } from './review-list';

/**
 * People on the forges this server reads. A profile exists for anyone who wrote a pull request or ran a review in a
 * tracked repository, whether or not they signed in to this server; only people who signed in can be messaged.
 */

/** Names a person on a forge: what a profile address holds (`/people/github/mira`, `/people/gitlab/mira?host=…`). */
export interface PersonRef {
	provider: SignInForge;
	/** GitLab's self-managed host; null for github.com and gitlab.com. */
	host: string | null;
	/** As the forge spells it now; a member who renamed keeps their account, found by the forge's user id. */
	login: string;
}

/** Who a person is on their forge. */
export interface PersonIdentity extends PersonRef {
	name: string | null;
	avatarUrl: string | null;
	/** Their page on the forge. */
	forgeUrl: string;
	/** A bot account (`renovate[bot]`, GitHub's Bot type). It has a profile but never signs in, so it can't be messaged or invited. */
	bot: boolean;
}

/**
 * Whether the person has an account on this server. `member` covers the admin too (see `role`). `removed`: the
 * admin removed them, so they can't sign in again. `none`: they never signed in.
 */
export type PersonMembership =
	| { status: 'member'; accountId: string; role: AccountRole; joinedAt: string }
	| { status: 'removed' }
	| { status: 'none' };

/** A person who can be messaged: an active account, as `GET /api/people` lists them for a new conversation. */
export interface PersonSummary extends PersonRef {
	accountId: string;
	name: string | null;
	avatarUrl: string | null;
}

/** The profile's headline numbers, over tracked repositories only. */
export interface PersonFigures {
	openPulls: number;
	/** Open pull requests with no review yet. */
	unreviewed: number;
	/** Merged in the last `PERSON_WINDOW_DAYS` days. */
	merged: number;
	/** Reviews this person started; 0 for someone who never signed in. */
	reviewsRun: number;
	/** Open bugs in the newest review of each of their open pull requests. */
	openBugs: number;
	/** Findings on their pull requests in the window that were fixed, out of `findingsRaised`. */
	findingsFixed: number;
	findingsRaised: number;
}

/** One tracked repository the person is active in, with how many of their pull requests it holds in the window. */
export interface PersonRepository {
	repoId: string;
	/** `owner/name`. */
	name: string;
	pulls: number;
}

/**
 * `GET /api/people/:provider/:login` (`?host=` for a self-managed GitLab). Only tracked repositories are ever read.
 * A repository whose forge call failed is named in `failures` and the rest still load. 404 when the forge knows no
 * such person and no tracked repository mentions them.
 */
export interface PersonProfile {
	person: PersonIdentity;
	membership: PersonMembership;
	/** True for an active member other than the signed-in person. */
	canMessage: boolean;
	figures: PersonFigures;
	/** Their open pull requests, newest activity first, each with its newest review. */
	openPulls: PullListItem[];
	/** Merged in the window, newest first, at most 5. */
	recentlyMerged: PullListItem[];
	/** Reviews they started, newest first, at most 5. */
	reviewsRun: ReviewListItem[];
	repositories: PersonRepository[];
	failures: { repoId: string; error: string }[];
	fetchedAt: string;
}

/** The window a profile's merged count, findings and repositories cover. */
export const PERSON_WINDOW_DAYS = 30;

/** Whether a forge login names a bot, for forges that mark bots only in the login. */
export function isBotLogin(login: string): boolean {
	return /\[bot\]$/i.test(login);
}
