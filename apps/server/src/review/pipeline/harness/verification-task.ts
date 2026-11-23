import type { FindingVerification } from '@recoder/shared';
import { configForVerifier } from '../../../models/models.js';
import type { CandidateFinding } from '../consolidate.js';
import type { TaskFn } from './types.js';

export interface VerifierTask {
	taskId: string;
	label: string;
	meta: Parameters<TaskFn>[4];
}

export function verifierTask(
	candidate: CandidateFinding,
	model = configForVerifier().model,
	verifierId?: string
): VerifierTask {
	return {
		taskId: `verify:${candidate.candidateId}`,
		label: `Verify: ${candidate.title ?? candidate.file}`,
		meta: {
			kind: 'verification',
			agent: candidate.agent ?? 'reviewer',
			model,
			assignmentId: candidate.assignmentId,
			candidateId: candidate.candidateId,
			verifierId,
			files: [candidate.file]
		}
	};
}

/** The task and candidate share the exact same words for a verdict. */
export function finishVerifierTask(task: TaskFn, { taskId, label, meta }: VerifierTask, message: string): string {
	task(taskId, label, 'done', message, meta);

	return message;
}

/** The task row's last word on a verification. */
export function settledLabel(settled: FindingVerification): string {
	if (settled.status !== 'verified') return 'Could not prove it';
	if (settled.method === 'run') return 'Verified by a run';
	if (settled.method === 'rule') return 'Checked against the rule';
	if (settled.method === 'convention') return 'Checked against the repo';

	return 'Traced through the code';
}
