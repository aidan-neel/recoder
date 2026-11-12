import type { Provider, Repo } from './repo';
import type { Review } from './review';

/** One open PR as the Home screen sees it; the server joins its latest review. */
export interface HomeBriefPr {
	repoId: string;
	/** Disambiguated repository label (such as `owner/name`), for the model's wording. */
	repo: string;
	number: number;
	headSha: string;
	title: string;
	additions: number;
	deletions: number;
	changedFiles: number;
	createdAt: string;
}

/** Structured reference to a pull request cited in the Home brief. */
export interface HomeBriefRef {
	repoId: string;
	number: number;
}

export interface HomeBriefRequest {
	/** First name for the greeting; omitted when unknown. */
	name?: string | null;
	/** Viewer's local part of day, so the greeting matches their clock. */
	dayPart: 'morning' | 'afternoon' | 'evening' | 'night';
	prs: HomeBriefPr[];
	/** Tracked repos with no open PRs. */
	emptyRepos?: string[];
}

export interface HomeBriefResponse {
	/** Two or three sentences. `**phrase**` marks key phrases; PRs appear as `#123`. */
	text: string;
	/** Pull requests cited in `text`, in order of appearance. */
	refs: HomeBriefRef[];
	/** Canonical key of the open PR snapshot (`repoId#number@headSha`) this brief describes. */
	snapshot: string;
	generatedAt: string;
	model: string;
}

const PROVIDER_LABELS: Record<Provider, string> = {
	github: 'GitHub',
	gitlab: 'GitLab',
	local: 'local'
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isBriefRef(value: unknown): value is HomeBriefRef {
	return (
		isRecord(value) &&
		typeof value.repoId === 'string' &&
		value.repoId.length > 0 &&
		typeof value.number === 'number' &&
		Number.isInteger(value.number) &&
		value.number > 0
	);
}

/** Runtime check for persisted Home brief payloads on disk or in Web Storage. */
export function isHomeBriefResponse(value: unknown): value is HomeBriefResponse {
	return (
		isRecord(value) &&
		typeof value.text === 'string' &&
		typeof value.generatedAt === 'string' &&
		typeof value.model === 'string' &&
		typeof value.snapshot === 'string' &&
		Array.isArray(value.refs) &&
		value.refs.every(isBriefRef)
	);
}

function compareSnapshotTuple(a: readonly [string, number, string], b: readonly [string, number, string]): number {
	if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
	if (a[1] !== b[1]) return a[1] - b[1];
	if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;

	return 0;
}

/** Canonical key for an open pull request snapshot; changes when PRs open, close, or advance heads. */
export function briefSnapshotKey(prs: ReadonlyArray<Pick<HomeBriefPr, 'repoId' | 'number' | 'headSha'>>): string {
	const tuples = prs.map((pr): readonly [string, number, string] => [pr.repoId, pr.number, pr.headSha]);

	tuples.sort(compareSnapshotTuple);

	return JSON.stringify(tuples);
}

/** True when `preceding` ends with `label` as a complete repository token rather than a suffix of a longer slug. */
export function endsWithRepoLabel(preceding: string, label: string): boolean {
	const trimmed = preceding.replace(/[\s*]+$/, '');
	const target = label.trim();

	if (!target || trimmed.length < target.length) return false;

	const start = trimmed.length - target.length;

	if (trimmed.slice(start).toLowerCase() !== target.toLowerCase()) return false;
	if (start === 0) return true;

	return !/[a-z0-9_./-]/i.test(trimmed[start - 1]);
}

function parseRemoteRepoUrl(rawUrl: string, provider: Provider): { host: string; owner: string } | null {
	const trimmed = rawUrl.trim();

	if (!trimmed || provider === 'local' || /^file:\/\//i.test(trimmed)) return null;

	const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(trimmed);
	const href = scp ? `https://${scp[1]}/${scp[2]}` : trimmed;

	let parsed: URL;

	try {
		parsed = new URL(href);
	} catch {
		return null;
	}

	const parts = parsed.pathname
		.replace(/\.git\/?$/i, '')
		.split('/')
		.filter(Boolean);

	const dashIndex = parts.indexOf('-');
	const namespaceParts = dashIndex === -1 ? parts : parts.slice(0, dashIndex);

	if (namespaceParts.length < 2) return null;

	const owner = provider === 'github' ? namespaceParts[0] : namespaceParts.slice(0, -1).join('/');

	return { host: parsed.host.toLowerCase().replace(/^www\./, ''), owner };
}

function localParentDir(rawUrl: string): string | null {
	if (!/^file:\/\//i.test(rawUrl.trim())) return null;

	try {
		const parts = decodeURIComponent(new URL(rawUrl.trim()).pathname).split('/').filter(Boolean);

		return parts.length >= 2 ? parts[parts.length - 2] : null;
	} catch {
		return null;
	}
}

/** Derives a repository's owner or group namespace from its remote URL, or from `owner/name` when present. */
export function repoOwner(repo: Pick<Repo, 'name' | 'url' | 'provider'>): string | null {
	const remote = parseRemoteRepoUrl(repo.url, repo.provider);

	if (remote) return remote.owner;

	if (repo.provider !== 'local' && repo.name.includes('/')) {
		return repo.name.split('/').slice(0, -1).join('/') || null;
	}

	return null;
}

function countLowercaseCollisions(values: Iterable<string>): Map<string, number> {
	const counts = new Map<string, number>();

	for (const value of values) {
		const key = value.toLowerCase();

		counts.set(key, (counts.get(key) ?? 0) + 1);
	}

	return counts;
}

/**
 * Distinct display labels keyed by `repo.id`. Includes `owner/name` when the URL
 * or name carries an owner, and adds provider, host, local parent folder, or id
 * whenever two repositories would still read the same.
 */
export function repoLabels(repos: ReadonlyArray<Pick<Repo, 'id' | 'name' | 'url' | 'provider'>>): Map<string, string> {
	const uniqueRepos: Pick<Repo, 'id' | 'name' | 'url' | 'provider'>[] = [];
	const seenIds = new Set<string>();

	for (const repo of repos) {
		if (seenIds.has(repo.id)) continue;
		seenIds.add(repo.id);
		uniqueRepos.push(repo);
	}

	const stageOne = uniqueRepos.map((repo) => {
		const owner = repoOwner(repo);
		const leaf = repo.name.split('/').pop() || repo.name;
		const base = owner ? `${owner}/${leaf}` : repo.name;

		return { repo, base };
	});

	const baseCounts = countLowercaseCollisions(stageOne.map((entry) => entry.base));

	const stageTwo = stageOne.map(({ repo, base }) => {
		if ((baseCounts.get(base.toLowerCase()) ?? 0) <= 1) return { repo, base, label: base };

		return { repo, base, label: `${base} (${PROVIDER_LABELS[repo.provider]})` };
	});

	const providerCounts = countLowercaseCollisions(stageTwo.map((entry) => entry.label));

	const stageThree = stageTwo.map(({ repo, base, label }) => {
		if ((providerCounts.get(label.toLowerCase()) ?? 0) <= 1) return { repo, label };

		const remote = parseRemoteRepoUrl(repo.url, repo.provider);

		if (remote?.host) return { repo, label: `${base} (${remote.host})` };

		const parent = localParentDir(repo.url);

		if (parent && !base.includes('/')) return { repo, label: `${parent}/${base} (${PROVIDER_LABELS[repo.provider]})` };

		return { repo, label };
	});

	const hostCounts = countLowercaseCollisions(stageThree.map((entry) => entry.label));

	const result = new Map<string, string>();

	for (const { repo, label } of stageThree) {
		const finalLabel = (hostCounts.get(label.toLowerCase()) ?? 0) > 1 ? `${label} · ${repo.id}` : label;

		result.set(repo.id, finalLabel);
	}

	return result;
}

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
