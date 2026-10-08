import type { BriefQuestion } from '@recoder/shared';
import { EvidenceStore, type EvidenceRecord } from '../../../src/evidence/evidence';
import type { CandidateFinding } from '../../../src/review/pipeline/consolidate';
import type { CodeClaim } from '../../../src/review/pipeline/intent/types';
import { buildInventory } from '../../../src/review/pipeline/inventory';
import { recordReply, type QuestionReply } from '../../../src/review/pipeline/question-ledger';
import type { ReplyAnswer } from '../../../src/review/pipeline/reviewer-questions';

/** A brief question at `line` of `src/a.ts`. */
export const question = (id: string, line: number, text = `Does ${id} hold?`): CodeClaim => ({
	id,
	text,
	file: 'src/a.ts',
	line
});

/** A candidate that passed validation and that no verifier has settled yet, unless `over` says otherwise. */
export function candidate(candidateId: string, over: Partial<CandidateFinding> = {}): CandidateFinding {
	return { candidateId, valid: true, file: 'src/a.ts', line: 2, ...over } as CandidateFinding;
}

/** An evidence store holding a read of `src/a.ts` (`ev_read`) and a run of a repro (`ev_run`). */
function evidenceStore(): EvidenceStore {
	const evidence = new EvidenceStore(null, buildInventory(''), 1000);

	const records: EvidenceRecord[] = [
		{ id: 'ev_read', revision: 'head', path: 'src/a.ts', startLine: 1, endLine: 10, content: '1|x', truncated: false },
		{
			id: 'ev_run',
			revision: 'head',
			path: '',
			startLine: 0,
			endLine: 0,
			content: 'parse("") returned []',
			truncated: false,
			kind: 'run',
			command: 'bun repro.ts',
			exitCode: 0
		}
	];

	for (const record of records) evidence.records.set(record.id, record);

	return evidence;
}

/** A source trace through the read of `src/a.ts`. */
export const TRACE = [
	{ kind: 'source' as const, location: 'src/a.ts:2', note: 'The caller rejects an empty string first.' }
];

/** A counterexample tried by the repro run. */
export const TRIED = { input: '""', evidenceId: 'ev_run', observed: 'returned []' };

/** An answer to `questionId`, with no evidence unless `over` adds some. */
export function answer(
	questionId: string,
	outcome: ReplyAnswer['outcome'],
	over: Partial<ReplyAnswer> = {}
): ReplyAnswer {
	return { questionId, outcome, note: 'n', contractEvidence: [], attemptedCounterexample: null, ...over };
}

/** `owner`'s reply on the questions it was `shown`, which are the whole brief unless `over` says otherwise. */
export function reply(owner: string, shown: CodeClaim[], over: Partial<QuestionReply> = {}): QuestionReply {
	return { owner, shown, brief: shown, answered: [], unsettled: [], findings: [], ...over };
}

/** The stored questions after each reply is recorded in turn, against `evidenceStore()`. */
export function recorded(...replies: QuestionReply[]): BriefQuestion[] {
	const records: BriefQuestion[] = [];
	const evidence = evidenceStore();

	for (const entry of replies) recordReply(records, entry, evidence);

	return records;
}
