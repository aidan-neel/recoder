import { goto } from '$app/navigation';
import { page } from '$app/state';
import { ApiError, cachedReviewFiles, serverApi } from '$lib/api/server-api';
import { ReviewStream } from '$lib/review/review-stream.svelte';
import { errorToast } from '$lib/shell/notify';
import type { FileDiff, Review } from '@recoder/shared';
import { recentSessions } from './recent-sessions.svelte';
import { sessionState } from './session-state.svelte';

/** Diff size for the conversation header, or null until the files arrive. */
export interface DiffStats {
	files: number;
	additions: number;
	deletions: number;
}

const POLL_MS = 2500;

/**
 * A session page's review: metadata polling, its live stream and its repository files.
 * Metadata and files load independently, so the conversation never waits on a large diff.
 * Construct it while a component initializes; it registers its own effects.
 */
export class SessionReview {
	review = $state<Review | null>(null);

	/** Raw: a large, read-only diff; reassigning the cached array is a no-op. */
	files = $state.raw<FileDiff[] | null>(null);

	checked = $state(false);
	error = $state<string | null>(null);
	filesError = $state<string | null>(null);

	/** True when the API itself is unreachable (vs. "no such review", which falls back to the demo). */
	down = $state(false);

	/** Bumped by the retry button to re-run the backend check. */
	retryNonce = $state(0);

	filesRetryNonce = $state(0);
	stream = $state<ReviewStream | null>(null);
	queueing = $state(false);

	readonly isBackend = $derived(this.checked && this.review !== null);
	readonly reviewing = $derived(this.review?.status === 'running' || this.review?.status === 'queued');

	readonly stats = $derived.by((): DiffStats | null => {
		if (!this.files) return null;

		return {
			files: this.files.length,
			additions: this.files.reduce((sum, f) => sum + f.additions, 0),
			deletions: this.files.reduce((sum, f) => sum + f.deletions, 0)
		};
	});

	readonly #liveId = $derived(this.review?.id ?? null);
	readonly #liveStatus = $derived(this.review?.status);

	constructor(getId: () => string) {
		$effect(() => this.#connectStream());
		$effect(() => this.#pollReview(getId()));
		$effect(() => this.#loadFiles());
	}

	/** Applies a review from polling or the stream, ignoring stale snapshots, and syncs the session list. */
	accept = (review: Review): void => {
		if (page.params.id !== review.id || this.#isStale(review)) return;
		this.review = review;

		const recentIndex = recentSessions.reviews.findIndex((item) => item.id === review.id);

		if (recentIndex >= 0) recentSessions.reviews[recentIndex] = review;

		const running = review.status === 'queued' || review.status === 'running';

		if (!sessionState.sessions.some((s) => s.id === review.id)) {
			sessionState.ensureSession(
				review.id,
				review.prTitle || `PR #${review.prNumber}`,
				`#${review.prNumber}`,
				running ? 'reviewing' : 'ready'
			);
		}

		if (!running && sessionState.sessions.find((s) => s.id === review.id)?.status === 'reviewing') {
			sessionState.markReady(review.id);
		}
	};

	/** A polling request started before the terminal stream event must not rewind the UI. */
	#isStale(review: Review): boolean {
		const current = this.review;

		if (current?.id !== review.id) return false;

		const finished = current.status === 'passed' || current.status === 'failed';
		const live = review.status === 'queued' || review.status === 'running';

		return (finished && live) || (current.status !== 'draft' && review.status === 'draft');
	}

	/** Runs a draft's full review. Returns the review id once it started, or null after a toast. */
	async startDraft(): Promise<string | null> {
		if (!this.review) return null;

		try {
			this.review = await serverApi.startReview(this.review.id);

			return this.review.id;
		} catch (e) {
			errorToast('Could not start the review', e instanceof Error ? e.message : undefined);

			return null;
		}
	}

	/** Continues a failed review where it stopped. Returns the review id, or null after a toast. */
	async resume(): Promise<string | null> {
		if (!this.review) return null;

		try {
			this.review = await serverApi.continueReview(this.review.id);

			return this.review.id;
		} catch (e) {
			errorToast(
				'Could not continue the review',
				e instanceof Error ? e.message : undefined,
				e instanceof ApiError ? e.action : undefined
			);

			return null;
		}
	}

	/** Queues a fresh review of the same repo and PR, then jumps to it. */
	async rerun(sessionName: string): Promise<void> {
		if (!this.review || this.queueing) return;
		this.queueing = true;
		this.error = null;

		try {
			const review = await serverApi.queueReview({
				repoId: this.review.repoId,
				prNumber: this.review.prNumber,
				prTitle: this.review.prTitle ?? undefined,
				start: false
			});

			sessionState.ensureSession(review.id, sessionName, `#${review.prNumber}`, 'ready');
			await goto(`/session/${review.id}`);
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Failed to queue review.';
		} finally {
			this.queueing = false;
		}
	}

	#connectStream(): (() => void) | void {
		const currentId = this.#liveId;

		if (!currentId) {
			this.stream = null;

			return;
		}

		const stream = new ReviewStream(currentId, this.accept);

		this.stream = stream;

		return () => stream.close();
	}

	/** Resets for the session, then polls its review until it settles. */
	#pollReview(currentId: string): () => void {
		void this.retryNonce;
		this.review = null;
		this.files = cachedReviewFiles(currentId);
		this.filesError = null;
		this.checked = false;
		this.error = null;
		this.down = false;

		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;

		const poll = async () => {
			const more = await this.#refresh(currentId, controller.signal);

			if (!controller.signal.aborted && more) timer = setTimeout(poll, POLL_MS);
		};

		void poll();

		return () => {
			controller.abort();
			if (timer) clearTimeout(timer);
		};
	}

	/** Fetches the review once. Returns whether polling should continue. */
	async #refresh(currentId: string, signal: AbortSignal): Promise<boolean> {
		try {
			const review = await serverApi.getReview(currentId, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));

			if (signal.aborted || page.params.id !== currentId) return false;
			this.down = false;
			this.accept(review);
			this.error = null;

			return review.status === 'draft' || review.status === 'queued' || review.status === 'running';
		} catch (e) {
			if (signal.aborted || page.params.id !== currentId) return false;

			this.error =
				e instanceof Error && e.name === 'TimeoutError'
					? 'Loading the session timed out. Try again.'
					: e instanceof Error
						? e.message
						: 'Could not load the session.';

			this.down = !isUnknownReview(e);

			return this.down;
		} finally {
			if (!signal.aborted && page.params.id === currentId) this.checked = true;
		}
	}

	/**
	 * Loads the repository files, which can take much longer than the metadata and must never overlap polls.
	 * Running reviews and drafts (whose diff is fetched in the background after creation) keep retrying.
	 */
	#loadFiles(): (() => void) | void {
		const currentId = this.#liveId;
		const status = this.#liveStatus;

		void this.filesRetryNonce;
		if (!currentId || !status) return;

		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		let loaded = false;

		const load = async () => {
			try {
				const files = await serverApi.getReviewFiles(
					currentId,
					AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
				);

				if (controller.signal.aborted || page.params.id !== currentId) return;
				this.files = files;
				this.filesError = null;
				loaded = true;
			} catch {
				if (controller.signal.aborted || page.params.id !== currentId) return;
				if (status === 'passed' || status === 'failed') this.filesError = 'Could not load the code diff. Try again.';
			} finally {
				if (
					!controller.signal.aborted &&
					(status === 'queued' || status === 'running' || (status === 'draft' && !loaded))
				)
					timer = setTimeout(load, POLL_MS);
			}
		};

		void load();

		return () => {
			controller.abort();
			if (timer) clearTimeout(timer);
		};
	}
}

/** An unknown id means a demo session (local mock content); any other failure means the API is unreachable. */
function isUnknownReview(e: unknown): boolean {
	return e instanceof Error && /review not found/i.test(e.message);
}
