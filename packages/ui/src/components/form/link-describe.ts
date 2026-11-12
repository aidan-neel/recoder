/** What a link points at, read from its URL alone. */
type LinkKind = 'pull' | 'issue' | 'commit' | 'file' | 'repo' | 'link';

/** The forge a link lives on, when its URL says so; null for any other site. */
type LinkForge = 'github' | 'gitlab' | null;

/** A link as an embed shows it. Nothing here comes from the network: every field is read from the URL. */
export interface LinkDescription {
	url: string;
	kind: LinkKind;
	forge: LinkForge;
	/** The short form a developer would write: `api #214`, `project !12`, `api@1a2b3c4`, `middleware.ts:15`. */
	label: string;
	/** What a screen reader says: `acme/api pull request 214`. */
	name: string;
	/** `host/owner/name` of a forge link, lowercased, without `www.`, with the port when the link names one; null for any other link. */
	address: string | null;
	/** The pull, merge request or issue number, also on a commit seen inside a pull request; null otherwise. */
	number: number | null;
}

/** The page parts of a forge path that name a numbered item. */
const NUMBERED: Record<string, { kind: 'pull' | 'issue'; noun: string }> = {
	pull: { kind: 'pull', noun: 'pull request' },
	pulls: { kind: 'pull', noun: 'pull request' },
	merge_requests: { kind: 'pull', noun: 'merge request' },
	issues: { kind: 'issue', noun: 'issue' }
};

/** How many characters of a commit hash the label keeps, as git prints it. */
const SHORT_SHA = 7;

/** A forge path cut at its page part: the repository's segments, and what follows. */
interface ForgePath {
	forge: LinkForge;
	host: string;
	repo: string[];
	page: string[];
}

/**
 * Reads an `http:` or `https:` URL into what its embed shows. Pull and merge
 * requests, issues, commits, files and repositories on GitHub and GitLab
 * (subgroups, `/-/` pages and self-managed hosts included) get the forge and
 * a short label; a numbered `/pull/` or `/merge_requests/` page on any host
 * reads as a pull request too. Any other link is its host and a shortened
 * path.
 */
export function describeLink(url: string): LinkDescription {
	const parsed = parseUrl(url);

	if (!parsed) return plainLink(url, url, '');

	const path = forgePath(parsed);
	const forged = path ? forgeLink(url, path, parsed.hash) : null;

	return forged ?? plainLink(url, hostOf(parsed), parsed.pathname);
}

/** The URL, or null when it does not parse. */
function parseUrl(url: string): URL | null {
	try {
		return new URL(url);
	} catch {
		return null;
	}
}

/**
 * The host as people write it: lowercased, without `www.`, with the port when
 * the link names one. A forge on its own port is tracked under that port, so
 * a link's address must carry it to match.
 */
function hostOf(url: URL): string {
	return url.host.toLowerCase().replace(/^www\./, '');
}

/**
 * True for a forge's own host (`github.com`) and for a host named like a
 * self-managed one (`github.acme.dev`). The forge's other sites are not the
 * forge: `docs.github.com` and `acme.github.io` hold pages, not repositories.
 */
function isForgeHost(host: string, forge: 'github' | 'gitlab'): boolean {
	const labels = host.replace(/:\d+$/, '').split('.');
	const site = labels.slice(-2).join('.');

	if (site === `${forge}.com`) return labels.length === 2;
	if (site === `${forge}.io`) return false;

	return labels.slice(0, -1).includes(forge);
}

/** The pages GitLab serves after `/-/` that an embed names. On a host not named for GitLab, only these make `/-/` GitLab's. */
const DASH_PAGES = new Set(['merge_requests', 'issues', 'commit', 'blob', 'tree']);

/** Splits a path into the repository and the page: after the owner and name on GitHub, at GitLab's `/-/`, else at a numbered page on any host. */
function forgePath(url: URL): ForgePath | null {
	const host = hostOf(url);
	const segments = url.pathname.split('/').filter(Boolean).map(decodeSegment);

	if (isForgeHost(host, 'github')) {
		return { forge: 'github', host, repo: segments.slice(0, 2), page: segments.slice(2) };
	}

	const gitlab = isForgeHost(host, 'gitlab');
	const dash = segments.indexOf('-');

	if (dash > 0 && (gitlab || DASH_PAGES.has(segments[dash + 1]))) {
		return { forge: 'gitlab', host, repo: segments.slice(0, dash), page: segments.slice(dash + 1) };
	}

	const numbered = segments.findIndex((part, index) => part in NUMBERED && itemNumber(segments[index + 1]) !== null);
	const forge = gitlab ? 'gitlab' : null;

	if (numbered > 0) return { forge, host, repo: segments.slice(0, numbered), page: segments.slice(numbered) };

	return forge ? { forge, host, repo: segments, page: [] } : null;
}

/** A path segment as the number of a pull request or an issue: digits only, so `0x10`, `1e2` and `12.` are no number. */
function itemNumber(segment: string | undefined): number | null {
	if (segment === undefined || !/^\d+$/.test(segment)) return null;

	const number = Number(segment);

	return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** A path segment as text; a malformed escape stays as written. */
function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

/** A forge link's kind and label, or null when its page is not one an embed names. */
function forgeLink(url: string, path: ForgePath, hash: string): LinkDescription | null {
	const { repo, page } = path;

	if (repo.length < 2) return null;

	const full = repo.join('/');

	const base = {
		url,
		forge: path.forge,
		address: `${path.host}/${full}`.toLowerCase().replace(/\.git$/, ''),
		number: null
	};

	const short = repo[repo.length - 1].replace(/\.git$/, '');

	if (page.length === 0) return { ...base, kind: 'repo', label: full, name: `${full} repository` };

	const numbered = NUMBERED[page[0]];
	const number = itemNumber(page[1]);

	if (numbered && number !== null) {
		const sign = page[0] === 'merge_requests' ? '!' : '#';
		const commit = page[2] === 'commits' && page[3] ? page[3] : null;

		if (commit) return { ...commitLink(base, full, short, commit), number };

		return {
			...base,
			kind: numbered.kind,
			number,
			label: `${short} ${sign}${number}`,
			name: `${full} ${numbered.noun} ${number}`
		};
	}

	if (page[0] === 'commit' && page[1]) return commitLink(base, full, short, page[1]);

	if ((page[0] === 'blob' || page[0] === 'tree') && page.length > 2) return fileLink(base, full, page.slice(2), hash);

	return null;
}

type ForgeBase = Pick<LinkDescription, 'url' | 'forge' | 'address' | 'number'>;

/** A commit: `api@1a2b3c4`. */
function commitLink(base: ForgeBase, full: string, short: string, sha: string): LinkDescription {
	const hash = sha.slice(0, SHORT_SHA);

	return { ...base, kind: 'commit', label: `${short}@${hash}`, name: `${full} commit ${hash}` };
}

/** A file or folder: its last segment, with the line from a `#L15` or `#L15-L20` fragment. */
function fileLink(base: ForgeBase, full: string, filePath: string[], hash: string): LinkDescription {
	const line = /^#L(\d+)/.exec(hash)?.[1];
	const tail = filePath[filePath.length - 1];
	const label = line ? `${tail}:${line}` : tail;
	const where = line ? ` line ${line}` : '';

	return { ...base, kind: 'file', label, name: `${full} file ${filePath.join('/')}${where}` };
}

/** The longest path segment a plain link's label shows whole; the embed's width cuts the label again on screen. */
const SEGMENT_MAX = 40;

/** Any other link: the host and a path shortened to its first and last segments, each one capped. */
function plainLink(url: string, host: string, pathname: string): LinkDescription {
	const segments = pathname.split('/').filter(Boolean).map(decodeSegment).map(capSegment);

	const path =
		segments.length > 2
			? `/${segments[0]}/…/${segments[segments.length - 1]}`
			: segments.map((part) => `/${part}`).join('');

	const label = `${host}${path}` || url;

	return { url, kind: 'link', forge: null, label, name: `link to ${host || url}`, address: null, number: null };
}

/** A path segment cut to `SEGMENT_MAX` characters, with an ellipsis when cut. */
function capSegment(segment: string): string {
	return segment.length > SEGMENT_MAX ? `${segment.slice(0, SEGMENT_MAX - 1)}…` : segment;
}

/** The colour of a fact's dot: open or ready, needs attention, failed, or a plain state. */
type LinkFactTone = 'ok' | 'warning' | 'danger' | 'neutral';

/**
 * What the host already knows about a link, for its embed: the title of a
 * tracked pull request, its state, or why the link cannot be used. The kit
 * never looks this up; the host passes only facts it holds.
 */
export interface LinkFact {
	/** The title, shown in the card. */
	title?: string;
	/** The state in a few words (`Open`, `Not connected`), shown in the card beside a dot. */
	status?: string;
	/** Draws a dot on the embed in this tone; leave it out for no dot. */
	tone?: LinkFactTone;
}

/** Reads what the host knows about one link; undefined when it knows nothing. */
export type LinkFacts = (link: LinkDescription) => LinkFact | undefined;
