import type { BriefQuestion, BriefQuestionAnswer, BriefQuestionResult, ObligationResult } from '@recoder/shared';
import type { EvidenceStore } from '../../evidence/store.js';
import { isNotRun, type CandidateFinding } from './consolidate.js';
import type { CodeClaim } from './intent/types.js';
import type { ReplyAnswer } from './reviewer-questions.js';

/** What one finished reviewer said about the brief's questions. */
export interface QuestionReply {
	/** The assignment that replied: a lens reviewer or a follow-up subagent. */
	owner: string;
	/** The questions it was asked to account for. */
	shown: CodeClaim[];
	/** Every question in the brief, so an answer to one outside its scope is still kept. */
	brief: CodeClaim[];
	answered: ReplyAnswer[];
	unsettled: string[];
	/** Each candidate its findings became, beside the question id the finding named. */
	findings: { questionId?: string | null; candidate: CandidateFinding }[];
}

type Settled = Omit<BriefQuestionAnswer, 'owner'>;

/** A copy of the questions a checkpoint saved; none from one written before they were stored. */
export function restoreQuestions(saved: BriefQuestion[] | undefined): BriefQuestion[] {
	return structuredClone(saved ?? []);
}

/** The stored record of a brief question, added the first time it is needed. */
export function questionRecord(records: BriefQuestion[], claim: CodeClaim): BriefQuestion {
	const found = records.find((record) => record.id === claim.id);

	if (found) return found;

	const { file, line, symbol, range, revision } = claim;

	const record: BriefQuestion = {
		id: claim.id,
		question: claim.text,
		owners: [],
		source: { file, line, ...(symbol && { symbol }), ...(range && { range }), ...(revision && { revision }) },
		answers: [],
		followUps: []
	};

	records.push(record);

	return record;
}

/** The ids of the questions a follow-up subagent was sent to settle. */
export function followedUpBy(records: BriefQuestion[], unitId: string): string[] {
	return records.filter((record) => record.followUps.some((entry) => entry.unitId === unitId)).map(({ id }) => id);
}

function settled(result: ObligationResult, reason: string): Settled {
	return { result, reason, contractEvidence: [], attemptedCounterexample: null, evidenceIds: [], candidateIds: [] };
}

/** "src/a.ts:12" and "src/a.ts:12-14 note" name src/a.ts; null when the location names no line. */
function tracedFile(location: string): string | null {
	return /^(.+?):\d+/.exec(location.trim())?.[1] ?? null;
}

/**
 * A disproof with only the evidence that holds up: trace entries with a note
 * on a file the review read, and a cited run that exists. With neither, or no
 * note, it disproves nothing and is kept as unresolved, saying why, with
 * whatever evidence did hold up.
 */
function disproof(answer: ReplyAnswer, evidence: EvidenceStore): Settled {
	const records = [...evidence.records.values()];
	const read = new Set(records.filter((record) => record.kind !== 'run').map((record) => record.path));
	const trace = answer.contractEvidence.filter((entry) => entry.note && read.has(tracedFile(entry.location) ?? ''));
	const tried = answer.attemptedCounterexample;
	const run = tried?.evidenceId ? evidence.get(tried.evidenceId) : undefined;
	const ran = run?.kind === 'run' ? run : null;

	const held = {
		contractEvidence: trace,
		attemptedCounterexample:
			tried && ran
				? { input: tried.input, command: ran.command ?? null, evidenceId: ran.id, observed: tried.observed }
				: null,
		evidenceIds: ran ? [ran.id] : []
	};

	if (!answer.note.trim() || (!trace.length && !ran)) {
		const why =
			'Disproved without a note, or without a source trace or command result behind it, so it settles nothing.';

		return { ...settled('unresolved', `${why} ${answer.note}`.trim()), ...held };
	}

	return { ...settled('disproved', answer.note), ...held };
}

/** A shown question's answer, held to its evidence: a confirmation needs a finding that names the question. */
function settle(answer: ReplyAnswer, linked: string[], evidence: EvidenceStore): Settled {
	if (answer.outcome === 'disproved') return disproof(answer, evidence);
	if (answer.outcome === 'not-applicable')
		return settled('not-applicable', answer.note || 'Outside the lens of this reviewer.');

	if (!linked.length) {
		return settled(
			'unresolved',
			`Confirmed, but no finding in the reply names ${answer.questionId}, so it settles nothing. ${answer.note}`.trim()
		);
	}

	return { ...settled('confirmed', answer.note || `Reported as ${linked.join(', ')}.`), candidateIds: linked };
}

/** The candidates in a reply whose finding named `questionId`. */
function linkedCandidates(reply: QuestionReply, questionId: string): string[] {
	return reply.findings.filter((entry) => entry.questionId === questionId).map((entry) => entry.candidate.candidateId);
}

/**
 * Each question's answer in one reply. A question it was shown is held to its
 * evidence; a finding that names one it left out of `answered` confirms it,
 * and one it marked unsettled stays unresolved. An answer to a question
 * outside its scope is not applicable, whatever it claimed.
 */
function replyAnswers(reply: QuestionReply, evidence: EvidenceStore): Map<string, Settled> {
	const shown = new Set(reply.shown.map((claim) => claim.id));
	const answers = new Map<string, Settled>();

	for (const answer of reply.answered) {
		if (!reply.brief.some((claim) => claim.id === answer.questionId)) continue;

		answers.set(
			answer.questionId,
			shown.has(answer.questionId)
				? settle(answer, linkedCandidates(reply, answer.questionId), evidence)
				: settled(
						'not-applicable',
						`Answered ${answer.outcome} outside the scope of this reviewer. ${answer.note}`.trim()
					)
		);
	}

	for (const { id } of reply.shown) {
		const linked = linkedCandidates(reply, id);

		if (answers.has(id)) continue;
		if (linked.length)
			answers.set(id, { ...settled('confirmed', `Reported as ${linked.join(', ')}.`), candidateIds: linked });
		else if (reply.unsettled.includes(id))
			answers.set(id, settled('unresolved', 'Could neither confirm nor rule it out.'));
	}

	return answers;
}

/**
 * Records a finished reviewer as an owner of the questions it was shown and
 * keeps its answers, one per question, replacing any it gave before. No
 * answer closes a question here: `questionStatus` decides from the answers
 * and the candidates as they stand.
 */
export function recordReply(records: BriefQuestion[], reply: QuestionReply, evidence: EvidenceStore): void {
	for (const claim of reply.shown) {
		const record = questionRecord(records, claim);

		if (!record.owners.includes(reply.owner)) record.owners.push(reply.owner);
	}

	for (const [id, answer] of replyAnswers(reply, evidence)) {
		const record = questionRecord(
			records,
			reply.brief.find((claim) => claim.id === id)!
		);

		record.answers = [
			...record.answers.filter((entry) => entry.owner !== reply.owner),
			{ owner: reply.owner, ...answer }
		];
	}
}

/** How many reviewers looked at the question and left it unresolved. */
export function unsettledCount(record: BriefQuestion): number {
	return record.answers.filter((answer) => answer.result === 'unresolved').length;
}

/** Why a question with no confirmation that stands and no disproof is still open. */
function openReason(record: BriefQuestion): string {
	const fallen = record.answers.flatMap((answer) => (answer.result === 'confirmed' ? answer.candidateIds : []));
	const unsettled = unsettledCount(record);

	if (fallen.length) {
		return `Reopened: the finding that confirmed it (${fallen.join(', ')}) failed validation or verification.`;
	}

	if (unsettled) return `Left unresolved by ${unsettled} reviewer${unsettled === 1 ? '' : 's'}.`;
	if (record.answers.length) return 'Every answer came from a reviewer it was outside the scope of.';

	return 'No reviewer answered it.';
}

/**
 * Whether a question is settled, from its answers and the candidates as they
 * stand: confirmed while a finding that names it stands, else disproved by a
 * supported disproof, else unresolved. A finding stands while validation kept
 * it, no verifier refuted it or left it unproven, and it is not among the
 * `hidden` unproven ones; a confirmation whose every finding falls no longer
 * counts, so the question reopens.
 */
export function questionStatus(
	record: BriefQuestion,
	candidates: CandidateFinding[],
	hidden: CandidateFinding[] = []
): { result: BriefQuestionResult; reason: string } {
	const fallen = new Set(hidden.map((candidate) => candidate.candidateId));

	const standing = new Set(
		candidates
			.filter(
				(candidate) => candidate.valid && (candidate.verification?.status !== 'unverified' || isNotRun(candidate))
			)
			.map((candidate) => candidate.candidateId)
			.filter((id) => !fallen.has(id))
	);

	const confirmed = record.answers.find(
		(answer) => answer.result === 'confirmed' && answer.candidateIds.some((id) => standing.has(id))
	);

	if (confirmed) return { result: 'confirmed', reason: confirmed.reason };

	const disproved = record.answers.find((answer) => answer.result === 'disproved');

	if (disproved) return { result: 'disproved', reason: disproved.reason };

	return { result: 'unresolved', reason: openReason(record) };
}
