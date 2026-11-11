/**
 * How one step of `recoder init` ended. `done` changed something, `unchanged` found it already in place, `skipped`
 * left something for the person to decide or do, and `failed` could not do what was asked.
 */
export type StepState = 'done' | 'unchanged' | 'skipped' | 'failed';

/** One step of `recoder init`, as it is printed and as a program reads it. JSON-safe. */
export interface InitStep {
	id: 'skill' | 'guidelines' | 'mcp' | 'review-model' | 'machine';
	/** What the step is called in the summary. */
	label: string;
	state: StepState;
	/** What happened, in a few words. */
	detail: string;
	/** The file or folder the step wrote or found; null for a step with none. */
	path: string | null;
	/** What to do about a step that was skipped or failed; null when there is nothing to do. */
	fix: string | null;
}

/** A step that could not do what was asked, with the reason as its detail. */
export function failedStep(step: Pick<InitStep, 'id' | 'label' | 'path'>, detail: string): InitStep {
	return { ...step, state: 'failed', detail, fix: null };
}
