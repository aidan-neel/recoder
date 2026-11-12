import {
	emptyReviewProgress,
	REVIEW_CANCELLED,
	type Finding,
	type Review,
	type ReviewAssignment,
	type ReviewProgress,
	type ReviewTask
} from '@recoder/shared';

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

/** A scripted review: queued, then the four steps, then findings, in about twenty seconds. */
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

/** What a scripted run reads and how it ends. */
export interface RunScript {
	/** The changed files the reviewers' plan splits into parts. */
	paths: string[];
	ending: RunEnding;
}

interface Step {
	/** Milliseconds after the step before it. */
	wait: number;
	apply: (run: RunState) => void;
}

interface RunState extends RunScript {
	review: Review;
	progress: ReviewProgress;
}

/** How many claims the scripted reviewers raise and the verifiers then check. */
const CLAIMS = 5;

function now(): string {
	return new Date().toISOString();
}

function setTask(run: RunState, task: Omit<ReviewTask, 'updatedAt'>): void {
	run.progress.tasks = { ...run.progress.tasks, [task.id]: { ...task, updatedAt: now() } };
}

function note(run: RunState, message: string): void {
	run.progress.activity = [...run.progress.activity, { sequence: run.progress.sequence, message, at: now() }];
}

/** The reviewers' plan: one part per pair of files. */
function plan(paths: string[]): ReviewAssignment[] {
	const titles = ['The core change', 'Where it is wired in', 'Tests and docs'];

	return titles.map((title, index) => ({
		id: `part-${index + 1}`,
		role: 'reviewer',
		title,
		reason: 'These files change together, so they read best side by side.',
		status: 'running',
		scope: paths.slice(index * 2, index * 2 + 2).map((path) => ({ path, hunkIds: [] }))
	}));
}

function verifyTask(index: number, status: ReviewTask['status']): Omit<ReviewTask, 'updatedAt'> {
	return {
		id: `verify-${index}`,
		label: `Verify claim ${index + 1}`,
		status,
		message: 'Checking the claim',
		kind: 'verification'
	};
}

const VERIFY_STEPS: Step[] = Array.from({ length: CLAIMS }, (_, index) => ({
	wait: 1400,
	apply: (run) => {
		setTask(run, verifyTask(index, 'done'));
		note(run, `Checked claim ${index + 1} of ${CLAIMS}`);
	}
}));

/** The step that takes a queued review to running. */
const START_STEP: Step = {
	wait: 900,
	apply: (run) => {
		run.review = { ...run.review, status: 'running', startedAt: now() };
		run.progress.stage = 'checkout';
		run.progress.orchestratorModel = 'claude-opus-5-5';

		setTask(run, {
			id: 'fetch',
			label: 'Fetch',
			status: 'running',
			message: 'Fetching the pull request',
			kind: 'checkout'
		});
	}
};

/** The steps of a running review, up to its findings. */
const WORK_STEPS: Step[] = [
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
				message: `Read ${run.paths.length} files`,
				kind: 'inventory'
			});

			run.progress.stage = 'reviewing';
			run.progress.planVersion = 1;
			run.progress.assignments = plan(run.paths);
		}
	},
	{
		wait: 2000,
		apply: (run) => {
			run.progress.candidateCount = 2;
			note(run, 'rg -n "refill" src/rate-limit · exit 0');
		}
	},
	{
		wait: 2500,
		apply: (run) => {
			run.progress.candidateCount = CLAIMS;
			run.progress.assignments = run.progress.assignments?.map((part) => ({ ...part, status: 'done' }));
			note(run, 'bun test tests/rate-limit · exit 1');
		}
	},
	{
		wait: 1200,
		apply: (run) => {
			run.progress.stage = 'verify';

			for (let index = 0; index < CLAIMS; index++) setTask(run, verifyTask(index, 'running'));
		}
	},
	...VERIFY_STEPS,
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
			run.review = { ...run.review, status: 'passed', findings: run.ending.findings, summary: run.ending.summary };
		}
	}
];

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

/**
 * Takes over a review that was already queued or running when the sample
 * began. Its script waits where the review stands until a person resumes it.
 */
export function adoptSampleRun(review: Review, script: RunScript, store: RunStore): SampleRun {
	const steps = review.status === 'queued' ? [START_STEP, ...WORK_STEPS] : WORK_STEPS;

	return createRun(review.id, steps, script, store);
}

/** A run of `steps` on the review with id `id`; nothing runs until it resumes. */
function createRun(id: string, steps: Step[], script: RunScript, store: RunStore): SampleRun {
	let next = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;

	/** Changes the review and progress as the store holds them now, and sends the result on. */
	function change(apply: (run: RunState) => void): void {
		const run: RunState = { review: store.findReview(id), progress: { ...store.progressOf(id) }, ...script };

		apply(run);
		store.publish({ ...run.review, updatedAt: now() }, { ...run.progress, updatedAt: now() });
	}

	/** Waits for the next step; a run that already waits for one keeps that wait. */
	function schedule(): void {
		const step = steps[next];

		if (timer || !step) return;

		timer = setTimeout(() => {
			timer = null;
			change(step.apply);
			next += 1;
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
