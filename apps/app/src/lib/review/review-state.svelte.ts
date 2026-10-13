import type { FileDiff, PullRequest, Review } from '@recoder/shared';
import { toast } from '@sivir-ui/svelte/components/toast';
import { api, ApiError } from '../api/client';
import { SAMPLE_DIFFS } from '../sample/sample-diff';
import { SAMPLE_PULL, SAMPLE_REVIEW } from '../sample/sample-review';
import { Decisions } from './decisions.svelte';
import { buildSurface, type DecisionState } from './surface';

/** What the main pane shows. */
export type Selection =
	| { kind: 'overview' }
	| { kind: 'decision'; id: string }
	| { kind: 'receipt'; id: string }
	| { kind: 'file'; path: string };

export type LoadStatus = 'loading' | 'ready' | 'missing' | 'offline';

/** A running review is re-read at this interval until it settles. */
const POLL_MS = 3000;

/** After a decision, the next one opens this much later, so the change registers first. */
const ADVANCE_MS = 160;

function key(selection: Selection): string {
	return selection.kind === 'overview'
		? 'overview'
		: selection.kind === 'file'
			? `file:${selection.path}`
			: `${selection.kind}:${selection.id}`;
}

/** One review as a person works through it. */
export class ReviewState {
	status = $state<LoadStatus>('loading');
	review = $state<Review | null>(null);
	pull = $state<PullRequest | null>(null);
	repoName = $state<string | null>(null);
	files = $state<FileDiff[]>([]);
	progress = $state<{ tasksDone: number; tasksTotal: number } | null>(null);
	sample = $state(false);
	selection = $state<Selection>({ kind: 'overview' });
	handoffOpen = $state(false);
	decisions = new Decisions();

	surface = $derived(this.review ? buildSurface(this.review, this.files, this.decisions.states) : null);
	running = $derived(this.review?.status === 'queued' || this.review?.status === 'running');
	open = $derived(this.surface?.decisions.filter((decision) => this.decisions.stateOf(decision.id) === 'open') ?? []);
	sent = $derived(this.surface?.decisions.filter((decision) => this.decisions.stateOf(decision.id) === 'sent') ?? []);
	decided = $derived((this.surface?.decisions.length ?? 0) - this.open.length);

	/** Every selectable item in rail order, for j/k. */
	order = $derived.by((): Selection[] => {
		const surface = this.surface;

		if (!surface) return [{ kind: 'overview' }];

		return [
			{ kind: 'overview' },
			...surface.decisions.map((decision) => ({ kind: 'decision' as const, id: decision.id })),
			...surface.receipts.map((receipt) => ({ kind: 'receipt' as const, id: receipt.id })),
			...surface.files.map((file) => ({ kind: 'file' as const, path: file.path }))
		];
	});

	private timer: ReturnType<typeof setTimeout> | null = null;
	private advanceTimer: ReturnType<typeof setTimeout> | null = null;
	private id = '';

	async load(id: string): Promise<void> {
		this.id = id;
		this.sample = id === 'sample';

		if (this.sample) {
			this.accept(SAMPLE_REVIEW, SAMPLE_DIFFS);
			this.pull = SAMPLE_PULL;
			this.repoName = 'acme/api';

			return;
		}

		try {
			const review = await api.review(id);
			const files = await api.files(id).catch(() => []);

			this.accept(review, files);
			void this.findPull(review);
		} catch (error) {
			this.status = error instanceof ApiError && error.status === 404 ? 'missing' : 'offline';
		}
	}

	isSelected(selection: Selection): boolean {
		return key(selection) === key(this.selection);
	}

	select(selection: Selection): void {
		if (this.advanceTimer) clearTimeout(this.advanceTimer);
		this.selection = selection;
	}

	/** Move through the rail; wraps at neither end. */
	step(by: number): void {
		const at = this.order.findIndex((item) => key(item) === key(this.selection));
		const next = this.order[Math.min(this.order.length - 1, Math.max(0, at + by))];

		if (next) this.select(next);
	}

	/** The first open decision after `id` (wrapping), or the overview when none is left. */
	nextOpen(id: string | null): Selection {
		const decisions = this.surface?.decisions ?? [];
		const at = id ? decisions.findIndex((decision) => decision.id === id) : -1;
		const after = [...decisions.slice(at + 1), ...decisions.slice(0, Math.max(at, 0))];
		const next = after.find((decision) => this.decisions.stateOf(decision.id) === 'open');

		return next ? { kind: 'decision', id: next.id } : { kind: 'overview' };
	}

	/**
	 * Decide `id`, then open the next open decision a beat later. Dismissing a
	 * finding also tells the server, so later reviews of the repo stop raising it.
	 */
	decide(id: string, state: Exclude<DecisionState, 'open'>): void {
		const was = this.decisions.stateOf(id);

		this.decisions.set(id, state);

		const now = this.decisions.stateOf(id);

		this.syncDismissal(id, was, now);

		if (now === 'open') return;
		if (this.advanceTimer) clearTimeout(this.advanceTimer);

		this.advanceTimer = setTimeout(() => {
			if (this.selection.kind === 'decision' && this.selection.id === id) this.selection = this.nextOpen(id);
		}, ADVANCE_MS);
	}

	/** Undo the last decision and show it again. */
	undo(): string | null {
		const id = this.decisions.lastChanged();

		if (!id) return null;

		const was = this.decisions.stateOf(id);

		this.decisions.undo();
		this.syncDismissal(id, was, this.decisions.stateOf(id));
		this.select({ kind: 'decision', id });

		return id;
	}

	dispose(): void {
		if (this.timer) clearTimeout(this.timer);
		if (this.advanceTimer) clearTimeout(this.advanceTimer);
	}

	private accept(review: Review, files: FileDiff[]): void {
		const first = this.review === null;

		this.review = review;
		this.files = files;
		if (first) this.decisions.load(review.id, review.headSha);
		this.status = 'ready';

		if (this.running) this.poll();
	}

	private poll(): void {
		if (this.timer) clearTimeout(this.timer);

		this.timer = setTimeout(async () => {
			try {
				const [review, files, progress] = await Promise.all([
					api.review(this.id),
					this.files.length ? Promise.resolve(this.files) : api.files(this.id).catch(() => []),
					api.progress().catch(() => ({}) as Record<string, never>)
				]);

				this.progress = progress[this.id] ?? null;
				this.accept(review, files);
			} catch {
				this.poll();
			}
		}, POLL_MS);
	}

	private async findPull(review: Review): Promise<void> {
		const [pulls, repos] = await Promise.all([api.pulls(review.repoId).catch(() => []), api.repos().catch(() => [])]);

		this.pull = pulls.find((pull) => pull.number === review.prNumber) ?? null;
		this.repoName = repos.find((repo) => repo.id === review.repoId)?.name ?? null;
	}

	private syncDismissal(id: string, was: DecisionState, now: DecisionState): void {
		const finding = this.surface?.decisions.find((decision) => decision.id === id)?.finding;

		if (this.sample || !this.review || !finding || (was !== 'dismissed' && now !== 'dismissed')) return;

		const call =
			now === 'dismissed'
				? api.dismiss(this.review.id, finding.id, 'Not an issue')
				: api.restore(this.review.id, finding.id);

		call.catch(() =>
			toast.error('Couldn’t reach the review server', {
				description: 'The decision is saved here; Recoder will raise this again next review.'
			})
		);
	}
}
