import type { Repo } from '@recoder/shared';

import { parseRepoInput, type RepoTarget } from '../connections/repo-input';
import { repoName } from '../shell/format';
import { refNamesPull, reposFor, type PullRef, type ReviewQuery } from '../shell/pull-ref';
import { searchPulls } from './pull-search';
import { entryAction, queueSections, type QueueEntry } from './queue';

/**
 * One row the review bar offers. `pull`: an open pull request the queue
 * lists. `number`: a number in a tracked repository the queue does not list
 * (closed, or not loaded yet). `track`: a link into a repository nobody
 * tracks, which can be tracked and reviewed in one go. `untracked`: a name or
 * link that cannot be reviewed from here, with the reason when there is one,
 * and whether Settings can fix it (track the repository, set a GitLab host).
 */
export type Suggestion =
	| { kind: 'pull'; id: string; entry: QueueEntry }
	| { kind: 'number'; id: string; repo: Repo; number: number }
	| { kind: 'track'; id: string; target: RepoTarget; number: number }
	| { kind: 'untracked'; id: string; named: string; reason: string | null; fixable: boolean };

export interface SuggestionGroup {
	heading: string;
	items: Suggestion[];
}

/** What the bar knows besides its text. `repos` is null until the tracked list loads. */
export interface BarContext {
	entries: QueueEntry[];
	repos: Repo[] | null;
	sample: boolean;
	/** The self-managed GitLab host Settings holds, so its merge request links can be tracked. */
	gitlabHost: string | null;
}

/** What a row does: open its review, start one, track its repository and review, or send the person to Settings. */
export interface BarAction {
	kind: 'open' | 'start' | 'track' | 'settings';
	label: string;
	/** True when the review it starts posts a summary comment on the pull request. */
	comment: boolean;
}

/** Enter's action and the one ⌘Enter or Shift+Enter runs instead; null when the row has none. */
export interface RowActions {
	primary: BarAction | null;
	alternate: BarAction | null;
}

const PULLS = 'Pull requests';

/** Rows a search shows, and rows each group shows while the field is empty. */
const SEARCH_LIMIT = 6;
const IDLE_LIMIT = 4;

const SAMPLE_CANNOT_TRACK = 'The sample can’t track repositories.';

function pullItem(entry: QueueEntry): Suggestion {
	return { kind: 'pull', id: `pull:${entry.key}`, entry };
}

function nonEmpty(groups: SuggestionGroup[]): SuggestionGroup[] {
	return groups.filter((group) => group.items.length > 0);
}

/** When the field is empty: pull requests that still want a review, in queue order, then the latest reviews. */
function idleGroups(entries: QueueEntry[]): SuggestionGroup[] {
	const waiting = queueSections(entries)
		.flatMap((section) => section.entries)
		.filter((entry) => entryAction(entry).starts)
		.slice(0, IDLE_LIMIT);

	const shown = new Set(waiting);

	const recent = entries
		.filter((entry) => entry.review && entry.review.status !== 'draft' && !shown.has(entry))
		.sort((a, b) => Date.parse(b.review?.updatedAt ?? '') - Date.parse(a.review?.updatedAt ?? ''))
		.slice(0, IDLE_LIMIT);

	return nonEmpty([
		{ heading: 'Waiting for a review', items: waiting.map(pullItem) },
		{ heading: 'Recent reviews', items: recent.map(pullItem) }
	]);
}

/** The row for a reference no tracked repository holds: track a linked one, or say why it can't be reviewed here. */
function untrackedItem(ref: PullRef, refText: string, context: BarContext): Suggestion {
	const named = ref.address ?? ref.name ?? '';

	const untracked = (reason: string | null, fixable = true): Suggestion => ({
		kind: 'untracked',
		id: `untracked:${named}`,
		named,
		reason,
		fixable
	});

	if (context.sample) return untracked(SAMPLE_CANNOT_TRACK, false);
	if (!ref.address) return untracked(null);

	const parsed = parseRepoInput(refText, context.gitlabHost);

	if (!parsed.ok) return untracked(parsed.error);

	return { kind: 'track', id: `track:${parsed.repo.url}#${ref.number}`, target: parsed.repo, number: ref.number };
}

/**
 * The rows for a reference: the open pull requests it names, then the same
 * number in each tracked repository the queue does not list it for, or the
 * way to track the repository it names. The sample only has its own rows.
 */
function refGroups(ref: PullRef, refText: string, context: BarContext): SuggestionGroup[] {
	const matches = context.entries.filter((entry) =>
		refNamesPull(ref, { repo: entry.repo, number: entry.pull.number, url: entry.pull.url })
	);

	const listed = new Set(matches.map((entry) => entry.repoId));

	const numbers: Suggestion[] = context.sample
		? []
		: reposFor(ref, context.repos ?? [])
				.filter((repo) => !listed.has(repo.id))
				.map((repo) => ({ kind: 'number', id: `number:${repo.id}#${ref.number}`, repo, number: ref.number }));

	const named = ref.address ?? ref.name;
	const settled = context.sample || context.repos !== null;
	const untracked = named && settled && matches.length === 0 && numbers.length === 0;

	return nonEmpty([
		{
			heading: PULLS,
			items: [...matches.map(pullItem), ...numbers, ...(untracked ? [untrackedItem(ref, refText, context)] : [])]
		}
	]);
}

/** Every row the bar offers for what is typed, in groups. */
export function suggestionGroups(query: ReviewQuery, context: BarContext): SuggestionGroup[] {
	if (query.ref) return refGroups(query.ref, query.refText, context);

	if (query.search) {
		return nonEmpty([
			{ heading: PULLS, items: searchPulls(context.entries, query.search, SEARCH_LIMIT).map(pullItem) }
		]);
	}

	return idleGroups(context.entries);
}

/** A review that starts, with the comment the person asked for; the alternate also comments, when that adds anything. */
function starting(label: string, comment: boolean, kind: 'start' | 'track' = 'start'): RowActions {
	return {
		primary: { kind, label, comment },
		alternate: comment ? null : { kind, label: 'Also comment on the PR', comment: true }
	};
}

/**
 * What Enter and ⌘Enter do on an open pull request. A running review opens.
 * A pull request without a current review starts one (a failed one
 * continues, unless a brief or a comment asks for a fresh run). A reviewed
 * one opens, and reviews again instead when the person typed a brief.
 */
function pullActions(entry: QueueEntry, brief: boolean, comment: boolean): RowActions {
	const open: BarAction = { kind: 'open', label: 'Open review', comment: false };
	const action = entryAction(entry);
	const fresh = brief || comment;

	if (entry.state === 'reviewing') return { primary: open, alternate: null };

	if (action.starts) {
		const label = !entry.review || entry.review.status === 'draft' ? 'Start review' : 'Review again';

		return starting(entry.state === 'failed' && !fresh ? 'Continue review' : label, comment);
	}

	if (brief) return { primary: { kind: 'start', label: 'Review again', comment }, alternate: open };

	return { primary: open, alternate: { kind: 'start', label: 'Review again', comment } };
}

/** Enter's action and the alternate for a row, given whether a brief is typed and the comment switch is on. */
export function rowActions(item: Suggestion, brief: boolean, comment: boolean): RowActions {
	switch (item.kind) {
		case 'pull':
			return pullActions(item.entry, brief, comment);
		case 'number':
			return starting('Start review', comment);
		case 'track':
			return starting('Track and review', comment, 'track');
		case 'untracked':
			return {
				primary: item.fixable ? { kind: 'settings', label: 'Track in Settings', comment: false } : null,
				alternate: null
			};
	}
}

/** The short name a reference uses for the repository: its last segment, unless another repository shares it. */
function shortName(repo: string, repos: string[]): string {
	const name = repoName(repo);
	const shared = repos.some((other) => other !== repo && repoName(other) === name);

	return shared ? repo : name;
}

/**
 * What Tab puts in the field for a row: its reference (`api#214`, GitLab's
 * `api!214`), a space, then the brief typed so far. Null for rows without one.
 */
export function completion(item: Suggestion, entries: QueueEntry[], brief: string): string | null {
	const repos = [...new Set(entries.map((entry) => entry.repo))];

	if (item.kind === 'pull') {
		const mark = item.entry.pull.url.includes('/merge_requests/') ? '!' : '#';

		return `${shortName(item.entry.repo, repos)}${mark}${item.entry.pull.number} ${brief}`;
	}

	if (item.kind === 'number') return `${shortName(item.repo.name, repos)}#${item.number} ${brief}`;

	return null;
}
