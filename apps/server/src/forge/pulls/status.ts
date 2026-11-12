import {
	PULL_LIST_REPO_MAX,
	type MergePullInput,
	type MergePullResult,
	type PrCheck,
	type PullCheckTally,
	type PullComment,
	type PullCommit,
	type PullMergeMethod,
	type PullRequest,
	type PullStatus
} from '@recoder/shared';
import { GhError, isJsonObject } from '../cli.js';
import { redactedForgeText } from './failure.js';

/** A pull request with the forge-side state the list and the page show beside it. */
export interface PullEntry {
	pull: PullRequest;
	status: PullStatus;
}

/** A repository's open pull requests, at most {@link PULL_LIST_REPO_MAX}. */
export interface OpenPulls {
	entries: PullEntry[];
	/** The repository has more open pull requests than the list keeps. */
	truncated: boolean;
}

/**
 * What Recoder reads from and writes to one repository's pull requests. Each
 * provider implements it, so the routes never branch on the forge.
 */
export interface PullForge {
	/** The forge keeps a conversation and takes new comments. */
	comments: boolean;
	checks: boolean;
	/** Open pull requests, newest first, in as few forge calls as the forge allows. */
	list(): Promise<OpenPulls>;
	/** One pull request in any state. */
	view(n: number): Promise<PullEntry>;
	/** The pull request's commits, oldest first. */
	commits(pull: PullRequest): Promise<PullCommit[]>;
	/** Comments, review summaries and inline comments, in the order the forge lists them. */
	conversation(pull: PullRequest): Promise<PullComment[]>;
	comment(pull: PullRequest, body: string): Promise<PullComment>;
	/** The merge methods the repository allows. */
	mergeMethods(): Promise<PullMergeMethod[]>;
	/** Merge at `input.headSha`. A merge the forge refuses answers `merged: false` with its reason. */
	merge(n: number, input: MergePullInput): Promise<MergePullResult>;
}

/** A pull request action this repository's forge cannot do, such as merging a local pull request. */
export class UnsupportedPullAction extends Error {}

/** The pull request's head moved past the commit the person saw, so what they asked for is refused. */
export class PullHeadMoved extends Error {
	constructor() {
		super('The pull request has new commits since you loaded it. Reload and try again.');
	}
}

/** How many open pull requests to ask a forge for: one more than the list keeps, so a cut list shows. */
export const OPEN_PULLS_ASKED = PULL_LIST_REPO_MAX + 1;

/** The first {@link PULL_LIST_REPO_MAX} of a forge's {@link OPEN_PULLS_ASKED} newest open pull requests. */
export function capOpenPulls(entries: PullEntry[]): OpenPulls {
	return { entries: entries.slice(0, PULL_LIST_REPO_MAX), truncated: entries.length > PULL_LIST_REPO_MAX };
}

/**
 * How GitHub (`gh pr merge --match-head-commit`) and GitLab (`sha` on the
 * merge call) refuse a merge pinned to a head the branch moved past.
 */
const HEAD_MOVED_REFUSAL = /head branch was modified|sha does not match head of source branch/i;

/** A merge the forge refused, with the end of its reason, where the CLI or API puts the cause, credentials removed. */
export function refusedMerge(reason: string): MergePullResult {
	return { merged: false, sha: null, message: redactedForgeText(reason) };
}

/**
 * A failed merge call as the forge's refusal. Only an `unknown` failure is the
 * forge saying no to this merge; a missing login, a rate limit or an
 * unreachable forge is rethrown so the route answers it as forge trouble. A
 * head that moved after the route checked it is {@link PullHeadMoved}, a
 * conflict with what the person saw rather than the forge's verdict.
 */
export function mergeRefusal(err: unknown): MergePullResult {
	if (!(err instanceof GhError) || err.kind !== 'unknown') throw err;
	if (HEAD_MOVED_REFUSAL.test(err.message)) throw new PullHeadMoved();

	return refusedMerge(err.message);
}

/** Counts the head commit's checks by how each ended; a skipped check counts as passed. Null with no checks. */
export function tallyChecks(states: PrCheck['state'][]): PullCheckTally | null {
	if (states.length === 0) return null;

	const tally: PullCheckTally = { passed: 0, failed: 0, pending: 0 };

	for (const state of states) tally[CHECK_OUTCOME[state]]++;

	return tally;
}

/** Which tally count each check state adds to. */
const CHECK_OUTCOME: Record<PrCheck['state'], keyof PullCheckTally> = {
	passed: 'passed',
	skipped: 'passed',
	failed: 'failed',
	pending: 'pending',
	running: 'pending'
};

/** A commit message split into its first line and the rest. */
export function splitMessage(message: string): { title: string; body: string } {
	const text = message.replace(/\r\n/g, '\n').trim();
	const end = text.indexOf('\n');

	if (end === -1) return { title: text, body: '' };

	return { title: text.slice(0, end).trim(), body: text.slice(end + 1).trim() };
}

/** Oldest first; the forge's own order breaks ties, since `sort` is stable. */
export function chronological(comments: PullComment[]): PullComment[] {
	return [...comments].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** A forge JSON object, or an empty one. */
export function record(value: unknown): Record<string, unknown> {
	return isJsonObject(value) ? value : {};
}

/** A forge JSON array of objects; anything else is empty. */
export function records(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.map(record) : [];
}

/** Pages of 100 read from one forge list; GitHub lists at most 250 commits on a pull request anyway. */
const MAX_PAGES = 10;

/** Every page of a forge list endpoint that takes `per_page` and `page`, up to {@link MAX_PAGES}. */
export async function allPages(readPage: (query: string) => Promise<unknown>): Promise<Record<string, unknown>[]> {
	const rows: Record<string, unknown>[] = [];

	for (let page = 1; page <= MAX_PAGES; page++) {
		const batch = records(await readPage(`per_page=100&page=${page}`));

		rows.push(...batch);
		if (batch.length < 100) break;
	}

	return rows;
}
