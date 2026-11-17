import { createHash } from 'node:crypto';
import { GUIDELINES_PATHS } from '@recoder/shared';
import { git, readBlob } from '../../../evidence/git.js';
import type { ReviewRevision } from '../../../evidence/evidence.js';
import { INSTRUCTION_PATHS } from '../../pipeline/harness/understand.js';
import { hasRules, readGlobalGuidelines } from '../guidelines.js';
import { instructionFilesFor } from '../instruction-scope.js';

/** One text the ledger distills, under the path its rules cite and the base revision it was read from. */
export interface LedgerSource {
	path: string;
	text: string;
	revision?: string;
}

/** The path rules from the owner's Settings guidelines cite; it is not a repo file. */
export const GLOBAL_SOURCE = 'Recoder guidelines';

/** Root files other agents and editors read, after the shared instruction files. */
export const EXTRA_ROOT_PATHS = ['GEMINI.md', '.cursorrules', '.windsurfrules', '.github/copilot-instructions.md'];

/** Instruction files a package or folder can carry for its own code. */
export const NESTED_NAMES = new Set(['AGENTS.md', 'CLAUDE.md']);

const MAX_NESTED = 6;
const MAX_SOURCE_CHARS = 24_000;
const MAX_TOTAL_CHARS = 80_000;

/** Bumped when the prompt or validation changes, so cached ledgers from the old rules are not reused. */
export const LEDGER_VERSION = 'ledger-v3';

/**
 * Root instruction files first, in the loader's order, then nested ones by
 * path, then the repo's Recoder guidelines (only the file that is the layer,
 * `RECODER.md` over `.recoder/REVIEW.md`); the order rule ids follow.
 */
function orderedPaths(tracked: string[]): string[] {
	const present = new Set(tracked);
	const root = [...INSTRUCTION_PATHS, ...EXTRA_ROOT_PATHS].filter((path) => present.has(path));

	const nested = tracked
		.filter(
			(path) => path.includes('/') && NESTED_NAMES.has(path.slice(path.lastIndexOf('/') + 1)) && !root.includes(path)
		)
		.sort()
		.slice(0, MAX_NESTED);

	const guidelines = GUIDELINES_PATHS.find((path) => present.has(path));

	return [...root, ...nested, ...(guidelines ? [guidelines] : [])];
}

/**
 * The repo's guidelines and instruction files at the PR's base commit, read in full, so a PR can't rewrite the rules
 * it is judged by. With a `RECODER.md`, only the instruction files it names (`instructionFilesFor`).
 */
async function repoSources(revision: ReviewRevision, signal: AbortSignal): Promise<LedgerSource[]> {
	const listed = await git(revision.checkoutPath, ['ls-tree', '-r', '-z', '--name-only', revision.targetSha], signal);

	if (listed.code !== 0) return [];

	const sources: LedgerSource[] = [];

	for (const path of orderedPaths(listed.stdout.split('\0').filter(Boolean))) {
		const blob = await readBlob(revision.checkoutPath, revision.targetSha, path, signal);

		if (blob.ok && blob.text.trim()) {
			sources.push({ path, text: blob.text.slice(0, MAX_SOURCE_CHARS), revision: revision.targetSha });
		}
	}

	const guidelines = sources.find((source) => isGuidelinesPath(source.path));

	const kept = new Set(
		instructionFilesFor(
			guidelines?.text,
			sources.map((source) => source.path)
		)
	);

	return sources.filter((source) => source === guidelines || kept.has(source.path));
}

function isGuidelinesPath(path: string): boolean {
	return (GUIDELINES_PATHS as readonly string[]).includes(path);
}

/** The owner's own guidelines from Settings, once saved; the shipped defaults are about reviewing, not code. */
function globalSource(): LedgerSource[] {
	try {
		const { content, updatedAt } = readGlobalGuidelines();

		return updatedAt && hasRules(content) ? [{ path: GLOBAL_SOURCE, text: content.slice(0, MAX_SOURCE_CHARS) }] : [];
	} catch {
		return [];
	}
}

/** The texts the ledger is distilled from, in rule-id order, within the prompt's size cap. */
export async function readLedgerSources(
	revision: ReviewRevision | null | undefined,
	signal: AbortSignal
): Promise<LedgerSource[]> {
	const sources = [...(revision ? await repoSources(revision, signal) : []), ...globalSource()];
	let total = 0;

	return sources.filter((source) => {
		total += source.text.length;

		return total <= MAX_TOTAL_CHARS;
	});
}

/**
 * The repo's root commits, which every base of the repo shares, so a ledger
 * distilled at an earlier base can be found again. Null when git can't say.
 */
export async function repoLineage(revision: ReviewRevision, signal: AbortSignal): Promise<string | null> {
	const roots = await git(revision.checkoutPath, ['rev-list', '--max-parents=0', revision.targetSha], signal);
	const shas = roots.code === 0 ? roots.stdout.split('\n').filter(Boolean).sort() : [];

	return shas.length ? shas.join(',') : null;
}

/** Hash of the ledger version and every source, the ledger's cache key and `sourcesHash`. */
export function hashSources(sources: LedgerSource[]): string {
	const hash = createHash('sha256').update(LEDGER_VERSION);

	for (const source of sources) hash.update(`\0${source.path}\0${source.text}`);

	return hash.digest('hex');
}
