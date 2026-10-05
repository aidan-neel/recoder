import { findingKind } from '@recoder/shared';
import { patchFromEdits } from '../../fixes/fix-edits.js';
import { patchApplies } from '../../fixes/patch-check.js';
import { reviewNow } from '../../session/review-control.js';
import { isHeldBack, type CandidateFinding } from '../consolidate.js';
import { pickPatchChecks } from './baseline-checks.js';
import { extendDeadlines, type ReviewRun } from './context.js';

/** At most this many suggested patches are checked per review, most severe first. */
const MAX_PATCH_CHECKS = 12;

/** Patch checks stop starting after this long in all. */
const PATCH_CHECKS_MS = 6 * 60 * 1000;

/** The time one patch's checks may take. */
const PATCH_CHECK_MS = 3 * 60 * 1000;

/** Where the patch is written in the sandbox, as an untracked scratch file. */
export const PATCH_FILE = '.recoder-fix.patch';

const SEVERITY_RANK: Record<string, number> = { error: 0, warning: 1, info: 2 };

/**
 * One check of a patch: apply it and run the check in one command, because
 * the sandbox restores tracked files after every command.
 */
export function patchCheckCommand(check: string): string {
	return `git apply --recount ${PATCH_FILE} && (${check})`;
}

/** Verified quality findings with edits to check, most severe first, then by place. */
function patchTargets(candidates: CandidateFinding[]): CandidateFinding[] {
	return candidates
		.filter(
			(candidate) =>
				candidate.valid &&
				!isHeldBack(candidate) &&
				candidate.verification?.status === 'verified' &&
				findingKind(candidate.category) === 'quality' &&
				candidate.fix?.length &&
				!candidate.patch
		)
		.sort(
			(a, b) =>
				(SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3) ||
				a.file.localeCompare(b.file) ||
				(a.line ?? 0) - (b.line ?? 0) ||
				a.candidateId.localeCompare(b.candidateId, 'en', { numeric: true })
		)
		.slice(0, MAX_PATCH_CHECKS);
}

/**
 * Checks each verified quality finding's suggested edits in the sandbox: the
 * owning packages' type check and lint must pass with the patch applied. A
 * passing patch is attached to the finding; a failing one is dropped and the
 * finding stays. Checks that already failed on the PR head are skipped, since
 * they can't tell a bad patch from an old error; a patch with no check left
 * is not shown. Nothing is attached without a sandbox.
 */
export async function checkPatches(run: ReviewRun): Promise<void> {
	const { workspace } = run;
	const checkout = run.input.revision?.checkoutPath;
	const targets = patchTargets(run.candidates);

	if (!workspace || !checkout || !targets.length) return;

	extendDeadlines(run, Math.min(PATCH_CHECKS_MS, targets.length * PATCH_CHECK_MS));

	const scripts = await workspace.scripts().catch(() => []);
	const setup = await workspace.setup().catch(() => null);
	const failing = new Set(run.baseline.filter((check) => check.exitCode !== 0).map((check) => check.command));
	const started = reviewNow();

	for (const [index, candidate] of targets.entries()) {
		const left = PATCH_CHECKS_MS - (reviewNow() - started);

		if (run.controller.signal.aborted || left < 10_000) break;

		run.task('patches', 'Check suggested fixes', 'running', `Checking fix ${index + 1}/${targets.length}`, {
			kind: 'checks'
		});

		const edits = candidate.fix ?? [];
		const files = [...new Set(edits.map((edit) => edit.file.replace(/^[ab]\//, '')))];
		const checks = pickPatchChecks(scripts, files, setup).filter((check) => !failing.has(check));
		const diff = checks.length ? await patchFromEdits(checkout, edits).catch(() => null) : null;

		if (!diff || !(await patchApplies(checkout, diff))) continue;
		if (await passes(run, candidate, diff, checks, Math.min(left, PATCH_CHECK_MS))) candidate.patch = { diff, checks };
	}

	const shown = targets.filter((candidate) => candidate.patch).length;

	run.task('patches', 'Check suggested fixes', 'done', `${shown} of ${targets.length} fixes passed their checks`, {
		kind: 'checks'
	});
}

/** Whether every check passes with the patch applied, each in its own sandboxed run; stops at the first failure. */
async function passes(
	run: ReviewRun,
	candidate: CandidateFinding,
	diff: string,
	checks: string[],
	budgetMs: number
): Promise<boolean> {
	const owner = `patch:${candidate.candidateId}`;
	const timeoutSec = Math.max(10, Math.floor(budgetMs / checks.length / 1000));

	for (const check of checks) {
		const [written, ran] = await run.evidence.executeRound(
			[
				{ action: 'writeFile', path: PATCH_FILE, content: diff },
				{ action: 'run', command: patchCheckCommand(check), timeoutSec }
			],
			run.controller.signal,
			(tool) => run.events?.onTool?.({ ...tool, role: 'orchestrator' }),
			2,
			owner
		);

		if (!written?.ok || ran?.exitCode !== 0) return false;
	}

	return true;
}
