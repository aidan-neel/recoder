import {
	emptyReviewProgress,
	REVIEW_CANCELLED,
	type DiffGuide,
	type Finding,
	type Review,
	type ReviewAssignment,
	type ReviewProgress
} from '@recoder/shared';

import {
	castPlan,
	dropInvalid,
	now,
	readBeat,
	setTask,
	verifyBeat,
	type CastFile,
	type SampleClaim
} from './sample-cast';

/**
 * Where a scripted run reads the review and its progress as they now stand,
 * and sends each step. The run keeps no copy of its own, so what the
 * conversation adds in between stays.
 */
interface RunStore {
	findReview: (id: string) => Review;
	progressOf: (id: string) => ReviewProgress;
	publish: (review: Review, progress: ReviewProgress) => void;
}

/** A scripted review: queued, then the four steps, then findings, in about a minute. */
export interface SampleRun {
	pause: () => void;
	resume: () => void;
	cancel: () => void;
}

/** What the run ends with. */
interface RunEnding {
	findings: Finding[];
	summary: string;
}

/** What a scripted run reads, the claims it checks, and how it ends. */
export interface RunScript {
	/** The changed files and their hunks, which the reviewers' plan splits into parts. */
	files: CastFile[];
	claims: SampleClaim[];
	/** The reading guide: the seed it lays down while reading, then the refined one that replaces it. */
	guide: { seed: DiffGuide; refined: DiffGuide };
	ending: RunEnding;
}

interface Step {
	/** Milliseconds after the step before it. */
	wait: number;
	/** Takes the step; a step that returns true runs again before the next. */
	apply: (run: RunState) => boolean | void;
}

interface RunState extends RunScript {
	review: Review;
	progress: ReviewProgress;
}

function note(run: RunState, message: string): void {
	run.progress.activity = [...run.progress.activity, { sequence: run.progress.sequence, message, at: now() }];
}

/** The plan as a finished review leaves it, one part per pair of files, every part done: what the Changes tab's guide reads. */
export function finishedPlan(paths: string[]): ReviewAssignment[] {
	const titles = ['The core change', 'Where it is wired in', 'Tests and docs'];

	return titles.map((title, index) => ({
		id: `part-${index + 1}`,
		role: 'reviewer',
		title,
		reason: 'These files change together, so they read best side by side.',
		status: 'done',
		scope: paths.slice(index * 2, index * 2 + 2).map((path) => ({ path, hunkIds: [] }))
	}));
}

/** Each reviewer's task in `status`, as the plan's parts stand. */
function setPartTasks(run: RunState, status: 'running' | 'done'): void {
	for (const part of run.progress.assignments ?? []) {
		if (part.askedBy) continue;

		setTask(run, {
			id: `assignment:${part.id}`,
			label: part.title,
			status,
			message: status === 'done' ? 'Finished' : 'Reading its part',
			kind: 'assignment'
		});
	}
}

/** The step that takes a queued review to running. */
const START_STEP: Step = {
	wait: 900,
	apply: (run) => {
		run.review = { ...run.review, status: 'running', startedAt: now() };
		run.progress.stage = 'checkout';
		run.progress.orchestratorModel = 'grok-4.6';

		setTask(run, {
			id: 'fetch',
			label: 'Fetch',
			status: 'running',
			message: 'Fetching the pull request',
			kind: 'checkout'
		});
	}
};

/** The reviewers read, one hunk or search each beat, raising their claims, until all are done. */
const READ_BEAT: Step = { wait: 1000, apply: readBeat };

/** Reading the change, planning its parts, and the reviewers at work, up to the claims they raised. */
const READ_STEPS: Step[] = [
	{
		wait: 1500,
		apply: (run) => {
			setTask(run, {
				id: 'fetch',
				label: 'Fetch',
				status: 'done',
				message: 'Checked out the head commit',
				kind: 'checkout'
			});

			run.progress.stage = 'understand';

			setTask(run, {
				id: 'inventory',
				label: 'Read',
				status: 'running',
				message: 'Reading the changed files',
				kind: 'inventory'
			});
		}
	},
	{
		wait: 2000,
		apply: (run) => {
			setTask(run, {
				id: 'inventory',
				label: 'Read',
				status: 'done',
				message: `Read ${run.files.length} files`,
				kind: 'inventory'
			});

			run.progress.stage = 'reviewing';
			run.progress.planVersion = 1;
			run.progress.assignments = castPlan(run.files);
			run.progress.diffGuide = run.guide.seed;
			setPartTasks(run, 'running');
		}
	},
	READ_BEAT,
	{
		wait: 700,
		apply: (run) => {
			run.progress.candidateCount = run.progress.candidates?.length ?? 0;
			run.progress.diffGuide = run.guide.refined;
			setPartTasks(run, 'done');
			note(run, 'bun test tests/rate-limit · exit 1');
		}
	}
];

/** The check: validation drops what it rejects, then the verifiers take the rest in lanes until none is left. */
const VERIFY_BEAT: Step = { wait: 1100, apply: verifyBeat };

const CHECK_STEPS: Step[] = [
	{
		wait: 1200,
		apply: (run) => {
			run.progress.stage = 'verify';
			dropInvalid(run);
			verifyBeat(run);
		}
	},
	VERIFY_BEAT
];

/** The summary, and the review passes with the script's ending. */
const WRITE_STEPS: Step[] = [
	{
		wait: 900,
		apply: (run) => {
			run.progress.stage = 'consolidation';

			setTask(run, {
				id: 'finalize',
				label: 'Summary',
				status: 'running',
				message: 'Writing the summary',
				kind: 'consolidation'
			});
		}
	},
	{
		wait: 1500,
		apply: (run) => {
			setTask(run, {
				id: 'finalize',
				label: 'Summary',
				status: 'done',
				message: 'Wrote the summary',
				kind: 'consolidation'
			});

			run.progress.outcome = 'complete';

			run.review = {
				...run.review,
				status: 'passed',
				findings: run.ending.findings,
				summary: run.ending.summary,
				diffGuide: run.progress.diffGuide
			};
		}
	}
];

/** Every step of a review that left the queue, up to its findings. */
const WORK_STEPS: Step[] = [...READ_STEPS, ...CHECK_STEPS, ...WRITE_STEPS];

/**
 * Plays a scripted review of `review`, which starts queued: it reads the
 * change, plans parts over the script's paths, raises and checks claims, and
 * passes with its ending. Each step goes to `store`. A review that ran before
 * and was stopped starts over: the steps and claims of that run are dropped.
 */
export function playSampleRun(review: Review, script: RunScript, store: RunStore): SampleRun {
	const run = createRun(review.id, [START_STEP, ...WORK_STEPS], script, store);

	store.publish(store.findReview(review.id), progressAtStart(store.progressOf(review.id)));
	run.resume();

	return run;
}

/** The progress a run starts from: nothing of an earlier run but the conversation. */
function progressAtStart(earlier: ReviewProgress): ReviewProgress {
	const fresh = emptyReviewProgress(earlier.id);

	return earlier.messages ? { ...fresh, messages: earlier.messages } : fresh;
}

/** The steps left for a review that stands where `review` and `progress` do. */
function stepsFrom(review: Review, progress: ReviewProgress): Step[] {
	if (review.status === 'queued') return [START_STEP, ...WORK_STEPS];
	if (progress.stage === 'verify') return [VERIFY_BEAT, ...WRITE_STEPS];
	if (progress.stage === 'reviewing') return [READ_BEAT, ...READ_STEPS.slice(3), ...CHECK_STEPS, ...WRITE_STEPS];

	return WORK_STEPS;
}

/**
 * Takes over a review that was already queued or running when the sample
 * began. Its script waits where the review stands until a person resumes it,
 * then carries on from there.
 */
export function adoptSampleRun(review: Review, script: RunScript, store: RunStore): SampleRun {
	const steps = stepsFrom(review, store.progressOf(review.id));

	return createRun(review.id, steps, script, store);
}

/** A run of `steps` on the review with id `id`; nothing runs until it resumes. */
function createRun(id: string, steps: Step[], script: RunScript, store: RunStore): SampleRun {
	let next = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;

	/** Changes the review and progress as the store holds them now, and sends the result on; true when the step repeats. */
	function change(apply: Step['apply']): boolean {
		const run: RunState = { review: store.findReview(id), progress: { ...store.progressOf(id) }, ...script };
		const again = apply(run) === true;

		store.publish({ ...run.review, updatedAt: now() }, { ...run.progress, updatedAt: now() });

		return again;
	}

	/** Waits for the next step; a run that already waits for one keeps that wait. */
	function schedule(): void {
		const step = steps[next];

		if (timer || !step) return;

		timer = setTimeout(() => {
			timer = null;
			if (!change(step.apply)) next += 1;

			schedule();
		}, step.wait);
	}

	function hold(): void {
		if (timer) clearTimeout(timer);

		timer = null;
	}

	return {
		pause() {
			hold();

			change((run) => {
				run.progress.paused = true;
			});
		},

		resume() {
			if (store.progressOf(id).paused) {
				change((run) => {
					run.progress.paused = false;
				});
			}

			schedule();
		},

		cancel() {
			hold();

			change((run) => {
				run.review = { ...run.review, status: 'failed', summary: REVIEW_CANCELLED };
			});
		}
	};
}
