import { git } from '../../../evidence/git.js';
import { clip, makeSource, sortSources } from '../../../forge/context/sources.js';
import type { ChangeModel, ChangedSymbol } from '../change-model/types.js';
import type { IntentSource, PrRef } from './types.js';

const MAX_SYMBOLS = 12;
const COMMITS_PER_SYMBOL = 3;
const MAX_SHAS = 8;
const HISTORY_CHARS = 800;
/** `git log -L` walks the whole history; a symbol that takes longer than this is skipped. */
const LOG_TIMEOUT_MS = 10_000;

/** One commit from `git log`. */
interface LoggedCommit {
	sha: string;
	author: string;
	at: string;
	subject: string;
	body: string;
}

const LOG_FORMAT = '--format=%H%x1f%an%x1f%aI%x1f%s%x1f%b%x1e';

/** Parses `git log` output written with `LOG_FORMAT`: fields split by 0x1f, records ended by 0x1e. */
function parseLog(output: string): LoggedCommit[] {
	return output.split('\x1e').flatMap((record) => {
		const [sha, author, at, subject, body] = record.replace(/^\s+/, '').split('\x1f');

		return sha && /^[0-9a-f]{7,64}$/.test(sha) && subject !== undefined
			? [{ sha, author: author ?? '', at: at ?? '', subject, body: (body ?? '').trim() }]
			: [];
	});
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
	const bounded = AbortSignal.any([signal, AbortSignal.timeout(LOG_TIMEOUT_MS)]);

	const logged = await git(
		cwd,
		['log', range, '--no-patch', `-n${COMMITS_PER_SYMBOL + skip.size}`, LOG_FORMAT, head],
		bounded
	).catch(() => null);

	if (!logged || logged.code !== 0) return [];

	return parseLog(logged.stdout)
		.filter((commit) => !skip.has(commit.sha))
		.slice(0, COMMITS_PER_SYMBOL);
}

/** One older commit and the symbols it touched. */
interface Touch {
	commit: LoggedCommit;
	symbols: string[];
}

function touchLine(touch: Touch): string {
	return `${touch.commit.sha.slice(0, 7)} ${touch.commit.subject} (touched ${touch.symbols.join(', ')})`;
}

/** Commits grouped under the PR they landed in; commits with no known PR stand alone. */
function historySources(touches: Touch[], prs: Map<string, PrRef | null>): IntentSource[] {
	const byPr = new Map<number, { pr: PrRef; touches: Touch[] }>();
	const sources: IntentSource[] = [];

	for (const touch of touches) {
		const pr = prs.get(touch.commit.sha);

		if (pr) {
			const group = byPr.get(pr.number) ?? { pr, touches: [] };

			group.touches.push(touch);
			byPr.set(pr.number, group);
			continue;
		}

		sources.push(
			makeSource({
				kind: 'pr-history',
				ref: `commit:${touch.commit.sha.slice(0, 7)}`,
				title: touch.commit.subject,
				author: touch.commit.author,
				at: touch.commit.at,
				text: clip([touchLine(touch), touch.commit.body].filter(Boolean).join('\n'), HISTORY_CHARS)
			})
		);
	}

	for (const { pr, touches: grouped } of byPr.values()) {
		const latest = grouped.map((touch) => touch.commit.at).sort()[grouped.length - 1];

		sources.push(
			makeSource({
				kind: 'pr-history',
				ref: `pr:#${pr.number}`,
				url: pr.url,
				title: `Earlier PR #${pr.number}: ${pr.title}`,
				at: latest,
				text: clip(grouped.map(touchLine).join('\n'), HISTORY_CHARS)
			})
		);
	}

	return sources;
}

/**
 * Why the changed code looks the way it does: the last few commits before this
 * PR that touched each modified symbol (`git log -L`), and the pull requests
 * those commits landed in. Added symbols have no history. Best effort: a symbol
 * git can't trace is skipped.
 */
export async function gatherHistory(input: {
	model: ChangeModel | null;
	checkoutPath: string;
	prsForCommit?: (sha: string, signal: AbortSignal) => Promise<PrRef[]>;
	signal: AbortSignal;
	/** The PR head; `HEAD` of the checkout when absent. */
	headSha?: string;
	/** Commits after it are the PR's own and are skipped. */
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

	const prs = new Map<string, PrRef | null>();

	await Promise.all(
		[...touches.keys()].map(async (sha) => {
			const found = input.prsForCommit ? await input.prsForCommit(sha, signal).catch(() => []) : [];

			prs.set(sha, [...found].sort((a, b) => a.number - b.number)[0] ?? null);
		})
	);

	return sortSources(historySources([...touches.values()], prs));
}
