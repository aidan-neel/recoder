import {
	isBotLogin,
	PERSON_WINDOW_DAYS,
	reviewListItem,
	type PersonMembership,
	type PersonProfile,
	type PersonRef,
	type PersonSummary,
	type PullListItem,
	type Review
} from '@recoder/shared';

import { ApiError } from '../api/http';
import type { PeopleApi } from '../api/people';
import { openCounts } from '../pulls/pull-rows';
import { sampleTime } from './sample-clock';
import type { SampleWorld } from './sample-world';

/** The sample visitor's account, as the sample's sign-in names it. */
export const SAMPLE_SELF_ID = 'sample';

/** Who has signed in to the sample's server besides the visitor. Maya and the bots never did. */
export const SAMPLE_PEOPLE: PersonSummary[] = [
	{ accountId: 'sample-ana', provider: 'github', host: null, login: 'ana', name: 'Ana Ruiz', avatarUrl: null },
	{ accountId: 'sample-jonas', provider: 'github', host: null, login: 'jonas', name: 'Jonas Berg', avatarUrl: null },
	{ accountId: 'sample-mira', provider: 'github', host: null, login: 'mira', name: 'Mira Okafor', avatarUrl: null },
	{ accountId: 'sample-tomas', provider: 'gitlab', host: 'git.acme.dev', login: 'tomas', name: null, avatarUrl: null }
];

const SELF: PersonSummary = {
	accountId: SAMPLE_SELF_ID,
	provider: 'github',
	host: null,
	login: 'you',
	name: 'Sample person',
	avatarUrl: null
};

const JOINED = sampleTime('2026-09-02T15:00:00.000Z');

function sameRef(a: PersonRef, b: PersonRef): boolean {
	return a.provider === b.provider && a.host === b.host && a.login.toLowerCase() === b.login.toLowerCase();
}

function membershipOf(ref: PersonRef): PersonMembership {
	if (sameRef(ref, SELF)) return { status: 'member', accountId: SAMPLE_SELF_ID, role: 'admin', joinedAt: JOINED };

	const person = SAMPLE_PEOPLE.find((candidate) => sameRef(candidate, ref));

	return person
		? { status: 'member', accountId: person.accountId, role: 'member', joinedAt: JOINED }
		: { status: 'none' };
}

function forgeUrl({ provider, host, login }: PersonRef): string {
	return `https://${host ?? (provider === 'github' ? 'github.com' : 'gitlab.com')}/${login}`;
}

/** The sample's people, built from its pull requests and reviews: a pull request's author is who the profile shows. */
export function createSamplePeople(world: SampleWorld): PeopleApi {
	/** Every pull request this person wrote, with its newest review. */
	function pullsBy(ref: PersonRef): PullListItem[] {
		if (ref.provider !== 'github') return [];

		return world
			.data()
			.pulls.filter((item) => item.pull.author.toLowerCase() === ref.login.toLowerCase())
			.map(({ repoId, pull, status }) => ({ repoId, pull, status, review: world.newestReview(repoId, pull.number) }));
	}

	/** Reviews a member started: in the sample, the reviews of their own pull requests. */
	function reviewsBy(pulls: PullListItem[], membership: PersonMembership): Review[] {
		if (membership.status !== 'member') return [];

		const mine = new Set(pulls.map((item) => `${item.repoId}#${item.pull.number}`));

		return world.data().reviews.filter((review) => mine.has(`${review.repoId}#${review.prNumber}`));
	}

	return {
		list: async () => structuredClone(SAMPLE_PEOPLE),

		async profile(ref) {
			const membership = membershipOf(ref);
			const pulls = pullsBy(ref);

			if (pulls.length === 0 && membership.status === 'none') throw new ApiError('No such person.', 404);

			const since = Date.now() - PERSON_WINDOW_DAYS * 86_400_000;
			const open = pulls.filter((item) => item.status.state === 'open');

			const merged = pulls.filter(
				(item) => item.status.state === 'merged' && Date.parse(item.status.updatedAt) >= since
			);

			const reviews = reviewsBy(pulls, membership);
			const bugs = open.reduce((sum, item) => sum + (item.review ? openCounts(item.review).bugs : 0), 0);
			const raised = reviews.reduce((sum, review) => sum + review.findings.length, 0);

			const fixed = reviews.reduce(
				(sum, review) => sum + review.findings.filter((f) => f.decision?.state === 'accepted').length,
				0
			);

			const repos = world.data().repos;
			const self = membership.status === 'member' && membership.accountId === SAMPLE_SELF_ID;
			const bot = isBotLogin(ref.login);

			const profile: PersonProfile = {
				person: {
					...ref,
					name: SAMPLE_PEOPLE.find((p) => sameRef(p, ref))?.name ?? (self ? SELF.name : null),
					avatarUrl: null,
					forgeUrl: forgeUrl(ref),
					bot
				},
				membership,
				canMessage: membership.status === 'member' && !self && !bot,
				figures: {
					openPulls: open.length,
					unreviewed: open.filter((item) => !item.review).length,
					merged: merged.length,
					reviewsRun: reviews.length,
					openBugs: bugs,
					findingsFixed: fixed,
					findingsRaised: raised
				},
				openPulls: open,
				recentlyMerged: merged.slice(0, 5),
				reviewsRun: reviews.slice(0, 5).map((review) => reviewListItem(review)),
				repositories: repos
					.map((repo) => ({
						repoId: repo.id,
						name: repo.name,
						pulls: pulls.filter((item) => item.repoId === repo.id).length
					}))
					.filter((repo) => repo.pulls > 0),
				failures: [],
				fetchedAt: new Date().toISOString()
			};

			return structuredClone(profile);
		}
	};
}
