import {
	PERSON_WINDOW_DAYS,
	findingTier,
	type PersonIdentity,
	type PersonMembership,
	type PersonProfile,
	type PersonRef,
	type PullListItem,
	type PullRequest,
	type Repo
} from '@recoder/shared';
import { accounts, isActiveAccount, type StoredAccount } from '../accounts/account-records';
import { getGitlabHost, hostOfRepoUrl } from '../forge/gitlab-host';
import { openPulls } from '../forge/pulls/cached';
import { forgeFailureMessage, logForgeFailure } from '../forge/pulls/failure';
import { listOpenPulls, newestReviews, withPullListDeadline } from '../forge/pulls/list';
import type { OpenPulls } from '../forge/pulls/status';
import { db } from '../store';
import { mapLimit } from '../util/map-limit';
import { fallbackIdentity, forgeIdentity, historicalAuthor, mergedPullEntry, mergedPulls } from './profile-forge';

export function profileRepositories(ref: PersonRef, repos: Repo[]): Repo[] {
	return repos.filter((repo) => {
		if (repo.provider !== ref.provider) return false;
		if (ref.provider === 'github') return true;

		const host = hostOfRepoUrl(repo.url) ?? getGitlabHost();

		return ref.host === (host === 'gitlab.com' ? null : host);
	});
}

function matchingAccount(records: StoredAccount[], ref: PersonRef, remoteId: string | undefined) {
	const matches = records.filter((account) =>
		account.forges.some(
			(forge) =>
				forge.provider === ref.provider &&
				forge.host === ref.host &&
				(remoteId ? forge.remoteId === remoteId : forge.login.toLowerCase() === ref.login.toLowerCase())
		)
	);

	return matches.find(isActiveAccount) ?? matches.find((account) => account.removedAt !== undefined);
}

function membershipOf(account: StoredAccount | undefined): PersonMembership {
	if (!account) return { status: 'none' };
	if (account.removedAt !== undefined) return { status: 'removed' };

	return { status: 'member', accountId: account.id, role: account.role, joinedAt: account.createdAt };
}

async function authoredOpens(repo: Repo, login: string): Promise<OpenPulls> {
	const entries: OpenPulls['entries'] = [];
	const seen = new Set<string>();
	let cursor: string | null = null;

	do {
		const page = await openPulls(repo, cursor);

		entries.push(...page.entries.filter(({ pull }) => pull.author.toLowerCase() === login));
		cursor = page.nextCursor;
		if (cursor !== null && seen.has(cursor)) throw new Error('The forge repeated an open pull cursor.');
		if (cursor !== null) seen.add(cursor);
	} while (cursor !== null);

	return { entries, nextCursor: null, total: null };
}

function fallbackFromPull(
	ref: PersonRef,
	onForge: Pick<PullRequest, 'author' | 'authorAvatarUrl'> | undefined
): PersonIdentity {
	return {
		...fallbackIdentity({ ...ref, login: onForge?.author ?? ref.login }),
		avatarUrl: onForge?.authorAvatarUrl?.startsWith('https://') ? onForge.authorAvatarUrl : null
	};
}

export async function loadPersonProfile(
	ref: PersonRef,
	caller: string,
	tracked: Repo[]
): Promise<PersonProfile | null> {
	const repos = profileRepositories(ref, tracked);

	const [identity, people, reviews] = await Promise.all([
		forgeIdentity(ref).catch(() => null),
		accounts.list(),
		db.reviews.summaries()
	]);

	const person = identity?.person ?? ref;
	const account = matchingAccount(people, person, identity?.remoteId);
	const login = person.login.toLowerCase();
	const now = Date.now();
	const since = now - PERSON_WINDOW_DAYS * 86_400_000;
	const cutoff = new Date(since).toISOString();
	const failures = new Map<string, string>();

	const fail = (repo: Repo, error: unknown) => {
		logForgeFailure(`loading profile pulls for repo ${repo.id}`, error);
		failures.set(repo.id, forgeFailureMessage(error));
	};

	const [open, mergedByRepo, reviewIds] = await Promise.all([
		listOpenPulls(repos, reviews, (repo) => authoredOpens(repo, login)),
		mapLimit(repos, 4, async (repo) => {
			try {
				const merged = await withPullListDeadline(mergedPulls(repo, person, cutoff));

				return merged.filter((pull) => Date.parse(pull.mergedAt) >= since).map((pull) => ({ repo, pull }));
			} catch (error) {
				fail(repo, error);

				return [];
			}
		}),
		account ? db.reviews.startedBy(account.id) : new Set<string>()
	]);

	for (const failure of open.failures) failures.set(failure.repoId, failure.error);

	const trackedIds = new Set(tracked.map((repo) => repo.id));

	const reviewsRun = reviews
		.filter((review) => reviewIds.has(review.id) && trackedIds.has(review.repoId))
		.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

	const merged = mergedByRepo.flat().sort((a, b) => Date.parse(b.pull.mergedAt) - Date.parse(a.pull.mergedAt));
	const reviewOf = newestReviews(reviews);

	const recent = await mapLimit(merged.slice(0, 5), 4, async ({ repo, pull }): Promise<PullListItem | null> => {
		try {
			const entry = await withPullListDeadline(mergedPullEntry(repo, pull));

			return { repoId: repo.id, ...entry, review: reviewOf(repo.id, pull.number) };
		} catch (error) {
			fail(repo, error);

			return null;
		}
	});

	const recentlyMerged = recent.filter((item) => item !== null);
	let author: Pick<PullRequest, 'author' | 'authorAvatarUrl'> | undefined = (open.items[0] ?? recentlyMerged[0])?.pull;

	if (!identity && !author && !merged.length && !reviewsRun.length) {
		const mentions = await mapLimit(repos, 4, async (repo) => {
			try {
				return await withPullListDeadline(historicalAuthor(repo, ref));
			} catch (error) {
				fail(repo, error);

				return null;
			}
		});

		author = mentions.find((mention) => mention !== null);
		if (!author) return null;
	}

	const profileIdentity = identity?.person ?? fallbackFromPull(ref, author);
	const membership = membershipOf(account);
	const window = new Map<string, Map<number, PullListItem['review']>>();

	for (const { repoId, pull, review } of open.items) {
		if (Date.parse(pull.createdAt) >= since) rememberPull(window, repoId, pull.number, review);
	}

	for (const { repo, pull } of merged) rememberPull(window, repo.id, pull.number, reviewOf(repo.id, pull.number));

	const findings = [...window.values()].flatMap((pulls) =>
		[...pulls.values()].flatMap((review) => review?.findings ?? [])
	);

	const repositories = repos
		.flatMap((repo) => {
			const pulls = window.get(repo.id)?.size;

			return pulls ? [{ repoId: repo.id, name: repo.name, pulls }] : [];
		})
		.sort((a, b) => b.pulls - a.pulls || a.name.localeCompare(b.name));

	return {
		person: profileIdentity,
		membership,
		canMessage: membership.status === 'member' && membership.accountId !== caller && !profileIdentity.bot,
		figures: {
			openPulls: open.items.length,
			unreviewed: open.items.filter(({ review }) => review === null).length,
			merged: merged.length,
			reviewsRun: reviewsRun.length,
			openBugs: open.items.reduce(
				(count, { review }) =>
					count +
					(review?.findings.filter((finding) => findingTier(finding) === 'bug' && !finding.decision).length ?? 0),
				0
			),
			findingsFixed: findings.filter((finding) => finding.decision?.state === 'accepted').length,
			findingsRaised: findings.length
		},
		openPulls: open.items,
		recentlyMerged,
		reviewsRun: reviewsRun.slice(0, 5),
		repositories,
		failures: [...failures].map(([repoId, error]) => ({ repoId, error })),
		fetchedAt: new Date().toISOString()
	};
}

function rememberPull(
	window: Map<string, Map<number, PullListItem['review']>>,
	repoId: string,
	number: number,
	review: PullListItem['review']
): void {
	const pulls = window.get(repoId) ?? new Map<number, PullListItem['review']>();

	pulls.set(number, review);
	window.set(repoId, pulls);
}
