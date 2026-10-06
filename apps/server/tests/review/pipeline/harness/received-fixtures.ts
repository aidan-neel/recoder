import type { Finding, ReviewToolCall } from '@recoder/shared';
import { EvidenceStore } from '../../../../src/evidence/evidence';
import type { EvidenceRecord, ToolResult } from '../../../../src/evidence/types';
import type { CandidateFinding } from '../../../../src/review/pipeline/consolidate';
import { buildInventory } from '../../../../src/review/pipeline/inventory';

export function record(
	id: string,
	path: string,
	startLine: number,
	endLine: number,
	over: Partial<EvidenceRecord> = {}
): EvidenceRecord {
	return { id, revision: 'head' as const, path, startLine, endLine, content: 'code', truncated: false, ...over };
}

/** An evidence store holding exactly these records. */
export function storeOf(diff: string, records: EvidenceRecord[]): EvidenceStore {
	const evidence = new EvidenceStore(null, buildInventory(diff), 1000);

	evidence.restore({ records, seq: records.length, toolSeq: 0 });

	return evidence;
}

/** A finished retrieval report; `cut` marks a bound cut. */
export function tool(
	assignmentId: string | undefined,
	action: string,
	over: Partial<ReviewToolCall> & { evidenceId?: string; cut?: true } = {}
): ReviewToolCall {
	const { evidenceId, cut, ...rest } = over;

	return {
		id: `t-${action}-${evidenceId ?? 'none'}`,
		...(assignmentId ? { assignmentId, role: 'reviewer' } : {}),
		command: action,
		status: 'done',
		exitCode: 0,
		startedAt: '2026-01-01T00:00:00.000Z',
		input: { action, path: 'src/a.ts' },
		result: {
			content: 'code',
			truncated: Boolean(cut),
			...(cut ? { cut } : {}),
			...(evidenceId ? { evidenceId } : {})
		},
		...rest
	};
}

export function candidate(id: string, assignmentId: string, evidenceIds: string[]): CandidateFinding {
	return { id, candidateId: id, assignmentId, evidenceIds } as unknown as CandidateFinding;
}

export function published(id: string, memberIds?: string[]): Finding {
	return { id, ...(memberIds ? { memberIds } : {}) } as unknown as Finding;
}

/** One file's initial patch page as the reviewer got it: the hunks it delivered, and whether a budget cut it. */
export function patchPage(path: string, evidenceId: string, hunkIds: string[], truncated = false): ToolResult {
	return { action: 'readDiff', ok: true, path, content: 'patch', truncated, hunkIds, evidenceId };
}
