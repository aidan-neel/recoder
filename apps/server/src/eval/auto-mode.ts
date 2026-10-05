import { modeOfPath, pickMode, type EvalMode } from './change-map';
import { pathsSince, type HarnessRecord, type TreeState } from './harness-tree';

/** The mode an eval runs in, and why: the paths that decided it, or the reason a full run is the fallback. */
export interface ModeChoice {
	mode: EvalMode;
	reason: string;
	decidedBy: string[];
}

const full = (reason: string): ModeChoice => ({ mode: 'full', reason, decidedBy: [] });

/**
 * The cheapest mode that covers what changed since a report. Two trees count:
 * the one the report was written from, for every stage, and the one its
 * reviewers ran on, where only a change that needs reviewers again matters,
 * since a replay report's reviewers are older than its own stages. Anything
 * git cannot say, or a report with no record, is a full run.
 */
export function chooseMode(
	since: HarnessRecord | undefined,
	now: TreeState | null,
	cwd: string,
	paths: typeof pathsSince = pathsSince
): ModeChoice {
	if (!since) return full('the report records no harness commit');
	if (!now) return full('this is not a git checkout');
	if (!since.reviewers) return full('the report does not say which code its reviewers ran on');

	const stages = paths(cwd, since.tree, now);
	const reviewers = paths(cwd, since.reviewers, now);

	if (!stages || !reviewers) return full(`git cannot compare ${since.tree.commit} with this tree`);

	const picked = pickMode([...stages, ...reviewers.filter((path) => modeOfPath(path) === 'full')]);

	return {
		mode: picked.mode,
		reason: picked.decidedBy.length
			? `changed since ${since.tree.commit.slice(0, 8)}`
			: 'nothing changed that needs more',
		decidedBy: picked.decidedBy
	};
}
