import type { Repo, Review } from '@recoder/shared';
import { readCache, writeCache } from '$lib/shell/persisted-cache';
import { serverApi } from '$lib/api/server-api';

export interface RecentSession {
	id: string;
	repo: string;
	pr: number;
	title: string | null;
	branch: string | null;
	status: Review['status'];
	updatedAt: string;
}

interface ProgressSummary {
	tasksDone: number;
	tasksTotal: number;
	agents: number;
}

function mapRecent(
	reviews: Review[],
	names: Map<string, string>,
	branches: Record<string, string | null>
): RecentSession[] {
	return reviews
		.map((review) => ({
			id: review.id,
			repo: names.get(review.repoId) ?? review.repoId.slice(0, 8),
			pr: review.prNumber,
			title: review.prTitle,
			branch: branches[`${review.repoId}#${review.prNumber}`] ?? null,
			status: review.status,
			updatedAt: review.updatedAt
		}))
		.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
}

export function timeAgo(iso: string): string {
	const t = Date.parse(iso);

	if (Number.isNaN(t)) return '';

	const s = Math.max(0, (Date.now() - t) / 1000);

	if (s < 60) return 'just now';

	const m = Math.floor(s / 60);

	if (m < 60) return `${m}m ago`;

	const h = Math.floor(m / 60);

	if (h < 24) return `${h}h ago`;

	const d = Math.floor(h / 24);

	if (d === 1) return 'yesterday';
	if (d < 30) return `${d}d ago`;

	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive
	return new Date(t).toLocaleDateString();
}

class RecentSessionsState {
	repos = $state<Repo[]>([]);
	reviews = $state<Review[]>([]);
	summaries = $state<Record<string, ProgressSummary>>({});
	branches = $state<Record<string, string | null>>({});
	loading = $state(true);
	apiDown = $state(false);
	private inflight: Promise<void> | null = null;
	private seeded = false;
	/** Deleted in the UI, DELETE still pending (undo window): kept out of refreshes. */
	private hidden = new Set<string>();
	private branchRequests = new Set<string>();

	get recent(): RecentSession[] {
		if (this.apiDown) return [];

		const names = new Map(this.repos.map((r) => [r.id, r.name] as const));

		return mapRecent(this.reviews, names, this.branches);
	}

	get reviewingCount(): number {
		return this.recent.filter((s) => s.status === 'running' || s.status === 'queued').length;
	}

	/** Single-flight load shared by every consumer. A cached list shows at once; the fetch replaces it quietly. */
	load(): Promise<void> {
		if (!this.inflight) {
			const cached = this.seeded
				? null
				: readCache<{ repos: Repo[]; reviews: Review[]; summaries: Record<string, ProgressSummary> }>(
						'recent-sessions'
					);

			this.seeded = true;

			if (cached) {
				this.repos = cached.repos;
				this.reviews = cached.reviews.filter((review) => !this.hidden.has(review.id));
				this.summaries = cached.summaries;
				this.loading = false;
			}

			this.inflight = this.fetchAll(!!cached).finally(() => {
				this.inflight = null;
			});
		}

		return this.inflight;
	}

	refresh(): Promise<void> {
		return this.load();
	}

	private async fetchAll(quiet = false): Promise<void> {
		if (!quiet) this.loading = true;

		try {
			const [repos, reviews, summaries] = await Promise.all([
				serverApi.listRepos(),
				serverApi.listReviews(),
				serverApi.reviewSummaries().catch(() => this.summaries)
			]);

			this.repos = repos;
			this.reviews = reviews.filter((review) => !this.hidden.has(review.id));
			this.summaries = summaries;
			this.apiDown = false;
			writeCache('recent-sessions', { repos, reviews, summaries });
			void this.loadBranches(reviews);
		} catch {
			if (quiet) return;
			this.apiDown = true;
			this.repos = [];
			this.reviews = [];
		} finally {
			if (!quiet) this.loading = false;
		}
	}

	/**
	 * Keep session tab badges live while any review runs. Returns a stop function;
	 * polling is skipped entirely when nothing is running.
	 */
	watchRunning(intervalMs = 4000): () => void {
		const timer = setInterval(() => {
			if (this.reviewingCount === 0 || this.inflight) return;

			this.inflight = this.fetchAll(true).finally(() => {
				this.inflight = null;
			});
		}, intervalMs);

		return () => clearInterval(timer);
	}

	/**
	 * Resolve each PR once, including closed PRs, without delaying the session list. Requests go four at a
	 * time, and a failed one leaves the session usable without its branch.
	 */
	private async loadBranches(reviews: Review[]): Promise<void> {
		const pending = reviews.filter((review) => {
			const key = `${review.repoId}#${review.prNumber}`;

			if (review.source === 'stub' || key in this.branches || this.branchRequests.has(key)) return false;
			this.branchRequests.add(key);

			return true;
		});

		for (let i = 0; i < pending.length; i += 4) {
			await Promise.all(
				pending.slice(i, i + 4).map(async (review) => {
					const key = `${review.repoId}#${review.prNumber}`;

					try {
						const { pr } = await serverApi.previewPr(review.repoId, review.prNumber);

						this.branches[key] = pr.headRef || null;
					} catch {
					} finally {
						this.branchRequests.delete(key);
					}
				})
			);
		}
	}

	/** Drop a review from the list until `unhide` or `forget`; returns where it was. */
	hide(id: string): { review: Review; index: number } | null {
		this.hidden.add(id);

		const index = this.reviews.findIndex((review) => review.id === id);

		if (index < 0) return null;

		const review = this.reviews[index];

		this.reviews = this.reviews.filter((item) => item.id !== id);

		return { review, index };
	}

	unhide(id: string, snapshot: { review: Review; index: number } | null): void {
		this.hidden.delete(id);
		if (!snapshot || this.reviews.some((review) => review.id === id)) return;
		this.reviews = [...this.reviews.slice(0, snapshot.index), snapshot.review, ...this.reviews.slice(snapshot.index)];
	}

	/** The server deleted it; stop filtering. */
	forget(id: string): void {
		this.hidden.delete(id);
	}

	async deleteReview(id: string): Promise<void> {
		if (!this.apiDown) await serverApi.deleteReview(id);
		this.reviews = this.reviews.filter((r) => r.id !== id);
	}
}

/** Backend reviews shared between the app sidebar and pages. */
export const recentSessions = new RecentSessionsState();
