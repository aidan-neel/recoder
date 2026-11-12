import {
	repoLabels,
	type HomeBriefPr,
	type HomeBriefRef,
	type HomeBriefRequest,
	type PullRequest,
	type Repo,
	type Review
} from '@recoder/shared';

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

/** Maps open PR items into the request payload sent to `/api/home/brief`. */
export function toBriefPrs(items: ReadonlyArray<BriefPick>, labels: ReadonlyMap<string, string>): HomeBriefPr[] {
	return items.map(({ pr, repo }) => ({
		repoId: repo.id,
		repo: labels.get(repo.id) ?? repo.name,
		number: pr.number,
		headSha: pr.headSha,
		title: pr.title,
		additions: pr.additions,
		deletions: pr.deletions,
		changedFiles: pr.changedFiles,
		createdAt: pr.createdAt
	}));
}

/** Formats `#123` for a brief mention or button, prefixing the repo label when two open PRs share `#123`. */
export function actionPrLabel(
	pick: BriefPick,
	items: ReadonlyArray<BriefPick>,
	labels: ReadonlyMap<string, string>
): string {
	const sharedNumber = items.some((item) => item.pr.number === pick.pr.number && item.repo.id !== pick.repo.id);

	if (!sharedNumber) return `#${pick.pr.number}`;

	return `${labels.get(pick.repo.id) ?? pick.repo.name} #${pick.pr.number}`;
}

/**
 * Resolves the Review and Open action button targets strictly from the structured
 * PR references carried by the active brief, so buttons never name another PR.
 */
export function briefActions(
	items: ReadonlyArray<BriefPick>,
	refs: ReadonlyArray<HomeBriefRef>
): { reviewPick: BriefPick | null; openPick: BriefPick | null } {
	const byKey = new Map(items.map((item) => [prKey(item.repo.id, item.pr.number), item] as const));
	const seen = new Set<string>();
	const referenced: BriefPick[] = [];

	for (const ref of refs) {
		const key = prKey(ref.repoId, ref.number);

		if (seen.has(key)) continue;

		const item = byKey.get(key);

		if (!item) continue;
		seen.add(key);
		referenced.push(item);
	}

	const reviewPick =
		referenced.find((item) => !item.review || item.review.status === 'draft' || item.review.status === 'failed') ??
		null;

	const openPick =
		referenced.find(
			(item) =>
				!!item.review &&
				!isRunning(item.review) &&
				item.review.status !== 'draft' &&
				item.review.status !== 'failed' &&
				highCount(item.review) > 0
		) ?? null;

	return { reviewPick, openPick };
}

function pickToReview(items: BriefPick[]): BriefPick | null {
	return (
		items
			.filter((item) => !item.review || item.review.status === 'draft')
			.sort((a, b) => b.pr.additions + b.pr.deletions - (a.pr.additions + a.pr.deletions))[0] ?? null
	);
}

function pickToOpen(items: BriefPick[]): BriefPick | null {
	return (
		items.filter((item) => highCount(item.review) > 0).sort((a, b) => highCount(b.review) - highCount(a.review))[0] ??
		null
	);
}

/**
 * Written locally when the model hasn't answered yet or can't be reached,
 * returning both prose and structured PR references from the same snapshot.
 */
export function fallbackBrief(
	items: BriefPick[],
	name: string | null,
	part: HomeBriefRequest['dayPart'],
	labels: ReadonlyMap<string, string> = repoLabels(items.map((item) => item.repo))
): { text: string; refs: HomeBriefRef[] } {
	const greeting = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Evening' }[part];
	const repos = new Set(items.map((item) => item.repo.id)).size;
	const parts = [`**${greeting}${name ? `, ${name}` : ''}.**`];
	const refs: HomeBriefRef[] = [];

	if (items.length === 0) {
		parts.push('No pull requests are open right now.');

		return { text: parts.join(' '), refs };
	}

	parts.push(
		`${count(items.length)} pull request${items.length === 1 ? ' is' : 's are'} open across ${count(repos).toLowerCase()} repo${repos === 1 ? '' : 's'}.`
	);

	const review = pickToReview(items);

	if (review) {
		const lines = review.pr.additions + review.pr.deletions;

		refs.push({ repoId: review.repo.id, number: review.pr.number });
		parts.push(`${actionPrLabel(review, items, labels)} is the biggest one nobody has reviewed yet, ${lines} lines.`);
	}

	const open = pickToOpen(items);

	if (open) {
		const high = highCount(open.review);

		refs.push({ repoId: open.repo.id, number: open.pr.number });

		parts.push(
			`${actionPrLabel(open, items, labels)} still has ${count(high).toLowerCase()} high finding${high === 1 ? '' : 's'} open.`
		);
	}

	return { text: parts.join(' '), refs };
}

export type BriefSegment =
	| { kind: 'text' | 'strong'; text: string }
	| { kind: 'pr'; text: string; number: number; ref?: HomeBriefRef; item?: BriefPick };

function resolveSegmentRef(
	num: number,
	tokenTotal: number,
	list: ReadonlyArray<HomeBriefRef>,
	cursor: number,
	preceding: string,
	items: ReadonlyArray<BriefPick>,
	labels: ReadonlyMap<string, string>
): { ref: HomeBriefRef | undefined; nextCursor: number } {
	if (list.length === 0) return { ref: undefined, nextCursor: cursor };

	if (tokenTotal <= list.length) {
		return { ref: list[cursor], nextCursor: cursor + 1 };
	}

	const distinctRepos = new Set(list.map((entry) => entry.repoId));
	const openMatches = items.filter((item) => item.pr.number === num);

	if (distinctRepos.size === 1 && openMatches.length <= 1) {
		return { ref: list[0], nextCursor: cursor + 1 };
	}

	const candidate = list[cursor];

	if (!candidate) return { ref: undefined, nextCursor: cursor };

	const label = labels.get(candidate.repoId);

	if (label && preceding.trimEnd().toLowerCase().endsWith(label.toLowerCase())) {
		return { ref: candidate, nextCursor: cursor + 1 };
	}

	return { ref: undefined, nextCursor: cursor };
}

/**
 * Splits `**key phrase**` and `#123` out of the brief, binding each `#123` to its
 * repository-scoped reference and open PR item rather than matching `#123` globally.
 */
export function briefSegments(
	text: string,
	refs: ReadonlyArray<HomeBriefRef> = [],
	items: ReadonlyArray<BriefPick> = []
): BriefSegment[] {
	const rawParts = text.split(/(\*\*[^*]+\*\*|#\d+\b)/g);
	const tokenCounts = new Map<number, number>();

	for (const part of rawParts) {
		if (/^#\d+$/.test(part)) {
			const num = Number(part.slice(1));

			tokenCounts.set(num, (tokenCounts.get(num) ?? 0) + 1);
		}
	}

	const refsByNumber = new Map<number, HomeBriefRef[]>();

	for (const ref of refs) {
		const list = refsByNumber.get(ref.number) ?? [];

		list.push(ref);
		refsByNumber.set(ref.number, list);
	}

	const byKey = new Map(items.map((item) => [prKey(item.repo.id, item.pr.number), item] as const));
	const labels = repoLabels(items.map((item) => item.repo));
	const cursors = new Map<number, number>();
	const segments: BriefSegment[] = [];
	let plainSoFar = '';

	for (const part of rawParts) {
		if (!part) continue;

		if (part.startsWith('**') && part.endsWith('**')) {
			const inner = part.slice(2, -2);

			segments.push({ kind: 'strong', text: inner });
			plainSoFar += inner;
		} else if (/^#\d+$/.test(part)) {
			const number = Number(part.slice(1));
			const cursor = cursors.get(number) ?? 0;

			const { ref, nextCursor } = resolveSegmentRef(
				number,
				tokenCounts.get(number) ?? 0,
				refsByNumber.get(number) ?? [],
				cursor,
				plainSoFar,
				items,
				labels
			);

			cursors.set(number, nextCursor);

			const item = ref ? byKey.get(prKey(ref.repoId, ref.number)) : undefined;

			segments.push({
				kind: 'pr',
				text: part,
				number,
				...(ref ? { ref } : {}),
				...(item ? { item } : {})
			});

			plainSoFar += part;
		} else {
			segments.push({ kind: 'text', text: part });
			plainSoFar += part;
		}
	}

	return segments;
}
