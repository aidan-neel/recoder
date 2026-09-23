import type { Repo, Review } from '@recoder/shared';
import { serverApi } from '$lib/server-api';

export interface RecentSession {
	id: string;
	repo: string;
	pr: number;
	title: string | null;
	branch: string | null;
	findings: number;
	status: Review['status'];
	durationMs?: number;
	tasksDone?: number;
	tasksTotal?: number;
	specialists?: number;
	reason?: string;
	updatedAt: string;
}

interface ProgressSummary {
	tasksDone: number;
	tasksTotal: number;
	specialists: number;
}

function mapRecent(
	reviews: Review[],
	names: Map<string, string>,
	summaries: Record<string, ProgressSummary>,
	branches: Record<string, string | null>
): RecentSession[] {
	return reviews
		.map((review) => {
			const summary = summaries[review.id];
			const start = Date.parse(review.startedAt ?? review.createdAt);
			const end = Date.parse(review.updatedAt);
			return {
				id: review.id,
				repo: names.get(review.repoId) ?? review.repoId.slice(0, 8),
				pr: review.prNumber,
				title: review.prTitle,
				branch: branches[`${review.repoId}#${review.prNumber}`] ?? null,
				findings: review.findings.length,
				status: review.status,
				durationMs:
					Number.isFinite(start) && Number.isFinite(end)
						? Math.max(0, end - start)
						: undefined,
				tasksDone: summary?.tasksDone,
				tasksTotal: summary?.tasksTotal,
				specialists: summary?.specialists,
				reason: review.status === 'failed' ? (review.summary ?? undefined) : undefined,
				updatedAt: review.updatedAt
			};
		})
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
	return new Date(t).toLocaleDateString();
}

function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function recentHeadline(session: RecentSession): string {
	if (session.status === 'draft') return 'Waiting for your prompt';
	if (session.status === 'running' || session.status === 'queued') {
		const parts: string[] = [];
		if (session.tasksTotal) {
			parts.push(`${session.tasksDone ?? 0} of ${session.tasksTotal} tasks`);
		}
		if (session.specialists) {
			parts.push(`${plural(session.specialists, 'specialist')} working`);
		}
		if (parts.length === 0) {
			parts.push(session.findings > 0 ? `${plural(session.findings, 'finding')} so far` : 'Starting…');
		}
		return parts.join(' · ');
	}
	const parts: string[] = [];
	if (session.status === 'failed') {
		parts.push(session.reason?.split('\n')[0] ?? 'Review failed');
	} else {
		parts.push(plural(session.findings, 'finding'));
	}
	if (session.durationMs !== undefined) {
		const seconds = Math.max(0, Math.floor(session.durationMs / 1000));
		parts.push(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
	}
	if (session.updatedAt) parts.push(timeAgo(session.updatedAt));
	return parts.join(' · ');
}

export function recentStatusLabel(session: RecentSession): string {
	return session.status === 'running' || session.status === 'queued' ? 'reviewing' : session.status;
}

class RecentSessionsState {
	repos = $state<Repo[]>([]);
	reviews = $state<Review[]>([]);
	summaries = $state<Record<string, ProgressSummary>>({});
	branches = $state<Record<string, string | null>>({});
	loading = $state(true);
	apiDown = $state(false);
	private inflight: Promise<void> | null = null;
	private branchRequests = new Set<string>();

	get recent(): RecentSession[] {
		if (this.apiDown) return [];
		const names = new Map(this.repos.map((r) => [r.id, r.name] as const));
		return mapRecent(this.reviews, names, this.summaries, this.branches);
	}

	get recentByRepo(): [string, RecentSession[]][] {
		const groups = new Map<string, RecentSession[]>();
		for (const session of this.recent) {
			const list = groups.get(session.repo) ?? [];
			list.push(session);
			groups.set(session.repo, list);
		}
		const order = new Map(this.repos.map((r, i) => [r.name, i] as const));
		return [...groups.entries()].sort((a, b) => {
			const oa = order.get(a[0]) ?? 1_000;
			const ob = order.get(b[0]) ?? 1_000;
			if (oa !== ob) return oa - ob;
			return (
				(Date.parse(b[1][0]?.updatedAt ?? '') || 0) - (Date.parse(a[1][0]?.updatedAt ?? '') || 0)
			);
		});
	}

	get reviewingCount(): number {
		return this.recent.filter((s) => s.status === 'running' || s.status === 'queued').length;
	}

	/** Single-flight load shared by every consumer (sidebar + home page helpers). */
	load(): Promise<void> {
		if (!this.inflight) {
			this.inflight = this.fetchAll().finally(() => {
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
			this.reviews = reviews;
			this.summaries = summaries;
			this.apiDown = false;
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

	/** Resolve each PR once, including closed PRs, without delaying the session list. */
	private async loadBranches(reviews: Review[]): Promise<void> {
		const pending = reviews.filter((review) => {
			const key = `${review.repoId}#${review.prNumber}`;
			if (review.source === 'stub' || key in this.branches || this.branchRequests.has(key)) return false;
			this.branchRequests.add(key);
			return true;
		});
		// Bound provider requests when a long review history is loaded.
		for (let i = 0; i < pending.length; i += 4) {
			await Promise.all(pending.slice(i, i + 4).map(async (review) => {
				const key = `${review.repoId}#${review.prNumber}`;
				try {
					const { pr } = await serverApi.previewPr(review.repoId, review.prNumber);
					this.branches[key] = pr.headRef || null;
				} catch {
					// Keep the session usable when the provider or branch is unavailable.
				} finally {
					this.branchRequests.delete(key);
				}
			}));
		}
	}

	async deleteReview(id: string): Promise<void> {
		if (!this.apiDown) await serverApi.deleteReview(id);
		this.reviews = this.reviews.filter((r) => r.id !== id);
	}
}

/** Backend reviews shared between the app sidebar and pages. */
export const recentSessions = new RecentSessionsState();
