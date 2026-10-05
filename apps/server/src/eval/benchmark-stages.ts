import type { CandidateOutcome, StopStage } from '../review/pipeline/candidate-outcome';
import type { LabeledDefect, PrScore } from './benchmark-score';
import type { EvalFinding } from './metrics';

/** A review candidate as the eval keeps it: the finding, and how far it got. */
export type PoolCandidate = EvalFinding & CandidateOutcome;

/** Where a defect's best candidate stopped; `consolidation` when it was verified and still no shown finding reported it. */
type StoppedAt = StopStage | 'consolidation';

/** How far one planted defect got in one run. Each stage includes the one after it. */
export interface DefectStage {
	/** Some candidate, dropped or held back included, reports it. */
	found: boolean;
	/** A verified candidate reports it, or a shown finding does. */
	verified: boolean;
	/** A shown finding reports it. */
	published: boolean;
	/** For a defect found but not published, the stage that stopped its best candidate. */
	stoppedAt?: StoppedAt;
	reason?: string;
}

/** The defects of every run that kept its candidates, counted by how far they got. */
export interface StageTotals {
	planted: number;
	found: number;
	verified: number;
	published: number;
	/** Defects found but not published, by the stage that stopped them. */
	stoppedAt: Record<string, number>;
}

/** The judge's score for a set of findings against the PR's defects. */
type Judged = (findings: readonly EvalFinding[]) => Promise<PrScore>;

/**
 * How far each defect got, from the judge's matches over every candidate and
 * over the verified ones alone, and the shown findings' score. The judge
 * names one best candidate per defect, so a dropped duplicate can win over a
 * verified one; judging the verified ones apart keeps "verified" honest.
 */
export function defectStages(
	defects: readonly LabeledDefect[],
	pool: readonly PoolCandidate[],
	scores: { all: PrScore; verified: PrScore; published: PrScore }
): Record<string, DefectStage> {
	const verifiedPool = pool.filter((candidate) => candidate.verified);
	const stages: Record<string, DefectStage> = {};

	for (const { id } of defects) {
		const published = id in scores.published.found;
		const proven = id in scores.verified.found ? verifiedPool[scores.verified.found[id]!] : undefined;
		const raised = id in scores.all.found ? pool[scores.all.found[id]!] : undefined;
		const best = proven ?? raised;

		stages[id] = {
			found: published || best !== undefined,
			verified: published || proven !== undefined || raised?.verified === true,
			published,
			...(!published && best ? { stoppedAt: best.stage ?? 'consolidation', reason: best.reason ?? undefined } : {})
		};
	}

	return stages;
}

/** Judges a run's candidates and places each planted defect on the stage it reached. */
export async function judgeStages(
	defects: readonly LabeledDefect[],
	pool: readonly PoolCandidate[],
	published: PrScore,
	judge: Judged
): Promise<Record<string, DefectStage>> {
	const [all, verified] = await Promise.all([judge(pool), judge(pool.filter((candidate) => candidate.verified))]);

	return defectStages(defects, pool, { all, verified, published });
}

/** Sums the stages of every run that kept its candidates. */
export function stageTotals(
	runs: readonly { defects: readonly LabeledDefect[]; stages: Record<string, DefectStage> }[]
): StageTotals {
	const totals: StageTotals = { planted: 0, found: 0, verified: 0, published: 0, stoppedAt: {} };

	for (const { defects, stages } of runs) {
		for (const { id } of defects) {
			const stage = stages[id];

			if (!stage) continue;

			totals.planted++;
			if (stage.found) totals.found++;
			if (stage.verified) totals.verified++;
			if (stage.published) totals.published++;
			if (stage.stoppedAt) totals.stoppedAt[stage.stoppedAt] = (totals.stoppedAt[stage.stoppedAt] ?? 0) + 1;
		}
	}

	return totals;
}
