import {
	emptyReviewProgress,
	REVIEW_CANCELLED,
	type Finding,
	type Review,
	type ReviewAssignment,
	type ReviewProgress,
	type ReviewTask
} from '@recoder/shared';

/** Where a scripted run sends each step: the review and its progress as they now stand. */
export type RunPublish = (review: Review, progress: ReviewProgress) => void;

/** A scripted review: queued, then the four steps, then findings, in about twenty seconds. */
export interface SampleRun {
	pause: () => void;
	resume: () => void;
	cancel: () => void;
}

/** What the run ends with. */
export interface RunEnding {
	findings: Finding[];
	summary: string;
}

interface Step {
	/** Milliseconds after the step before it. */
	wait: number;
	apply: (run: RunState) => void;
}

interface RunState {
	review: Review;
	progress: ReviewProgress;
	paths: string[];
	ending: RunEnding;
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

const STEPS: Step[] = [
	{
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
	},
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
 * change, plans parts over `paths`, raises and checks claims, and passes with
 * `ending`. Each step goes to `publish`. Nothing runs until it is called.
 */
export function playSampleRun(review: Review, paths: string[], ending: RunEnding, publish: RunPublish): SampleRun {
	const run: RunState = { review, progress: emptyReviewProgress(review.id), paths, ending };
	let next = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;

	/** Publishes a copy, since the next step writes to the run's own progress. */
	function send(): void {
		run.progress = { ...run.progress, sequence: run.progress.sequence + 1, updatedAt: now() };
		run.review = { ...run.review, updatedAt: now() };
		publish(run.review, { ...run.progress });
	}

	function schedule(): void {
		const step = STEPS[next];

		if (!step) return;

		timer = setTimeout(() => {
			step.apply(run);
			next += 1;
			send();
			schedule();
		}, step.wait);
	}

	function hold(): void {
		if (timer) clearTimeout(timer);

		timer = null;
	}

	schedule();

	return {
		pause() {
			hold();
			run.progress.paused = true;
			send();
		},

		resume() {
			run.progress.paused = false;
			send();
			schedule();
		},

		cancel() {
			hold();
			run.review = { ...run.review, status: 'failed', summary: REVIEW_CANCELLED };
			send();
		}
	};
}
