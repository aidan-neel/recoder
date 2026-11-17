import { MAX_MESSAGE_SKILLS, skillMentions, type Repo, type SkillSummary } from '@recoder/shared';
import { GhError } from '../forge/cli';
import { pullHead } from '../forge/pulls/cached';
import { RepoFilesError } from '../repo-files/errors';
import { isRepoRef } from '../repo-files/paths';
import { resolveCommit } from '../repo-files/source';
import { findSkills, listSkills, type LoadedSkill, type SkillRevision } from './discovery';

/** Skills were attached that the repository does not have. */
export class UnknownSkillError extends Error {
	constructor(readonly names: string[]) {
		super(`This repository has no ${names.length === 1 ? 'skill' : 'skills'} named ${names.map(quoted).join(', ')}.`);
		this.name = 'UnknownSkillError';
	}
}

function quoted(name: string): string {
	return `"${name}"`;
}

/**
 * The commits to read a repository's skills at: `headSha` when the repository's git copies hold it (a pull
 * request's head, which a name from the default branch yields to), then the default branch. Throws a
 * `RepoFilesError` when the default branch cannot be read.
 */
async function repoSkillRevisions(
	repo: Repo,
	headSha: string | null | undefined,
	signal: AbortSignal
): Promise<SkillRevision[]> {
	const head = headSha && isRepoRef(headSha) ? await availableCommit(repo, headSha, signal) : null;
	const base = await resolveCommit(repo, undefined, signal);

	return [...(head ? [head] : []), { root: base.root, sha: base.commit }];
}

/** The commit `ref` names in a git copy on this server, or null when no copy holds it yet. */
async function availableCommit(repo: Repo, ref: string, signal: AbortSignal): Promise<SkillRevision | null> {
	try {
		const found = await resolveCommit(repo, ref, signal);

		return { root: found.root, sha: found.commit };
	} catch (error) {
		if (error instanceof RepoFilesError) return null;

		throw error;
	}
}

/** The skills a repository ships on its default branch and, when `headSha` is given and held locally, at that head. */
export async function listRepoSkills(
	repo: Repo,
	headSha: string | null | undefined,
	signal: AbortSignal
): Promise<SkillSummary[]> {
	return listSkills(await repoSkillRevisions(repo, headSha, signal), signal);
}

/**
 * The skills a message asks for: the ones attached by name, which the repository must have, then the ones its text
 * mentions with `/name`, which are skipped when it has none of that name, since `/` also starts a path. At most
 * `MAX_MESSAGE_SKILLS` in all, attached ones first.
 */
export interface SkillRequest {
	attached: readonly string[];
	mentioned: readonly string[];
}

/** The request for a message's attached skill names and its text. */
export function skillRequest(attached: readonly string[] | undefined, text: string | undefined): SkillRequest {
	const named = attached ?? [];
	const mentioned = skillMentions(text ?? '').filter((name) => !named.includes(name));

	return { attached: named, mentioned: mentioned.slice(0, Math.max(0, MAX_MESSAGE_SKILLS - named.length)) };
}

/**
 * The requested skills found at `revisions`, with their text. Throws `UnknownSkillError` naming every attached
 * skill the repository lacks, so a message is never sent with one missing from it.
 */
export async function findRequestedSkills(
	revisions: readonly SkillRevision[],
	request: SkillRequest,
	signal: AbortSignal
): Promise<LoadedSkill[]> {
	const { skills, missing } = await findSkills(revisions, [...request.attached, ...request.mentioned], signal);
	const unknown = missing.filter((name) => request.attached.includes(name));

	if (unknown.length > 0) throw new UnknownSkillError(unknown);

	return skills;
}

/** The names of loaded skills, as a message records them. */
export function skillNames(skills: readonly SkillSummary[]): string[] {
	return skills.map((skill) => skill.name);
}

/** Whether a request names no skill at all, so nothing has to be read. */
export function isEmptyRequest(request: SkillRequest): boolean {
	return request.attached.length === 0 && request.mentioned.length === 0;
}

/**
 * The requested skills with their text, read where `listRepoSkills` lists them (`findRequestedSkills`). A request
 * that only mentions names reads none while this server has no git copy yet, such as before a repository's first
 * review, rather than refusing the message; one that attaches names throws the `RepoFilesError`.
 */
export async function loadRepoSkills(
	repo: Repo,
	request: SkillRequest,
	headSha: string | null | undefined,
	signal: AbortSignal
): Promise<LoadedSkill[]> {
	if (isEmptyRequest(request)) return [];

	try {
		return await findRequestedSkills(await repoSkillRevisions(repo, headSha, signal), request, signal);
	} catch (error) {
		if (error instanceof RepoFilesError && request.attached.length === 0) return [];

		throw error;
	}
}

/** A pull request's head commit from the forge, or null when the forge cannot say. */
export async function pullHeadSha(repo: Repo, pull: number): Promise<string | null> {
	try {
		return await pullHead(repo, pull);
	} catch (error) {
		if (error instanceof GhError) return null;

		throw error;
	}
}
