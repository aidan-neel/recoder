import type { ObligationAnswer } from './obligations';

/**
 * One reviewer's answer to one brief question, in the evidence shape of an
 * obligation answer (#66): the source it traced in `contractEvidence`, the
 * command it ran in `attemptedCounterexample`, and the runs it cited.
 */
export interface BriefQuestionAnswer extends Pick<
	ObligationAnswer,
	'contractEvidence' | 'attemptedCounterexample' | 'result' | 'reason' | 'evidenceIds'
> {
	/** The lens assignment or follow-up subagent that gave it. */
	owner: string;
	/** The candidates it reported that name the question; a confirmed answer holds while one of them stands. */
	candidateIds: string[];
}

/** A subagent sent to settle a brief question, or why none could be. */
export interface BriefQuestionFollowUp {
	/** The subagent's assignment id; null when none was planned. */
	unitId: string | null;
	/** Why it did not run: set at planning when none was planned, and in the report when the subagent did not finish. */
	notRun?: string;
}

/** A brief question as a review stores it, with every answer and follow-up it got; its result is derived, never stored. */
export interface BriefQuestion {
	/** `Q3`, as the brief numbered it. */
	id: string;
	question: string;
	/** The assignments shown it whose answer was due, in the order they finished. */
	owners: string[];
	/** Where the brief pinned it: the changed line, its declaration and the lines a reader should open. */
	source: { file: string; line: number; symbol?: string; range?: { start: number; end: number }; revision?: string };
	answers: BriefQuestionAnswer[];
	followUps: BriefQuestionFollowUp[];
}

/** A question is settled one way or the other, or still open; "not applicable" closes nothing. */
export type BriefQuestionResult = 'confirmed' | 'disproved' | 'unresolved';

/**
 * The behavior a review investigated, through its brief's questions, kept
 * apart from the code coverage of `CoverageSummary`.
 */
export interface BriefQuestionReport {
	counts: Record<BriefQuestionResult, number> & {
		asked: number;
		/** Answers that were outside their reviewer's scope; they close nothing. */
		notApplicable: number;
		/** Follow-up subagents that finished, and those that were not planned or did not finish. */
		followUpsRun: number;
		followUpsNotRun: number;
	};
	questions: (BriefQuestion & { result: BriefQuestionResult; reason: string })[];
}
