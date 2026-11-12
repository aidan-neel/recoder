import { candidateFromDetector, type CandidateFinding } from '../consolidate.js';
import type { DetectorResult } from '../detectors/types.js';
import { publishCandidates, type ReviewRun } from './context.js';

/**
 * Detector results join as candidates already proven by the check that found
 * them, except suspected ones, which get a verifier like any other. One a
 * resumed review already holds is not added twice.
 */
export function addDetections(run: ReviewRun, results: DetectorResult[]): void {
	const ctx = { inventory: run.inventory, evidence: run.evidence, changeModel: run.changeModel, ledger: run.ledger };

	for (const result of results) {
		const candidate = candidateFromDetector(result, { candidateId: `c${run.nextCandidate}` }, ctx);

		if (run.candidates.some((held) => sameDetection(held, candidate))) continue;

		run.nextCandidate++;
		run.candidates.push(candidate);
		run.verifying?.add(candidate);
	}

	publishCandidates(run);
}

function sameDetection(held: CandidateFinding, candidate: CandidateFinding): boolean {
	return (
		held.agent === candidate.agent &&
		held.file === candidate.file &&
		held.line === candidate.line &&
		held.title === candidate.title
	);
}
