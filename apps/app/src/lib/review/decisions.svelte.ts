import { decisionStates, decisionsKey, readDecisions, type DecisionRecord } from './saved-decisions';
import type { DecisionState } from './surface';

/** What a person decided on one review, saved as they go so a reload resumes mid-review. */
export class Decisions {
	records = $state<Record<string, DecisionRecord>>({});
	private key = '';
	private history: { id: string; before: DecisionRecord | undefined }[] = [];

	/** Load the decisions saved for this review at this commit. */
	load(reviewId: string, headSha: string): void {
		this.key = decisionsKey(reviewId, headSha);
		this.history = [];
		this.records = readDecisions(reviewId, headSha);
	}

	/** Each decision's state, with `open` for anything not decided. */
	get states(): Record<string, DecisionState> {
		return decisionStates(this.records);
	}

	stateOf(id: string): DecisionState {
		return this.records[id]?.state ?? 'open';
	}

	noteOf(id: string): string {
		return this.records[id]?.note ?? '';
	}

	/** Decide `id`. Deciding it the same way again changes nothing; Undo is how an item reopens. */
	set(id: string, state: DecisionRecord['state']): void {
		if (this.records[id]?.state === state) return;

		this.history.push({ id, before: this.records[id] });
		this.records = { ...this.records, [id]: { state, note: this.noteOf(id), at: Date.now() } };
		this.save();
	}

	setNote(id: string, note: string): void {
		const record = this.records[id];

		this.records = { ...this.records, [id]: { state: record?.state ?? 'sent', note, at: Date.now() } };
		this.save();
	}

	/** The item the last decision changed, which `undo` would restore. */
	lastChanged(): string | null {
		return this.history.at(-1)?.id ?? null;
	}

	/** Undo the last decision; returns its id, or null when there is nothing to undo. */
	undo(): string | null {
		const last = this.history.pop();

		if (!last) return null;

		const { [last.id]: _current, ...rest } = this.records;

		this.records = last.before ? { ...rest, [last.id]: last.before } : rest;
		this.save();

		return last.id;
	}

	private save(): void {
		try {
			localStorage.setItem(this.key, JSON.stringify(this.records));
		} catch {}
	}
}
