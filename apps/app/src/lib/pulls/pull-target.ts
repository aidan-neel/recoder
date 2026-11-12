import type { PullListItem, Repo } from '@recoder/shared';

import { parseRepoInput, repoKey } from '../connections/repo-input';
import { repoName } from '../shell/format';
import { parsePullRef, reposFor, type PullRef } from '../shell/pull-ref';
import { pullHref } from '../shell/routes';
import type { PullTarget } from './types';

/** What text is read against: the tracked repositories and their open pull requests. */
export interface TargetContext {
	repos: Repo[];
	/** Open pull requests, to find one by its branch. */
	pulls: PullListItem[];
	base: string;
	/** Where a bare number or a branch is looked up; null takes the only tracked repository. */
	repoId: string | null;
}

/** The pull request the text points at, and what the person asked the review to look at after it. */
export interface ReadTarget {
	target: PullTarget;
	brief: string | null;
	/** The word the target was read from (a link, `#12`, a branch); null for empty text. */
	reference: string | null;
}

/** Punctuation between the reference and what the person asks: `#12: look at…`, `fix/lease — only…`. */
const BRIEF_LEAD = /^[\s:,;—–-]+/;

type Read = Omit<ReadTarget, 'reference'>;

function invalid(reason: string): Read {
	return { target: { kind: 'invalid', reason }, brief: null };
}

function pullIn(repo: Repo, number: number, context: TargetContext, brief: string): Read {
	return {
		target: {
			kind: 'pull',
			repoId: repo.id,
			repoName: repoName(repo.name),
			number,
			href: pullHref(context.base, repo.id, number)
		},
		brief: brief || null
	};
}

/** The repository a bare number or a branch is looked up in. */
function homeRepo(context: TargetContext): Repo | null {
	if (context.repoId) return context.repos.find((repo) => repo.id === context.repoId) ?? null;

	return context.repos.length === 1 ? context.repos[0] : null;
}

/** A link to a pull request: in a tracked repository it opens; otherwise its repository can be tracked first. */
function fromLink(link: string, ref: PullRef, context: TargetContext, brief: string): Read {
	const tracked = context.repos.find((repo) => repoKey(repo.url) === ref.address);

	if (tracked) return pullIn(tracked, ref.number, context, brief);

	const parsed = parseRepoInput(link);

	if (!parsed.ok) return invalid(parsed.error);

	return {
		target: { kind: 'untracked', repoUrl: parsed.repo.url, repoName: parsed.repo.name, number: ref.number },
		brief: brief || null
	};
}

/** `12`, `#12` or `api#12`: the number in the repository it names, or in the home repository. */
function fromShortRef(ref: PullRef, context: TargetContext, brief: string): Read {
	if (context.repos.length === 0) return invalid('Track a repository first.');

	if (ref.name) {
		const named = reposFor(ref, context.repos);

		if (named.length === 1) return pullIn(named[0], ref.number, context, brief);
		if (named.length === 0) return invalid(`No tracked repository is called ${ref.name}.`);

		return invalid(`More than one tracked repository is called ${ref.name}. Paste the link instead.`);
	}

	const home = homeRepo(context);

	if (!home) return invalid('Name the repository too, like api#12, or paste the link.');

	return pullIn(home, ref.number, context, brief);
}

/** The open pull request from a branch of the home repository. */
function fromBranch(branch: string, context: TargetContext, brief: string): Read {
	const home = homeRepo(context);
	const open = context.pulls.find((item) => item.repoId === home?.id && item.pull.headRef === branch);

	if (!home || !open) return invalid('Paste a pull request link, its number, or its branch.');

	return pullIn(home, open.pull.number, context, brief);
}

/**
 * Reads pasted or typed text: a pull request link, `#158`, `158`, `api#158`
 * or a branch name, then optionally what the review should look at.
 */
export function readTarget(text: string, context: TargetContext): ReadTarget {
	const trimmed = text.trim();

	if (!trimmed) return { target: { kind: 'empty' }, brief: null, reference: null };

	const first = trimmed.split(/\s/, 1)[0];
	const brief = trimmed.slice(first.length).replace(BRIEF_LEAD, '');
	const word = first.replace(/[:,;]$/, '');
	const ref = parsePullRef(word);

	return { ...readReference(word, ref, context, brief), reference: word };
}

/** What one reference names: a link, a short form, or a branch. */
function readReference(word: string, ref: PullRef | null, context: TargetContext, brief: string): Read {
	if (!ref) return fromBranch(word, context, brief);
	if (ref.address !== null) return fromLink(word, ref, context, brief);

	return fromShortRef(ref, context, brief);
}
