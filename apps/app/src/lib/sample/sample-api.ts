import {
	reviewListItem,
	type CreateReviewInput,
	type Finding,
	type MergePullInput,
	type MergePullResult,
	type PullComment,
	type Repo,
	type Review
} from '@recoder/shared';

import type { ApiClient } from '../api/client';
import { isOpenFinding, type DecisionInput } from '../api/reviews';
import { createSampleChat } from './sample-chat';
import { sampleCommits } from './sample-pulls';
import { SAMPLE_REVIEW } from './sample-review';
import { playSampleRun, type SampleRun } from './sample-run';
import { createSampleWorld, type SampleWorld } from './sample-world';

/** What a scripted review finds: the sample review's findings and summary. */
function sampleEnding() {
	return { findings: structuredClone(SAMPLE_REVIEW.findings), summary: SAMPLE_REVIEW.summary ?? '' };
}

/** Why the sample refuses a merge, or null when it merges. */
function mergeRefusal(world: SampleWorld, repoId: string, number: number, input: MergePullInput): string | null {
	const { pull, status } = world.findPull(repoId, number);

	if (status.state !== 'open') return 'This pull request is no longer open.';
	if (status.draft) return 'A draft can’t be merged.';
	if (status.mergeability !== 'clean') return 'The branch has conflicts or a rule blocks the merge.';
	if (pull.headSha !== input.headSha) return 'New commits arrived; review them before merging.';

	return null;
}

/** The sample's review lifecycle: starting, pausing and stopping scripted runs. */
function createSampleReviews(world: SampleWorld) {
	const runs = new Map<string, SampleRun>();
	let created = 0;

	function play(review: Review): void {
		const paths = world.diff(review.repoId, review.prNumber).map((file) => file.path);

		runs.set(review.id, playSampleRun(review, paths, sampleEnding(), world.publish));
	}

	function runOf(id: string): SampleRun {
		const run = runs.get(id);

		if (!run) throw new Error('That review isn’t running.');

		return run;
	}

	return {
		async createReview(input: CreateReviewInput): Promise<Review> {
			const { pull } = world.findPull(input.repoId, input.prNumber);
			const at = new Date().toISOString();

			created += 1;

			const review: Review = {
				id: `sample-run-${created}`,
				repoId: input.repoId,
				prNumber: input.prNumber,
				headSha: pull.headSha,
				status: input.start === false ? 'draft' : 'queued',
				summary: null,
				findings: [],
				runs: [],
				source: 'github',
				prTitle: pull.title,
				prUrl: pull.url,
				createdAt: at,
				updatedAt: at
			};

			world.publish(review, world.progressOf(review.id));

			if (input.start !== false) play(review);

			return review;
		},

		async startDraft(id: string): Promise<Review> {
			const review = world.updateReview(id, (current) => ({ ...current, status: 'queued' }));

			play(review);

			return review;
		},

		async continueReview(id: string): Promise<Review> {
			const review = world.updateReview(id, (current) => ({ ...current, status: 'queued', summary: null }));

			play(review);

			return review;
		},

		pauseReview: async (id: string) => runOf(id).pause(),
		resumeReview: async (id: string) => runOf(id).resume(),
		cancelReview: async (id: string) => runOf(id).cancel()
	};
}

/** What a person does with the sample's findings, kept in memory. */
function createSampleFindings(world: SampleWorld) {
	function patchFinding(reviewId: string, findingId: string, change: (finding: Finding) => Finding): Review {
		return world.updateReview(reviewId, (review) => ({
			...review,
			findings: review.findings.map((finding) => (finding.id === findingId ? change(finding) : finding))
		}));
	}

	async function postFinding(reviewId: string, findingId: string): Promise<Review> {
		return world.updateReview(reviewId, (review) => ({
			...review,
			findingComments: {
				...review.findingComments,
				[findingId]: { id: `comment-${findingId}`, url: `${review.prUrl ?? ''}#comment-${findingId}`, inline: true }
			}
		}));
	}

	return {
		postFinding,

		async decide(reviewId: string, findingId: string, input: DecisionInput) {
			const decision = { ...input, decidedAt: new Date().toISOString() };

			patchFinding(reviewId, findingId, (finding) => ({ ...finding, decision }));

			return decision;
		},

		async reopen(reviewId: string, findingId: string): Promise<void> {
			patchFinding(reviewId, findingId, ({ decision: _decision, ...finding }) => finding);
		},

		async unquiet(reviewId: string, topicId: string): Promise<void> {
			world.updateReview(reviewId, (review) => ({
				...review,
				findings: review.findings.map((finding) =>
					finding.topic?.id === topicId ? { ...finding, topic: { id: topicId, label: finding.topic.label } } : finding
				)
			}));
		},

		async postFindings(reviewId: string): Promise<Review> {
			let review = world.findReview(reviewId);

			for (const finding of review.findings.filter(isOpenFinding)) review = await postFinding(reviewId, finding.id);

			return review;
		}
	};
}

/** A client that answers from memory, so the sample and the site's demo run with no server. */
export function createSampleApi(): ApiClient {
	const world = createSampleWorld();
	const chat = createSampleChat(world);
	let added = 0;

	return {
		base: '/sample',
		account: async () => 'you',
		repos: async () => world.data().repos,

		async addRepo(input): Promise<Repo> {
			const at = new Date().toISOString();

			added += 1;

			const repo: Repo = {
				id: `sample-added-${added}`,
				name: input.name,
				url: input.url,
				provider: input.provider ?? 'github',
				defaultBranch: input.defaultBranch ?? 'main',
				createdAt: at,
				updatedAt: at
			};

			world.data().repos = [...world.data().repos, repo];

			return repo;
		},

		async pulls(query = {}) {
			const items = world
				.data()
				.pulls.filter((item) => item.status.state === 'open' && (!query.repoId || item.repoId === query.repoId))
				.map(({ repoId, pull, status }) => ({ repoId, pull, status, review: world.newestReview(repoId, pull.number) }));

			return { items, failures: [], fetchedAt: new Date().toISOString() };
		},

		pullPage: async (repoId, number) => world.page(repoId, number),
		pullDiff: async (repoId, number) => ({
			headSha: world.findPull(repoId, number).pull.headSha,
			files: world.diff(repoId, number)
		}),
		pullCommits: async (repoId, number) => sampleCommits(world.findPull(repoId, number)),
		pullChecks: async (repoId, number) => world.findPull(repoId, number).checks,
		pullComments: async (repoId, number) => world.data().comments[`${repoId}#${number}`] ?? [],

		async postPullComment(repoId, number, body) {
			const key = `${repoId}#${number}`;
			const at = new Date().toISOString();
			const list = world.data().comments[key] ?? [];

			const comment: PullComment = {
				id: `sample-comment-${list.length + 1}-${key}`,
				kind: 'comment',
				author: { login: 'you', name: null, avatarUrl: null },
				body,
				createdAt: at,
				url: null,
				byRecoder: false
			};

			world.data().comments[key] = [...list, comment];

			return comment;
		},

		async mergePull(repoId, number, input): Promise<MergePullResult> {
			const refusal = mergeRefusal(world, repoId, number, input);

			if (refusal) return { merged: false, sha: null, message: refusal };

			world.markMerged(repoId, number);

			return { merged: true, sha: `${input.headSha}merge` };
		},

		reviews: async () => world.data().reviews.map(reviewListItem),
		review: async (id) => world.findReview(id),
		...createSampleReviews(world),
		...createSampleFindings(world),
		markUseful: async () => {},
		unmarkUseful: async () => {},
		follow: world.follow,
		...chat
	};
}

/** The sample client. Nothing runs until a screen calls it. */
export const sampleApi: ApiClient = createSampleApi();
