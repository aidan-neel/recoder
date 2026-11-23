import {
	PERSON_WINDOW_DAYS,
	type PersonMembership,
	type PersonProfile,
	type Repo,
	type ReviewListItem
} from '@recoder/shared';

import { forgeLabel } from '../connections/forges';
import { isCancelled, isReviewing, openCounts, pullRow, shortRepoName } from '../pulls/pull-rows';
import { dayDate } from '../shell/age';
import { plural, pullRef, pullTitle } from '../shell/format';
import { pullHref, repoHref } from '../shell/routes';
import type { MergedRow, RepoFigure } from '../repo/types';
import { displayName } from './refs';
import type { PersonPageData, PersonReviewRow, PersonStanding } from './types';

/** The pill beside the name: a member's role, someone who never signed in, a removed member, or a bot. */
function standingOf(membership: PersonMembership, bot: boolean): PersonStanding {
	if (bot) return { label: 'Bot', tone: 'neutral' };
	if (membership.status === 'removed') return { label: 'Removed from this server', tone: 'danger' };
	if (membership.status === 'none') return { label: 'Not on this server', tone: 'neutral' };

	return { label: membership.role === 'admin' ? 'Admin' : 'Member', tone: 'ok' };
}

function figuresOf({ figures }: PersonProfile): RepoFigure[] {
	return [
		{
			id: 'open',
			label: 'Open pull requests',
			value: String(figures.openPulls),
			detail: figures.unreviewed > 0 ? `${figures.unreviewed} not reviewed` : null,
			tone: null
		},
		{
			id: 'merged',
			label: `Merged, ${PERSON_WINDOW_DAYS} days`,
			value: String(figures.merged),
			detail: null,
			tone: null
		},
		{ id: 'reviews', label: 'Reviews run', value: String(figures.reviewsRun), detail: null, tone: null },
		{
			id: 'bugs',
			label: 'Open bugs on their pull requests',
			value: String(figures.openBugs),
			detail: null,
			tone: figures.openBugs > 0 ? 'high' : null
		},
		{
			id: 'fixed',
			label: 'Findings fixed',
			value: String(figures.findingsFixed),
			detail: figures.findingsRaised > 0 ? `of ${figures.findingsRaised}` : null,
			tone: null
		}
	];
}

/** A review as the profile words it, in the list's words. */
function reviewRow(review: ReviewListItem, repos: Repo[] | null, base: string): PersonReviewRow {
	const ref = pullRef(shortRepoName(repos, review.repoId), review.prNumber);

	const row = {
		id: review.id,
		title: pullTitle(review.prTitle, review.prNumber),
		ref,
		href: pullHref(base, review.repoId, review.prNumber, 'review')
	};

	if (isReviewing(review)) return { ...row, outcome: 'Reviewing', tone: 'neutral' };
	if (isCancelled(review)) return { ...row, outcome: 'Cancelled', tone: 'neutral' };
	if (review.status === 'failed') return { ...row, outcome: 'Failed', tone: 'danger' };

	const counts = openCounts(review);

	if (counts.bugs > 0) return { ...row, outcome: plural(counts.bugs, 'bug'), tone: 'high' };
	if (counts.warnings > 0) return { ...row, outcome: plural(counts.warnings, 'warning'), tone: 'medium' };

	return { ...row, outcome: 'No bugs', tone: 'ok' };
}

/** The profile page's data from the server's profile and the tracked repositories. */
export function personPageData(profile: PersonProfile, repos: Repo[] | null, base: string): PersonPageData {
	const { person, membership } = profile;

	return {
		person,
		name: displayName(person),
		handle: displayName({ login: person.login }),
		forge: { url: person.forgeUrl, label: forgeLabel(person.provider) },
		standing: standingOf(membership, person.bot),
		since: membership.status === 'member' ? `Member since ${dayDate(membership.joinedAt)}` : null,
		accountId: profile.canMessage && membership.status === 'member' ? membership.accountId : null,
		invitable: membership.status === 'none' && !person.bot,
		figures: figuresOf(profile),
		open: profile.openPulls.map((item) => pullRow({ item, review: item.review }, repos, base)),
		merged: profile.recentlyMerged.map((item): MergedRow => ({
			key: `${item.repoId}#${item.pull.number}`,
			number: item.pull.number,
			title: item.pull.title,
			mergedAt: item.status.updatedAt,
			outcome: mergedOutcome(item.review),
			href: pullHref(base, item.repoId, item.pull.number)
		})),
		repos: profile.repositories.map((repo) => ({
			repoId: repo.repoId,
			name: repo.name,
			pulls: plural(repo.pulls, 'pull request'),
			href: repoHref(base, repo.repoId)
		})),
		reviews: profile.reviewsRun.map((review) => reviewRow(review, repos, base)),
		failures: profile.failures.map((failure) => shortRepoName(repos, failure.repoId)),
		window: `${PERSON_WINDOW_DAYS} days`
	};
}

/** What a merged pull request's reviews left: "3 fixed" when findings were accepted, "Clean" otherwise. */
function mergedOutcome(review: ReviewListItem | null): string {
	const fixed = review?.findings.filter((finding) => finding.decision?.state === 'accepted').length ?? 0;

	return fixed > 0 ? `${fixed} fixed` : 'Clean';
}
