import { createHash } from 'node:crypto';
import type { EvalFinding } from './metrics';

/** "src/a.ts:10-12": a file, with the line or range when there is one. */
export function location(file: string, line?: number | null, endLine?: number | null): string {
	if (!line) return file;

	return endLine && endLine !== line ? `${file}:${line}-${endLine}` : `${file}:${line}`;
}

/** Everything the judge reads of one finding: where it points and what it says. */
export function judgeInput(finding: EvalFinding) {
	return { at: location(finding.file, finding.line, finding.endLine), title: finding.title, message: finding.message };
}

/**
 * A claim's substance as 16 hex digits: the hash of exactly what the judge
 * reads of it. Two claims with the same hash are the same input to the judge
 * against the same defects, so one verdict holds for both.
 */
export function claimHash(finding: EvalFinding): string {
	return createHash('sha256')
		.update(JSON.stringify(judgeInput(finding)))
		.digest('hex')
		.slice(0, 16);
}

/**
 * One claim as it moves through a review: the candidate's id, the ids of the
 * candidates merged into a published finding, and the hash of its text. Ids
 * are absent from reports older than recording them.
 */
export interface ClaimRef {
	id?: string;
	memberIds?: string[];
	hash: string;
}

/** A finding's claim, with the id it carries and the members merged into it. */
export function claimRef(finding: EvalFinding, id?: string): ClaimRef {
	return {
		...(id ? { id } : {}),
		...(finding.memberIds?.length ? { memberIds: finding.memberIds } : {}),
		hash: claimHash(finding)
	};
}
