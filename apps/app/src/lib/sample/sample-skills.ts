import type { SkillSummary } from '@recoder/shared';

/** How long the sample waits before it answers, like a server reading the repository. */
const LATENCY_MS = 180;

/** The skills every sample repository ships on its default branch. */
const BRANCH_SKILLS: readonly SkillSummary[] = [
	{
		name: 'api-errors',
		description: 'How handlers map failures to status codes and error bodies',
		path: '.agents/skills/api-errors/SKILL.md'
	},
	{
		name: 'migrations',
		description: 'Writing a schema migration that runs safely on a live database',
		path: '.claude/skills/migrations/SKILL.md'
	},
	{
		name: 'release-notes',
		description: 'Writing the release note a user-facing change needs',
		path: '.claude/skills/release-notes/SKILL.md'
	}
];

/** The skill a sample pull request's head adds. */
const HEAD_SKILL: SkillSummary = {
	name: 'rate-limits',
	description: 'Where limits live and how a new endpoint picks one',
	path: '.agents/skills/rate-limits/SKILL.md'
};

/** The sample's repository skills: the same few on every repository, and one more on a pull request's head. */
export function createSampleSkills() {
	return {
		async repoSkills(_repoId: string, pull?: number): Promise<SkillSummary[]> {
			await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));

			const skills = pull === undefined ? BRANCH_SKILLS : [...BRANCH_SKILLS, HEAD_SKILL];

			return [...skills].sort((a, b) => a.name.localeCompare(b.name));
		}
	};
}
