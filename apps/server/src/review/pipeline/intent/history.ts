import { git } from '../../../evidence/git.js';
import {
	clip,
	makeSource,
	MESSAGE_FIELDS,
	namedPull,
	parseMessage,
	sortSources,
	type CommitMessage,
	type NamedPull
} from '../../../forge/context/sources.js';
import type { ChangeModel, ChangedSymbol } from '../change-model/types.js';
import type { IntentSource, PrRef } from './types.js';

const MAX_SYMBOLS = 12;
const COMMITS_PER_SYMBOL = 3;
const MAX_SHAS = 8;
const HISTORY_CHARS = 800;
/** `git log -L` and the walk to a commit's merge read the whole history; a read that takes longer is skipped. */
const LOG_TIMEOUT_MS = 10_000;

/** One commit from `git log`. */
interface LoggedCommit extends CommitMessage {
	sha: string;
	parents: string[];
	author: string;
	at: string;
}

const LOG_FORMAT = `--format=%H%x1f%P%x1f%an%x1f%aI%x1f${MESSAGE_FIELDS}%x1e`;

/** Parses `git log` output written with `LOG_FORMAT`: fields split by 0x1f, records ended by 0x1e. */
function parseLog(output: string): LoggedCommit[] {
	return output.split('\x1e').flatMap((record) => {
		const [sha, parents = '', author = '', at = '', ...message] = record.replace(/^\s+/, '').split('\x1f');

		return sha && /^[0-9a-f]{7,64}$/.test(sha) && message.length
			? [{ sha, parents: parents.split(' ').filter(Boolean), author, at, ...parseMessage(message) }]
			: [];
	});
}

/** `signal`, also aborted once a history read has taken `LOG_TIMEOUT_MS`. */
function bounded(signal: AbortSignal): AbortSignal {
	return AbortSignal.any([signal, AbortSignal.timeout(LOG_TIMEOUT_MS)]);
}

/** Commits on the PR branch itself, which history must skip; empty when the base isn't known. */
async function ownCommits(cwd: string, head: string, base: string | undefined, signal: AbortSignal) {
	if (!base) return new Set<string>();

	const listed = await git(cwd, ['rev-list', `${base}..${head}`], signal);

	return new Set(listed.code === 0 ? listed.stdout.split('\n').filter(Boolean) : []);
}

/** The last commits before this PR that touched a symbol's lines. */
async function symbolCommits(
	cwd: string,
	head: string,
	symbol: ChangedSymbol,
	skip: Set<string>,
	signal: AbortSignal
): Promise<LoggedCommit[]> {
	const range = `-L${symbol.startLine},${symbol.endLine}:${symbol.file}`;

	const logged = await git(
		cwd,
		['log', range, '--no-patch', `-n${COMMITS_PER_SYMBOL + skip.size}`, LOG_FORMAT, head],
		bounded(signal)
	).catch(() => null);

	if (!logged || logged.code !== 0) return [];

	return parseLog(logged.stdout)
		.filter((commit) => !skip.has(commit.sha))
		.slice(0, COMMITS_PER_SYMBOL);
}

/** One commit by sha; null when git can't read it. */
async function readCommit(cwd: string, sha: string, signal: AbortSignal): Promise<LoggedCommit | null> {
	const logged = await git(cwd, ['log', '-1', LOG_FORMAT, sha], signal).catch(() => null);

	return logged?.code === 0 ? (parseLog(logged.stdout)[0] ?? null) : null;
}

/** How an older commit reached the base line. */
interface Landing {
	/** The merge that brought it in; null when it was committed on the line itself. */
	merge: string | null;
	/** The commits that landed with it: the merged side, `first..side`, or the commit alone. */
	range: string;
}

/**
 * How `commit` reached `tip`'s first-parent line. Walking first parents down
 * from `tip` through the commits that descend from it, the walk either reaches
 * the commit, which then sits on the line, or a merge whose first parent no
 * longer descends from it, which took it in on another parent. Null when git
 * can't say, such as a walk that fails or times out, so no landing is reported.
 */
async function landing(cwd: string, commit: LoggedCommit, tip: string, signal: AbortSignal): Promise<Landing | null> {
	const { sha } = commit;
	const alone = { merge: null, range: commit.parents[0] ? `${commit.parents[0]}..${sha}` : sha };

	if (sha === tip) return alone;

	const listed = await git(cwd, ['rev-list', '--ancestry-path', '--parents', `${sha}..${tip}`], bounded(signal)).catch(
		() => null
	);

	if (!listed || listed.code !== 0) return null;

	const parents = new Map(
		listed.stdout
			.split('\n')
			.filter(Boolean)
			.map((line) => {
				const [child, ...rest] = line.split(' ');

				return [child, rest];
			})
	);

	let at = tip;

	while (parents.has(at)) {
		const [first = '', ...others] = parents.get(at) ?? [];

		if (first === sha) return alone;

		if (!parents.has(first)) {
			const side = others.find((parent) => parent === sha || parents.has(parent));

			return side ? { merge: at, range: `${first}..${side}` } : null;
		}

		at = first;
	}

	return null;
}

/** `read` memoized by key, so touches that share a merge read it once. */
function memoized<T>(read: (key: string) => Promise<T>): (key: string) => Promise<T> {
	const started = new Map<string, Promise<T>>();

	return (key) => {
		const known = started.get(key);

		if (known) return known;

		const reading = read(key);

		started.set(key, reading);

		return reading;
	};
}

/** One older commit and the symbols it touched. */
interface Touch {
	commit: LoggedCommit;
	symbols: string[];
}

/** A PR a touched commit landed in, and what that rests on: a host or local forge record, or only a message. */
interface Claim {
	pull: NamedPull;
	basis: 'record' | 'commit message' | 'merge message';
}

/** A touched commit and what is known about how it landed. */
interface Attributed {
	touch: Touch;
	/** Null when no record or message names a PR. */
	claim: Claim | null;
	/** The merge that brought it onto the base line, when it came in through one. */
	merge: LoggedCommit | null;
	/** The commit the landing was read from: that merge, or the commit itself on the line. Absent when git couldn't say. */
	revision?: string;
	/** The commits that landed with it. Absent when git couldn't say. */
	range?: string;
}

/** What `attribute` reads each touched commit's landing with. */
interface Lookup {
	cwd: string;
	/** The full sha of the base line's tip, or null when it can't be resolved. */
	tip: string | null;
	prsForCommit?: (sha: string, signal: AbortSignal) => Promise<PrRef[]>;
	signal: AbortSignal;
}

/**
 * The PR each touched commit landed in, in this order: a host or local forge
 * record for the commit, a record for the merge that brought it in, a PR the
 * commit's message names, a PR the merge's message names. The checkout doesn't
 * know the repo's project path, so only messages that name a PR without one
 * count (`namedPull`). A commit none of these covers keeps no PR, so nothing is
 * ever attributed to a guess.
 */
async function attribute(touches: Touch[], lookup: Lookup): Promise<Attributed[]> {
	const { cwd, tip, signal } = lookup;
	const readMerge = memoized((sha) => readCommit(cwd, sha, signal));

	const recorded = memoized(async (sha): Promise<PrRef | null> => {
		const found = lookup.prsForCommit ? await lookup.prsForCommit(sha, signal).catch(() => []) : [];

		return [...found].sort((a, b) => a.number - b.number)[0] ?? null;
	});

	return Promise.all(
		touches.map(async (touch): Promise<Attributed> => {
			const { commit } = touch;
			const landed = tip ? await landing(cwd, commit, tip, signal) : null;
			const merge = landed?.merge ? await readMerge(landed.merge) : null;
			const record = (await recorded(commit.sha)) ?? (merge && (await recorded(merge.sha)));

			const claims: [NamedPull | null, Claim['basis']][] = [
				[record, 'record'],
				[namedPull(commit, null), 'commit message'],
				[merge && namedPull(merge, null), 'merge message']
			];

			const [pull, basis] = claims.find(([named]) => named) ?? [];

			return {
				touch,
				claim: pull && basis ? { pull, basis } : null,
				merge,
				...(landed ? { revision: landed.merge ?? commit.sha, range: landed.range } : {})
			};
		})
	);
}

function touchLine(touch: Touch): string {
	return `${touch.commit.sha.slice(0, 7)} ${touch.commit.subject} (touched ${touch.symbols.join(', ')})`;
}

/** The ref a touched commit is cited under: its PR, else the merge that brought it in, else the commit. */
function groupRef({ touch, claim, merge }: Attributed): string {
	if (claim) return `pr:#${claim.pull.number}`;

	return merge ? `merge:${merge.sha.slice(0, 7)}` : `commit:${touch.commit.sha.slice(0, 7)}`;
}

/**
 * A PR source's title: `Earlier PR #12: …` for a recorded PR, and one saying
 * which message names it for a PR no record backs, so it never reads as retrieved.
 */
function claimTitle({ pull, basis }: Claim): string {
	const label = basis === 'record' ? `Earlier PR #${pull.number}` : `PR #${pull.number} named in ${basis}`;

	return pull.title ? `${label}: ${pull.title}` : label;
}

/**
 * One source for the commits cited under `ref`, carrying where it was read from
 * and the commits that landed. A recorded item heads a PR group when there is one.
 */
function groupSource(ref: string, items: Attributed[]): IntentSource {
	const { touch, claim, merge, revision, range } = items.find((item) => item.claim?.basis === 'record') ?? items[0];
	const latest = items.map((item) => item.touch.commit.at).sort()[items.length - 1];
	const lines = items.map((item) => touchLine(item.touch));

	if (claim) {
		return makeSource({
			kind: 'pr-history',
			ref,
			url: claim.pull.url,
			title: claimTitle(claim),
			at: latest,
			revision,
			range,
			recorded: claim.basis === 'record',
			text: clip(lines.join('\n'), HISTORY_CHARS)
		});
	}

	const { subject, author, body } = merge ?? touch.commit;

	return makeSource({
		kind: 'pr-history',
		ref,
		title: subject,
		author,
		at: latest,
		revision,
		range,
		text: clip([...lines, body].filter(Boolean).join('\n'), HISTORY_CHARS)
	});
}

/**
 * Names the older commits no retrieved PR record covers, including those whose
 * PR only a message names, so the brief can say their history is unavailable
 * instead of reading a reason into them.
 */
function unavailableSource(items: Attributed[]): IntentSource {
	const shas = items.map((item) => item.touch.commit.sha.slice(0, 7)).sort();

	return makeSource({
		kind: 'pr-history',
		ref: 'history:unavailable',
		title: 'History unavailable',
		text: `No pull request record was retrieved for ${shas.join(', ')}; only their commit and merge messages were read, not a PR description, issue or review discussion.`
	});
}

/** Commits grouped under the PR they landed in, else the merge that brought them in; the rest stand alone. */
function historySources(attributed: Attributed[]): IntentSource[] {
	const groups = new Map<string, Attributed[]>();

	for (const item of attributed) {
		const ref = groupRef(item);

		groups.set(ref, [...(groups.get(ref) ?? []), item]);
	}

	const sources = [...groups].map(([ref, items]) => groupSource(ref, items));
	const unrecorded = attributed.filter((item) => item.claim?.basis !== 'record');

	return unrecorded.length ? [...sources, unavailableSource(unrecorded)] : sources;
}

/**
 * Why the changed code looks the way it does: the last few commits before this
 * PR that touched each modified symbol (`git log -L`), and the pull requests
 * those commits landed in, from the host's records or, when it has none, a PR
 * their commit or merge messages name, titled as such. Each source keeps the
 * revision it was read from and the commits that landed, when git can say;
 * commits no retrieved PR record covers are listed as history unavailable. Added symbols have no history. Best effort: a symbol git
 * can't trace is skipped.
 */
export async function gatherHistory(input: {
	model: ChangeModel | null;
	checkoutPath: string;
	prsForCommit?: (sha: string, signal: AbortSignal) => Promise<PrRef[]>;
	signal: AbortSignal;
	/** The PR head; `HEAD` of the checkout when absent. */
	headSha?: string;
	/** Commits after it are the PR's own and are skipped; older ones joined its first-parent line. */
	mergeBaseSha?: string;
}): Promise<IntentSource[]> {
	const { checkoutPath, signal } = input;
	const head = input.headSha ?? 'HEAD';
	const symbols = (input.model?.symbols ?? []).filter((symbol) => symbol.change === 'modified').slice(0, MAX_SYMBOLS);

	if (!symbols.length || signal.aborted) return [];

	const skip = await ownCommits(checkoutPath, head, input.mergeBaseSha, signal);
	const logged = await Promise.all(symbols.map((symbol) => symbolCommits(checkoutPath, head, symbol, skip, signal)));
	const touches = new Map<string, Touch>();

	symbols.forEach((symbol, index) => {
		for (const commit of logged[index]) {
			if (!touches.has(commit.sha) && touches.size >= MAX_SHAS) continue;

			const touch = touches.get(commit.sha) ?? { commit, symbols: [] };

			if (!touch.symbols.includes(symbol.qualifiedName)) touch.symbols.push(symbol.qualifiedName);
			touches.set(commit.sha, touch);
		}
	});

	if (!touches.size) return [];

	const tip = await git(
		checkoutPath,
		['rev-parse', '--verify', '--quiet', `${input.mergeBaseSha ?? head}^{commit}`],
		signal
	);

	const attributed = await attribute([...touches.values()], {
		cwd: checkoutPath,
		tip: tip.code === 0 ? tip.stdout.trim() : null,
		prsForCommit: input.prsForCommit,
		signal
	});

	return sortSources(historySources(attributed));
}
