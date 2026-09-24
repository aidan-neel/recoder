import type { HomeBriefRequest, PullRequest, Repo, Review } from '@recoder/shared';

/** Latest review per `repoId#pr`; a real review outranks a newer empty draft. */
export function latestReviews(reviews: Review[]): Map<string, Review> {
	const latest = new Map<string, Review>();
	const rank = (review: Review) => (review.status === 'draft' ? 0 : 1);
	for (const review of reviews) {
		const key = `${review.repoId}#${review.prNumber}`;
		const current = latest.get(key);
		if (
			!current ||
			rank(review) > rank(current) ||
			(rank(review) === rank(current) && Date.parse(review.updatedAt) > Date.parse(current.updatedAt))
		) {
			latest.set(key, review);
		}
	}
	return latest;
}

export const prKey = (repoId: string, n: number): string => `${repoId}#${n}`;

export function highCount(review: Review | undefined): number {
	return review?.findings.filter((finding) => finding.severity === 'error').length ?? 0;
}

export function isRunning(review: Review | undefined): boolean {
	return review?.status === 'running' || review?.status === 'queued';
}

export type StatusTone = 'neutral' | 'success' | 'high' | 'danger';

/** The row's resting status chip. Running reviews render progress instead. */
export function prStatus(review: Review | undefined): { tone: StatusTone; label: string } | null {
	if (!review) return { tone: 'neutral', label: 'Not reviewed' };
	if (review.status === 'draft') return { tone: 'neutral', label: 'Draft' };
	if (isRunning(review)) return null;
	if (review.status === 'failed') return { tone: 'danger', label: 'Failed' };
	const high = highCount(review);
	if (high > 0) return { tone: 'high', label: `${high} high open` };
	const n = review.findings.length;
	if (n === 0) return { tone: 'success', label: 'Clean' };
	return { tone: 'neutral', label: `${n} finding${n === 1 ? '' : 's'}` };
}

/** Compact age for the meta line: 5h, 1d, 3w. */
export function shortAge(iso: string): string {
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return '';
	const minutes = Math.max(0, (Date.now() - t) / 60_000);
	if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
	const hours = minutes / 60;
	if (hours < 24) return `${Math.round(hours)}h`;
	const days = hours / 24;
	if (days < 14) return `${Math.round(days)}d`;
	return `${Math.round(days / 7)}w`;
}

export function dayPart(date = new Date()): HomeBriefRequest['dayPart'] {
	const h = date.getHours();
	if (h < 5) return 'night';
	if (h < 12) return 'morning';
	if (h < 17) return 'afternoon';
	return 'evening';
}

/** A greeting name from a provider login: `aidan-neel` → `Aidan`. */
export function firstName(login: string | null | undefined): string | null {
	const part = login?.split(/[-_.\s]/)[0]?.replace(/\d+$/, '');
	if (!part || part.length < 2) return null;
	return part[0].toUpperCase() + part.slice(1).toLowerCase();
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const count = (n: number) => NUMBER_WORDS[n] ?? String(n);

export interface BriefPick {
	pr: PullRequest;
	repo: Repo;
	review?: Review;
}

/** The biggest open PR nobody has reviewed. */
export function pickToReview(items: BriefPick[]): BriefPick | null {
	return (
		items
			.filter((item) => !item.review || item.review.status === 'draft')
			.sort((a, b) => b.pr.additions + b.pr.deletions - (a.pr.additions + a.pr.deletions))[0] ?? null
	);
}

/** The reviewed PR with the most open high findings. */
export function pickToOpen(items: BriefPick[]): BriefPick | null {
	return (
		items.filter((item) => highCount(item.review) > 0).sort((a, b) => highCount(b.review) - highCount(a.review))[0] ??
		null
	);
}

/** Written locally when the model can't be reached, in the same markup as the AI brief. */
export function fallbackBrief(items: BriefPick[], name: string | null, part: HomeBriefRequest['dayPart']): string {
	const greeting = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Evening' }[part];
	const repos = new Set(items.map((item) => item.repo.id)).size;
	const parts = [`**${greeting}${name ? `, ${name}` : ''}.**`];
	if (items.length === 0) {
		parts.push('No pull requests are open right now.');
		return parts.join(' ');
	}
	parts.push(
		`${count(items.length)} pull request${items.length === 1 ? ' is' : 's are'} open across ${count(repos).toLowerCase()} repo${repos === 1 ? '' : 's'}.`
	);
	const review = pickToReview(items);
	if (review) {
		const lines = review.pr.additions + review.pr.deletions;
		parts.push(`#${review.pr.number} is the biggest one nobody has reviewed yet, ${lines} lines.`);
	}
	const open = pickToOpen(items);
	if (open) {
		const high = highCount(open.review);
		parts.push(`#${open.pr.number} still has ${count(high).toLowerCase()} high finding${high === 1 ? '' : 's'} open.`);
	}
	return parts.join(' ');
}

export type BriefSegment = { kind: 'text' | 'strong'; text: string } | { kind: 'pr'; text: string; number: number };

/** Split `**key phrase**` and `#123` out of the brief for styling. */
export function briefSegments(text: string): BriefSegment[] {
	const segments: BriefSegment[] = [];
	for (const part of text.split(/(\*\*[^*]+\*\*|#\d+\b)/g)) {
		if (!part) continue;
		if (part.startsWith('**') && part.endsWith('**')) segments.push({ kind: 'strong', text: part.slice(2, -2) });
		else if (/^#\d+$/.test(part)) segments.push({ kind: 'pr', text: part, number: Number(part.slice(1)) });
		else segments.push({ kind: 'text', text: part });
	}
	return segments;
}
