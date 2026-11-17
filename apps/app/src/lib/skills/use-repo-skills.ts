'use client';

import type { SkillSummary } from '@recoder/shared';
import { useEffect, useState } from 'react';

import { useApi } from '../api/client';

/** Where the skills come from: a repository, and a pull request whose head may add its own. */
interface SkillSource {
	repoId: string | null;
	pull?: number;
}

/** The skills read for one source, so a list for another repository never shows while the next one loads. */
interface ReadSkills {
	key: string;
	skills: readonly SkillSummary[];
}

/** No skills: while they load, with no repository, or when the list cannot be read. */
const NO_SKILLS: readonly SkillSummary[] = [];

/**
 * The skills a composer's "/" offers for a repository: the ones it ships for
 * agents, and with a pull request the ones its head adds. None while they
 * load or when there is no repository. A list that cannot be read offers
 * none, the same as a repository with no skills: a message sends the same
 * without one, so the failure is not worth a line in the composer.
 */
export function useRepoSkills({ repoId, pull }: SkillSource): readonly SkillSummary[] {
	const client = useApi();
	const [read, setRead] = useState<ReadSkills | null>(null);
	const key = repoId ? `${repoId}#${pull ?? ''}` : null;

	useEffect(() => {
		if (!repoId || !key) return;

		let current = true;

		client.repoSkills(repoId, pull).then(
			(skills) => {
				if (current) setRead({ key, skills });
			},
			() => {
				if (current) setRead({ key, skills: [] });
			}
		);

		return () => {
			current = false;
		};
	}, [client, repoId, pull, key]);

	return read && read.key === key ? read.skills : NO_SKILLS;
}
