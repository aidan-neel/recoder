import { latestReviews, type Repo } from '@recoder/shared';
import { api, type ProgressSummaries } from '../api/client';
import { readDecisions } from '../review/saved-decisions';
import { SAMPLE_PROGRESS, sampleQueue } from '../sample/sample-queue';
import { SAMPLE_REVIEW } from '../sample/sample-review';
import { queueEntry, queueSections, type QueueEntry } from './queue';

/** `offline`: the review server did not answer. `empty`: it answered with no tracked repositories. */
export type QueueStatus = 'loading' | 'ready' | 'offline' | 'empty';

/** Running reviews are polled at this interval until they settle. */
const POLL_MS = 4000;

/** The open pull requests across tracked repositories, with their reviews. */
export class QueueState {
	status = $state<QueueStatus>('loading');
	entries = $state<QueueEntry[]>([]);
	progress = $state<ProgressSummaries>({});
	sample = $state(false);
	sections = $derived(queueSections(this.entries));
	private timer: ReturnType<typeof setTimeout> | null = null;
	private repos: Repo[] = [];

	/** Load the queue, or the sample when `sample` is set. */
	async load(sample: boolean): Promise<void> {
		this.sample = sample;

		if (sample) {
			this.entries = sampleQueue();
			this.progress = SAMPLE_PROGRESS;
			this.status = 'ready';

			return;
		}

		try {
			this.repos = await api.repos();
		} catch {
			this.status = 'offline';

			return;
		}

		if (this.repos.length === 0) {
			this.status = 'empty';

			return;
		}

		await this.refresh();
	}

	/** Re-read pulls and reviews; keeps polling while a review runs. */
	async refresh(): Promise<void> {
		try {
			const [pulls, reviews, progress] = await Promise.all([
				Promise.all(this.repos.map((repo) => api.pulls(repo.id).catch(() => []))),
				api.reviews(),
				api.progress().catch(() => ({}))
			]);

			const latest = latestReviews(reviews);

			this.entries = this.repos.flatMap((repo, index) =>
				pulls[index].map((pull) => {
					const review = latest.get(`${repo.id}#${pull.number}`) ?? null;

					return queueEntry(repo, pull, review, review ? readDecisions(review.id, review.headSha) : {});
				})
			);

			this.progress = progress;
			this.status = 'ready';
		} catch {
			this.status = 'offline';
		}

		this.schedule();
	}

	/** Queue a review for an entry and show it as reviewing straight away. */
	async start(entry: QueueEntry): Promise<void> {
		if (this.sample) {
			const review = { ...SAMPLE_REVIEW, id: `sample-${entry.pull.number}`, status: 'running' as const };

			this.entries = this.entries.map((item) =>
				item.key === entry.key ? { ...item, review, state: 'reviewing' } : item
			);

			return;
		}

		const review =
			entry.review?.status === 'failed'
				? await api.retryReview(entry.review.id)
				: await api.startReview(entry.repoId, entry.pull);

		this.entries = this.entries.map((item) =>
			item.key === entry.key ? { ...item, review, state: 'reviewing' } : item
		);

		this.schedule();
	}

	dispose(): void {
		if (this.timer) clearTimeout(this.timer);
	}

	private schedule(): void {
		if (this.timer) clearTimeout(this.timer);
		if (this.sample || !this.entries.some((entry) => entry.state === 'reviewing')) return;

		this.timer = setTimeout(() => this.refresh(), POLL_MS);
	}
}
