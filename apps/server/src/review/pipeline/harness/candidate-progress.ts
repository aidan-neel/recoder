import { findingTier, type ReviewCandidate } from '@recoder/shared';
import type { CandidateFinding } from '../consolidate.js';
import type { HarnessEvents } from './types.js';

type Transition = Pick<ReviewCandidate, 'state' | 'verifierId' | 'dropStage' | 'message' | 'settledAt' | 'mergedInto'>;

/** Emits only lifecycle changes; task and model progress are reported separately. */
export class CandidateProgress {
	private readonly entries: Map<string, ReviewCandidate>;

	constructor(
		private readonly emit: HarnessEvents['onCandidate'],
		saved: readonly ReviewCandidate[] = []
	) {
		this.entries = new Map(saved.map((candidate) => [candidate.id, candidate]));
	}

	raise(candidate: CandidateFinding): void {
		if (this.entries.has(candidate.candidateId)) return;

		this.publish(candidate, { state: 'raised' });
	}

	verify(candidate: CandidateFinding, verifierId: string): void {
		this.publish(candidate, { state: 'verifying', verifierId });
	}

	settle(candidate: CandidateFinding, message?: string, verifierId = this.laneOf(candidate)): void {
		const state = !candidate.valid ? 'dropped' : candidate.verification?.status === 'verified' ? 'proven' : 'unproven';
		const previous = this.entries.get(candidate.candidateId);

		if (message === undefined && (previous?.state === state || previous?.state === 'merged')) return;

		this.publish(candidate, {
			state,
			verifierId,
			message: message ?? candidate.dropReason ?? candidate.verification?.reason,
			dropStage: state === 'dropped' && !verifierId ? candidate.dropStage : undefined,
			settledAt: new Date().toISOString()
		});
	}

	laneOf(candidate: CandidateFinding): string | undefined {
		return this.entries.get(candidate.candidateId)?.verifierId;
	}

	merge(candidate: CandidateFinding, lead: CandidateFinding): void {
		const entry = this.entries.get(candidate.candidateId);

		if (!entry) return;

		this.publish(candidate, {
			state: 'merged',
			verifierId: entry.verifierId,
			message: entry.message,
			mergedInto: lead.candidateId,
			settledAt: new Date().toISOString()
		});
	}

	private publish(candidate: CandidateFinding, change: Transition): void {
		const id = candidate.candidateId;
		const previous = this.entries.get(id);

		if (
			previous?.state === change.state &&
			previous.verifierId === change.verifierId &&
			previous.mergedInto === change.mergedInto &&
			previous.message === change.message
		)
			return;

		const entry: ReviewCandidate = {
			id,
			title: candidate.title || candidate.file,
			path: candidate.file,
			line: candidate.line,
			tier: findingTier(candidate),
			raisedBy: candidate.assignmentId,
			raisedAt: previous?.raisedAt ?? new Date().toISOString(),
			...change
		};

		this.entries.set(id, entry);
		this.emit?.(entry);
	}
}
