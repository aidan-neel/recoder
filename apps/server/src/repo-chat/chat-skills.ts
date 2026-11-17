import type { Repo, SkillSummary } from '@recoder/shared';
import { RepoFilesError } from '../repo-files/errors';
import { listSkills, type LoadedSkill } from '../skills/discovery';
import { findRequestedSkills, isEmptyRequest, type SkillRequest } from '../skills/repo-skills';
import { repoAtDefaultBranch } from './repo-context';

/** The skills on the repository's default branch; none while this server has no git copy to read them from. */
export async function chatSkillCatalog(repo: Repo, signal: AbortSignal): Promise<SkillSummary[]> {
	const tree = await repoAtDefaultBranch(repo);

	return tree ? listSkills([{ root: tree.root, sha: tree.sha }], signal) : [];
}

/**
 * The requested skills of the default branch, with their text. Throws `UnknownSkillError` naming every attached one
 * the repository lacks, and a `RepoFilesError` when this server has no git copy to read attached ones from;
 * mentioned ones are left out then, since a `/` may start a path.
 */
export async function chatSkills(repo: Repo, request: SkillRequest, signal: AbortSignal): Promise<LoadedSkill[]> {
	if (isEmptyRequest(request)) return [];

	const tree = await repoAtDefaultBranch(repo);

	if (!tree && request.attached.length === 0) return [];
	if (!tree)
		throw new RepoFilesError('This repository has no git copy on this server yet; try again in a moment.', 503);

	return findRequestedSkills([{ root: tree.root, sha: tree.sha }], request, signal);
}
