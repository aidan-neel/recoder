import type { IntentSource, IntentSourceKind, PrRef } from '../../review/pipeline/intent/types.js';

/**
 * The caps every gathered context is cut to. Sources are sorted before they
 * are cut, so the same PR always loses the same text.
 */
export const CONTEXT_CAPS = {
	sourceChars: 1_500,
	prChars: 4_000,
	totalChars: 24_000,
	issues: 8,
	comments: 40,
	threads: 20,
	commits: 30,
	children: 5,
	pastReviews: 3
} as const;

/**
 * Kinds in the order they are kept when the total cap cuts: what the PR says
 * about itself first, then the stack it sits in, its issues and its discussion.
 */
const KIND_ORDER: IntentSourceKind[] = [
	'pr',
	'stack',
	'issue',
	'review-thread',
	'comment',
	'commit',
	'past-review',
	'pr-history'
];

const collator = new Intl.Collator('en', { numeric: true });

/** Per-kind counts beyond which further sources of that kind are dropped. */
const KIND_CAPS: Partial<Record<IntentSourceKind, number>> = {
	issue: CONTEXT_CAPS.issues,
	comment: CONTEXT_CAPS.comments,
	'review-thread': CONTEXT_CAPS.threads,
	commit: CONTEXT_CAPS.commits,
	'past-review': CONTEXT_CAPS.pastReviews
};

/** Trimmed text cut to `max` characters, marked when cut. */
export function clip(text: unknown, max: number): string {
	const clean = typeof text === 'string' ? text.replace(/\r\n/g, '\n').trim() : '';

	return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/** A source with its text clipped to the cap for its kind; optional fields left out when empty. */
export function makeSource(source: IntentSource): IntentSource {
	const max = source.kind === 'pr' ? CONTEXT_CAPS.prChars : CONTEXT_CAPS.sourceChars;
	const out: IntentSource = { kind: source.kind, ref: source.ref, text: clip(source.text, max) };

	if (source.url) out.url = source.url;
	if (source.title) out.title = clip(source.title, 200);
	if (source.author) out.author = source.author;
	if (source.at) out.at = source.at;
	if (source.revision) out.revision = source.revision;
	if (source.range) out.range = source.range;
	if (source.recorded !== undefined) out.recorded = source.recorded;

	return out;
}

/** Kind order, then natural ref order (`issue:#3` before `issue:#12`), then time. */
export function sortSources(sources: IntentSource[]): IntentSource[] {
	return [...sources].sort(
		(a, b) =>
			KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
			collator.compare(a.ref, b.ref) ||
			(a.at ?? '').localeCompare(b.at ?? '')
	);
}

/**
 * Sorts, drops duplicate refs and empty texts, applies the per-kind caps and
 * then the total character cap. A source that would overflow the total is
 * skipped; smaller ones after it still fit.
 */
export function finishSources(sources: IntentSource[]): IntentSource[] {
	const seen = new Set<string>();
	const counts = new Map<IntentSourceKind, number>();
	const kept: IntentSource[] = [];
	let total = 0;

	for (const source of sortSources(sources)) {
		const count = counts.get(source.kind) ?? 0;
		const cap = KIND_CAPS[source.kind] ?? Infinity;
		const size = source.text.length + (source.title?.length ?? 0);

		if (seen.has(source.ref) || (!source.text && !source.title) || count >= cap) continue;
		if (total + size > CONTEXT_CAPS.totalChars) continue;

		seen.add(source.ref);
		counts.set(source.kind, count + 1);
		total += size;
		kept.push(source);
	}

	return kept;
}

/** An issue on this host: `repo` is its project path, or null for the PR's own repo. */
export interface IssueKey {
	repo: string | null;
	number: number;
}

/** `#12`, or `owner/repo#12` for an issue in another repo. */
export function issueLabel(key: IssueKey): string {
	return `${key.repo ?? ''}#${key.number}`;
}

const ISSUE_URL = /https?:\/\/[^\s/]+\/((?:[\w.-]+\/)+?[\w.-]+)(?:\/-)?\/issues\/(\d+)/g;
const ISSUE_REF = /(?<![\w/#&.-])((?:[\w.-]+\/)+[\w.-]+)?#(\d+)\b/g;

/**
 * Issues a text points at: `#12`, `owner/repo#12`, `group/sub/project#12` and
 * issue URLs on GitHub or GitLab, deduplicated in order of first mention.
 * References to `slug` itself count as this repo.
 */
export function mentionedIssues(text: string, slug: string): IssueKey[] {
	const own = slug.toLowerCase();
	const found: { at: number; key: IssueKey }[] = [];
	const withoutUrls = text.replace(ISSUE_URL, (match) => ' '.repeat(match.length));

	for (const match of text.matchAll(ISSUE_URL)) {
		found.push({ at: match.index, key: { repo: match[1], number: Number(match[2]) } });
	}

	for (const match of withoutUrls.matchAll(ISSUE_REF)) {
		found.push({ at: match.index, key: { repo: match[1] ?? null, number: Number(match[2]) } });
	}

	const seen = new Set<string>();

	return found
		.sort((a, b) => a.at - b.at)
		.map(({ key }) => (key.repo?.toLowerCase() === own ? { repo: null, number: key.number } : key))
		.filter((key) => {
			const label = issueLabel(key).toLowerCase();

			if (key.number <= 0 || seen.has(label)) return false;
			seen.add(label);

			return true;
		});
}

/** A commit message as git splits it: the subject line, the body, and the trailer block git recognizes. */
export interface CommitMessage {
	subject: string;
	body: string;
	trailers: string;
}

/** The `git log --format` fields `parseMessage` reads back, separated by 0x1f. */
export const MESSAGE_FIELDS = '%s%x1f%b%x1f%(trailers:only,unfold)';

/** A `CommitMessage` from the three fields `MESSAGE_FIELDS` prints. */
export function parseMessage([subject, body, trailers]: (string | undefined)[]): CommitMessage {
	return { subject: subject ?? '', body: (body ?? '').trim(), trailers: trailers ?? '' };
}

/** A pull request a commit message names, with what the message says of it. */
export interface NamedPull {
	number: number;
	/** Empty when the message names the PR without its title. */
	title: string;
	url?: string;
}

/** Trailer keys that name the pull request a commit came from, lower case. */
const PULL_TRAILERS = new Set(['pr', 'pr-url', 'pull-request', 'reviewed-on', 'merge-request']);

/** A GitHub, Gitea or GitLab pull request URL: the project path it names, then the number. */
const PULL_URL = /^https?:\/\/[^/\s]+\/(\S+?)\/(?:-\/)?(?:pull|pulls|merge_requests)\/(\d+)\/?$/;

/** Whether a project path a message names is this repo's `slug`; never when the slug isn't known. */
function sameProject(path: string, slug: string | null): boolean {
	return slug !== null && path.toLowerCase() === slug.toLowerCase();
}

/** The PR a trailer names: `PR: #12`, or a URL into this repo such as `PR-URL: https://github.com/o/r/pull/12`. */
function trailerPull(trailers: string, slug: string | null): NamedPull | null {
	for (const line of trailers.split('\n')) {
		const [, key = '', value = ''] = /^([\w-]+):\s*(\S+)\s*$/.exec(line.trim()) ?? [];

		if (!PULL_TRAILERS.has(key.toLowerCase())) continue;

		const bare = /^[#!](\d+)$/.exec(value);

		if (bare) return { number: Number(bare[1]), title: '' };

		const url = PULL_URL.exec(value);

		if (url && sameProject(url[1], slug)) return { number: Number(url[2]), title: '', url: value.replace(/\/$/, '') };
	}

	return null;
}

/**
 * The pull request of this repo a commit message names, in the forms hosts
 * write: a squash subject `Fix the parser (#123)`, a GitHub merge `Merge pull
 * request #123 from owner/branch` with the PR title as the body's first line, a
 * GitLab merge body ending `See merge request group/project!123` after the
 * title, or a `PR`, `PR-URL`, `Pull-Request`, `Reviewed-on` or `Merge-Request`
 * trailer. A reference that names a project, a URL or a GitLab footer, counts
 * only when it names `slug`, so with no slug only the unqualified forms do.
 * Null when it names none: a PR is never guessed from anything else.
 */
export function namedPull(message: CommitMessage, slug: string | null): NamedPull | null {
	const squash = /^(.*?)\s*\(#(\d+)\)\s*$/.exec(message.subject);

	if (squash) return { number: Number(squash[2]), title: squash[1] };

	const firstLine = message.body.split('\n')[0].trim();
	const github = /^Merge pull request #(\d+) from \S+$/.exec(message.subject.trim());

	if (github) return { number: Number(github[1]), title: firstLine };

	const gitlab = /^See merge request (\S*)!(\d+)\s*$/m.exec(message.body);

	if (gitlab && (!gitlab[1] || sameProject(gitlab[1], slug))) {
		return { number: Number(gitlab[2]), title: firstLine.startsWith('See merge request') ? '' : firstLine };
	}

	return trailerPull(message.trailers, slug);
}

/**
 * Recoder posts nothing to the host today, so its own comments are recognized
 * by a login naming it or the HTML marker its comments would carry.
 */
export function isRecoderComment(author: string | undefined, body: string): boolean {
	return /recoder/i.test(author ?? '') || body.includes('<!-- recoder');
}

/** Who is on the pull request, as the forge reports it. */
export interface PeopleRows {
	author: string | null;
	reviewers: string[];
	assignees: string[];
	labels: string[];
	milestone: string | null;
	draft: boolean;
}

/** People, labels and status as one short block for the reviewers. */
export function peopleBlock(people: PeopleRows): string {
	return [
		people.author ? `Author: ${people.author}` : '',
		`Reviewers: ${people.reviewers.join(', ') || '(none)'}`,
		`Assignees: ${people.assignees.join(', ') || '(none)'}`,
		people.labels.length ? `Labels: ${people.labels.join(', ')}` : '',
		people.milestone ? `Milestone: ${people.milestone}` : '',
		people.draft ? 'Status: draft' : ''
	]
		.filter(Boolean)
		.join('\n');
}

/** Logins or names from a list of host user rows (`login`, `username` or `name`). */
export function names(value: unknown): string[] {
	if (!Array.isArray(value)) return [];

	return value.flatMap((item) => {
		const row = item as Record<string, unknown> | null;
		const name = row?.username ?? row?.login ?? row?.name;

		return typeof name === 'string' ? [name] : [];
	});
}

/** Label names from either plain strings or `{ name }` rows. */
export function labelNames(value: unknown): string[] {
	if (!Array.isArray(value)) return [];

	return value.flatMap((item) => {
		if (typeof item === 'string') return [item];

		const name = (item as { name?: unknown } | null)?.name;

		return typeof name === 'string' ? [name] : [];
	});
}

/** A string field, or undefined when the host left it out. */
export function str(value: unknown): string | undefined {
	return typeof value === 'string' && value ? value : undefined;
}

/** A host pull request row in the shape both providers map to. */
interface PrRow {
	number: unknown;
	title: unknown;
	url: unknown;
	state: unknown;
	headRef: unknown;
	baseRef: unknown;
}

/** A `PrRef` from a host row; null when it has no number. */
export function toPrRef(row: PrRow): PrRef | null {
	const number = Number(row.number);

	if (!Number.isInteger(number) || number <= 0) return null;

	const ref: PrRef = {
		number,
		title: String(row.title ?? ''),
		state: String(row.state ?? ''),
		headRef: String(row.headRef ?? ''),
		baseRef: String(row.baseRef ?? '')
	};

	const url = str(row.url);

	if (url) ref.url = url;

	return ref;
}
