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

/** A scripted review: queued, then the four steps, then findings, in about half a minute. */
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

/** A claim the scripted reviewers raise, and whether its verifier proves it. */
export interface SampleClaim {
	title: string;
	proven: boolean;
}

/** What a scripted run reads, the claims it checks, and how it ends. */
export interface RunScript {
	/** The changed files the reviewers' plan splits into parts. */
	paths: string[];
	claims: SampleClaim[];
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

/** How many claims the scripted verifiers check at once. */
const AT_ONCE = 2;

function now(): string {
	return new Date().toISOString();
}

/** Sets a task as the server does: it keeps the time it first ran. */
function setTask(run: RunState, task: Omit<ReviewTask, 'updatedAt'>): void {
	const previous = run.progress.tasks[task.id];
	const startedAt = previous?.startedAt ?? (task.status === 'running' ? now() : undefined);

	run.progress.tasks = { ...run.progress.tasks, [task.id]: { ...task, startedAt, updatedAt: now() } };
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

/** The plan as a finished review leaves it, every part done: what the Changes tab's guide reads. */
export function finishedPlan(paths: string[]): ReviewAssignment[] {
	return plan(paths).map((part) => ({ ...part, status: 'done' }));
}

/** A claim's verification task, labelled and worded as the pipeline's. */
/** Each part of the plan as its reviewer's task, and the part itself, in `status`; a done part keeps its claims. */
function setParts(run: RunState, status: 'running' | 'done'): void {
	const parts = run.progress.assignments ?? [];
	const share = Math.ceil(run.claims.length / Math.max(1, parts.length));

	run.progress.assignments = parts.map((part, index) => ({
		...part,
		status,
		...(status === 'done' ? { candidateCount: Math.min(share, run.claims.length - index * share) } : {})
	}));

	for (const part of parts) {
		setTask(run, {
			id: `assignment:${part.id}`,
			label: part.title,
			status,
			message: status === 'done' ? 'Finished' : 'Reading its part',
			kind: 'assignment'
		});
	}
}

function verifyTask(title: string, status: ReviewTask['status'], message: string): Omit<ReviewTask, 'updatedAt'> {
	return { id: `verify:${title}`, label: `Verify: ${title}`, status, message, kind: 'verification' };
}

/** The verifications still at work, the one that started first leading. */
function working(run: RunState): ReviewTask[] {
	return Object.values(run.progress.tasks).filter((task) => task.kind === 'verification' && task.status === 'running');
}

/** Sets a claim's verifier to work, running the claim's test as the review's newest tool call. */
function startClaim(run: RunState, task: ReviewTask): void {
	const command = `bun test -t "${task.label.slice('Verify: '.length)}"`;

	setTask(run, { ...task, status: 'running', message: 'Reproducing the finding' });

	run.progress.toolCalls = [
		{
			id: `tool:${task.id}`,
			command: `$ ${command}`,
			status: 'running',
			exitCode: null,
			startedAt: now(),
			input: { action: 'run', command }
		}
	];
}

/** Settles the claim checked longest, proven or dropped as the script says, and starts the next waiting one. */
function settleClaim(run: RunState): boolean {
	const [oldest] = working(run);

	if (oldest) {
		const proven = run.claims.find((claim) => `Verify: ${claim.title}` === oldest.label)?.proven ?? false;

		setTask(run, { ...oldest, status: 'done', message: proven ? 'Verified by a run' : 'Disproved; dropped' });
		note(run, `${oldest.label.slice('Verify: '.length)}: ${proven ? 'reproduced' : 'cleared'}`);
	}

	const next = Object.values(run.progress.tasks).find(
		(task) => task.kind === 'verification' && task.status === 'queued'
	);

	if (next) startClaim(run, next);

	return working(run).length > 0;
}

/** Queues a verification for every claim and starts the first few. */
function beginChecks(run: RunState): void {
	run.progress.stage = 'verify';

	for (const claim of run.claims) setTask(run, verifyTask(claim.title, 'queued', 'Queued for verification'));

	for (const task of Object.values(run.progress.tasks)
		.filter((item) => item.kind === 'verification')
		.slice(0, AT_ONCE)) {
		startClaim(run, task);
	}
}

/** Checks the claims, one settling each step, until none is left. */
const CHECK_STEP: Step = { wait: 900, apply: settleClaim };

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

/** Reading the change and planning its parts, up to the claims the reviewers raise. */
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
				message: `Read ${run.paths.length} files`,
				kind: 'inventory'
			});

			run.progress.stage = 'reviewing';
			run.progress.planVersion = 1;
			run.progress.assignments = plan(run.paths);
			setParts(run, 'running');
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
			run.progress.candidateCount = run.claims.length;
			setParts(run, 'done');
			note(run, 'bun test tests/rate-limit · exit 1');
		}
	}
];

/** The check: every claim queued and the first few at work, then one settles each step. */
const CHECK_STEPS: Step[] = [{ wait: 1200, apply: beginChecks }, CHECK_STEP];

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
			run.review = { ...run.review, status: 'passed', findings: run.ending.findings, summary: run.ending.summary };
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
	if (progress.stage === 'verify') return [CHECK_STEP, ...WRITE_STEPS];

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
