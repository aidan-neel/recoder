'use client';

import type { SkillSummary } from '@recoder/shared';
import type { ComposerMentions } from '@recoder/ui';
import { useEffect, useMemo, useState } from 'react';

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

/**
 * What a composer's "@" offers for a repository: the skills it ships for
 * agents, and with a pull request the ones its head adds. Nothing while they
 * load or when there is no repository. A list that cannot be read leaves "@"
 * out, the same as a repository with no skills: a message sends the same
 * without one, so the failure is not worth a line in the composer.
 */
export function useRepoSkills({ repoId, pull }: SkillSource): ComposerMentions | undefined {
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

	const skills = read && read.key === key ? read.skills : null;

	return useMemo(() => (skills && skills.length > 0 ? { label: 'Skills', items: skills } : undefined), [skills]);
}
