import type { ReviewRun } from '../harness/context.js';
import { addedLines, compareResults, enclosingSymbol, type AddedLines } from './changed-lines.js';
import { diagnosticResults } from './diagnostics.js';
import { duplicationResults } from './duplication.js';
import { readFilesAt, trackedFiles, type TrackedFile } from './repo-files.js';
import { ruleCheckResults } from './rule-check.js';
import { complexityResults, deadCodeResults } from './symbols.js';
import type { DetectorId, DetectorResult } from './types.js';
import { addedSubclasses, weakInNewTests } from './new-tests.js';
import { readTestFiles, type TestFileVersions } from './test-files.js';
import { typeHintResults } from './type-hints.js';
import { weakenedInFile } from './weakened-tests.js';

const MAX_RESULTS = 40;

/** Diagnostics on added lines are facts, not heuristics, so their cap is wide enough to rarely bind. */
const MAX_DIAGNOSTICS = 150;

/** No one detector fills the cap and crowds out the rest. */
const MAX_PER_DETECTOR = 15;

/** Which results survive the cap first: broken builds, then the repo's own rules, then weakened tests, then the rest. */
const PRIORITY: DetectorId[] = [
	'typecheck',
	'type-hint',
	'rule-check',
	'weakened-tests',
	'weak-new-tests',
	'lint',
	'dead-code',
	'duplication',
	'complexity'
];

/** The PR head's tracked files and the changed files' text there; empty without a checkout or when git fails. */
async function readHead(
	run: ReviewRun,
	added: AddedLines
): Promise<{ tracked: TrackedFile[]; heads: Map<string, string> }> {
	const revision = run.input.revision;

	if (!revision) return { tracked: [], heads: new Map() };

	const signal = run.controller.signal;

	try {
		const tracked = await trackedFiles(revision.checkoutPath, revision.headSha, signal);
		const changed = tracked.filter((file) => added.has(file.path)).map((file) => file.path);

		return { tracked, heads: await readFilesAt(revision.checkoutPath, revision.headSha, changed, signal) };
	} catch {
		return { tracked: [], heads: new Map() };
	}
}

/** A detector's results, or none when it fails: one broken detector never costs the others theirs. */
async function settle(run: ReviewRun, name: DetectorId, detect: () => DetectorResult[] | Promise<DetectorResult[]>) {
	try {
		return await detect();
	} catch (err) {
		run.events?.onLog?.(`The ${name} detector failed: ${err instanceof Error ? err.message : String(err)}`);

		return [];
	}
}

/** At most `MAX_PER_DETECTOR` per detector and `MAX_RESULTS` in all, chosen by priority, then file and line. */
function capResults(results: DetectorResult[]): DetectorResult[] {
	const ranked = [...results].sort(
		(a, b) => PRIORITY.indexOf(a.detector) - PRIORITY.indexOf(b.detector) || compareResults(a, b)
	);

	const counts = new Map<DetectorId, number>();

	const kept = ranked.filter((result) => {
		const count = counts.get(result.detector) ?? 0;

		counts.set(result.detector, count + 1);

		return count < MAX_PER_DETECTOR;
	});

	return kept.slice(0, MAX_RESULTS).sort(compareResults);
}

/** Each result with the symbol that encloses it. */
function withSymbols(run: ReviewRun, results: DetectorResult[]): DetectorResult[] {
	return results.map((result) => ({
		...result,
		symbol: result.symbol ?? enclosingSymbol(run.changeModel, result.file, result.line)
	}));
}

/** The results that survive the cap. */
function finish(run: ReviewRun, results: DetectorResult[]): DetectorResult[] {
	return capResults(withSymbols(run, results));
}

/**
 * The type check and lint diagnostics on the lines this change adds, read
 * from the baseline checks once they have run. Capped apart from the other
 * detectors, which finish long before the checks do.
 */
export function runDiagnostics(run: ReviewRun): DetectorResult[] {
	const results = withSymbols(run, diagnosticResults(run.baseline, addedLines(run.inventory)));

	return results.sort(compareResults).slice(0, MAX_DIAGNOSTICS);
}

/**
 * Hints from the compiler's types on the added lines, read from the installed
 * checkout. Empty without a checkout.
 */
export function runTypeHints(run: ReviewRun): DetectorResult[] {
	const revision = run.input.revision;

	if (!revision) return [];

	return finish(run, typeHintResults(revision.checkoutPath, addedLines(run.inventory)));
}

/**
 * Every deterministic quality check that reads only the change itself:
 * duplicated blocks, unused exports, oversized symbols, mechanical repo
 * rules, test assertions the change weakens and weak ones in tests it adds.
 * None waits for the baseline checks. No model is asked, so the same diff at
 * the same commit always gives the same results, sorted by file, line and
 * detector.
 */
export async function runDetectors(run: ReviewRun): Promise<DetectorResult[]> {
	const added = addedLines(run.inventory);

	if (!added.size && !run.inventory.files.length) return [];

	const { inventory, changeModel, ledger } = run;
	const revision = run.input.revision;
	const { tracked, heads } = await readHead(run, added);

	const tests = await readTestFiles({ inventory, added, revision, signal: run.controller.signal }).catch(
		(): TestFileVersions[] => []
	);

	const results = [
		...(await settle(run, 'dead-code', () => deadCodeResults(changeModel, inventory))),
		...(await settle(run, 'complexity', () => complexityResults(changeModel, added))),
		...(await settle(run, 'rule-check', () => ruleCheckResults(ledger, { inventory, added, heads }))),
		...(await settle(run, 'weakened-tests', () => tests.flatMap(weakenedInFile))),
		...(await settle(run, 'weak-new-tests', () => {
			const subclasses = addedSubclasses(added);

			return tests.flatMap((file) => weakInNewTests(file, subclasses));
		})),
		...(await settle(run, 'duplication', () =>
			revision
				? duplicationResults({
						cwd: revision.checkoutPath,
						headSha: revision.headSha,
						signal: run.controller.signal,
						added,
						heads,
						tracked
					})
				: []
		))
	];

	return finish(run, results);
}
