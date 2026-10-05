import { REVIEW_CANCELLED, type Finding, type Review } from '@recoder/shared';
import {
	cancelReview,
	getReview,
	hiddenFromSummary,
	progressSummary,
	readProgress,
	startReview,
	type ProgressSummary
} from './client';
import type { EvalFinding } from './metrics';
import type { RunOutcome, RunRecord } from './report';

/** How often a running review is polled. */
const POLL_MS = 5000;

/** Polls in a row that may fail (a server restart, a dropped connection) before the eval gives up. */
const MAX_POLL_ERRORS = 6;

/** Where and how one eval review runs. */
export interface RunTarget {
	base: string;
	timeoutMs: number;
	/** Rewrite the progress line in place: only on a terminal running one review at a time. */
	inPlace: boolean;
}

/** The reviews evals are waiting on, so Ctrl-C can stop them instead of leaving them running on the server. */
const inFlight = new Set<string>();

/** Set on Ctrl-C, so a worker freed by a cancelled review doesn't start the next one while the eval exits. */
let stopping = false;

/** Cancels every review still running, then exits; for SIGINT. */
export function stopOnInterrupt(base: string): void {
	process.on('SIGINT', () => {
		stopping = true;
		console.error('\nInterrupted; stopping the running reviews.');
		void Promise.all([...inFlight].map((id) => cancelReview(base, id))).finally(() => process.exit(130));
	});
}

export function toEvalFinding(finding: Finding): EvalFinding {
	return {
		fingerprint: finding.fingerprint,
		file: finding.file,
		line: finding.line,
		endLine: finding.endLine,
		message: finding.message,
		category: finding.category,
		kind: finding.kind,
		ruleId: finding.ruleId,
		smell: finding.smell,
		symbol: finding.symbol,
		severity: finding.severity,
		title: finding.title,
		verification: finding.verification
	};
}

function outcomeOf(review: Review): RunOutcome {
	if (review.status === 'passed') return 'passed';

	return review.summary === REVIEW_CANCELLED ? 'cancelled' : 'failed';
}

function elapsed(ms: number): string {
	const seconds = Math.round(ms / 1000);

	return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
}

/** Rewrites the progress line in place on a terminal running one review; otherwise prints it only when it changes. */
function progressLine(inPlace: boolean): (text: string) => void {
	let last = '';

	return (text) => {
		if (inPlace) {
			process.stdout.write(`\r\x1b[2K${text}`);
		} else if (text.replace(/ · \d+m\d+s$/, '') !== last) {
			console.log(text);
		}

		last = text.replace(/ · \d+m\d+s$/, '');
	};
}

function describeProgress(label: string, review: Review, progress: ProgressSummary | null, ms: number): string {
	const tasks = progress ? ` · ${progress.tasksDone}/${progress.tasksTotal} tasks · ${progress.agents} reviewers` : '';

	return `${label} · ${review.status}${tasks} · ${elapsed(ms)}`;
}

/** Polls a review until it passes, fails or runs out of time; a timed-out review is cancelled. */
async function waitForReview(target: RunTarget, reviewId: string, label: string): Promise<Review | 'timeout'> {
	const started = Date.now();
	const show = progressLine(target.inPlace);
	let errors = 0;

	while (true) {
		await Bun.sleep(POLL_MS);

		try {
			const [review, progress] = await Promise.all([
				getReview(target.base, reviewId),
				progressSummary(target.base, reviewId).catch(() => null)
			]);

			errors = 0;
			show(describeProgress(label, review, progress, Date.now() - started));

			if (review.status === 'passed' || review.status === 'failed') {
				if (target.inPlace) process.stdout.write('\n');

				return review;
			}
		} catch (err) {
			if (++errors >= MAX_POLL_ERRORS) throw err;
		}

		if (Date.now() - started > target.timeoutMs) {
			await cancelReview(target.base, reviewId);
			if (target.inPlace) process.stdout.write('\n');

			return 'timeout';
		}
	}
}

/**
 * Runs one review of a PR and records what it found: a full review, or with
 * `start` another way to begin one, such as replaying a finished review.
 */
export async function runReview(
	target: RunTarget,
	review: { repoId: string; pr: number; index: number; label: string },
	start: () => Promise<Review> = () => startReview(target.base, review.repoId, review.pr)
): Promise<RunRecord> {
	if (stopping) return new Promise<never>(() => undefined);

	const started = Date.now();
	const created = await start();

	inFlight.add(created.id);
	console.log(`${review.label} · review ${created.id}`);

	const finished = await waitForReview(target, created.id, review.label);

	inFlight.delete(created.id);

	const result = finished === 'timeout' ? await getReview(target.base, created.id) : finished;
	const progress = await readProgress(target.base, created.id);

	return {
		index: review.index,
		reviewId: created.id,
		outcome: finished === 'timeout' ? 'timeout' : outcomeOf(result),
		headSha: result.headSha,
		durationMs: Date.now() - started,
		summary: result.summary,
		findings: result.findings.map(toEvalFinding),
		findingIds: result.findings.map((finding) => finding.id),
		hidden: hiddenFromSummary(result.summary),
		unconfirmed: result.unconfirmed?.map(toEvalFinding),
		funnel: result.funnel,
		candidates: progress?.candidateCount ?? null
	};
}
