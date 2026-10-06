import type { Obligation } from '@recoder/shared';
import type { ReviewUnit } from '../units.js';

/** The investigator's procedure, after the reviewer contract; `turns` are its model turns, the last `answerTurns` without tools. */
export function investigatorRole(
	obligation: Obligation,
	exec: boolean,
	{ turns, answerTurns }: { turns: number; answerTurns: number }
): string {
	const counterexample = exec
		? 'Write the smallest scratch script or test that imports the changed code from its repository path, calls it with that input and exits non-zero when the contract breaks, then run it. The harness reruns your counterexample command on the merge-base tree with the same scratch files, so base and head see identical inputs. A "confirmed" answer stands only when the run it cites exits non-zero or ends differently on the merge base; otherwise it is recorded as unresolved.'
		: 'Code cannot run in this review, so trace the input through the code instead and cite what you read.';

	return `Role: obligation investigator (${obligation.specialist} specialist). The harness derived one question from a risky change and you must answer it within ${turns} model turns. Read and run in the first ${turns - answerTurns}: on the last ${answerTurns} your tools are refused and you give your answer. You are not reviewing the whole unit and you cannot hand work on: leave "subagents", "unsettled", "answered" and "gaps" empty.

Procedure:
1. Find the contract: the types, tests, docs or comments, and the change's stated intent that say what the code at the location must do. Cite each in "contractEvidence".
2. Partition the inputs that reach the location: below, at and above a boundary, or the equivalent classes (empty, zero, false, normalized and not). Put them in "inputPartition" with what the contract expects for each.
3. Drop inputs that upstream validation, types or callers make unreachable; never build a case the code cannot be given. If none is left, answer "not-applicable".
4. Try the input most likely to break the contract. ${counterexample} Record it in "attemptedCounterexample" with the run's evidence id.
5. Answer in "obligation.result": "confirmed" when the counterexample broke the contract (and report that defect in "findings", citing the run), "disproved" when the code met the contract for every reachable class, "not-applicable" when the question does not apply here, "unresolved" when you could not tell within your turns. A behavior change the intent asks for or permits is not a defect.

Your final result has every field above plus a required "obligation" object:
{"contractEvidence":[{"kind":"type"|"test"|"doc"|"intent"|"source","location":string,"note":string}],"inputPartition":[{"label":string,"input":string,"expected":string}],"expectedBehavior":string,"attemptedCounterexample":{"input":string,"evidenceId":string|null,"observed":string}|null,"result":"confirmed"|"disproved"|"not-applicable"|"unresolved","reason":string}`;
}

/** The unit's reason line: the question, where it applies, and the hints toward its contract. */
function obligationReason(obligation: Obligation): string {
	const { location } = obligation;
	const side = location.side === 'old' ? ' (removed line, at the merge base)' : '';

	return [
		`Question (${obligation.trigger}): ${obligation.question}`,
		`Location: ${location.file}:${location.line}${side}${obligation.symbol ? ` in ${obligation.symbol}` : ''}`,
		`Code: ${obligation.code}`,
		...obligation.contractHints.map((hint) => `Hint: ${hint}`)
	].join('\n');
}

/** The investigation's unit: one obligation over the hunk it was derived from. */
export function obligationUnit(obligation: Obligation): ReviewUnit {
	return {
		id: obligation.id,
		title: `Obligation: ${obligation.question} (${obligation.location.file}:${obligation.location.line})`,
		reason: obligationReason(obligation),
		scope: [{ path: obligation.location.file, hunkIds: [obligation.hunkId] }]
	};
}
