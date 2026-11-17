import { expect, test } from 'bun:test';
import { commitAll, git, useCommittedRepos, writeTree } from '../../../helpers/git';
import { createRun, poolContext } from '../../../../src/review/pipeline/harness/context';
import { skillsStage } from '../../../../src/review/pipeline/harness/skills-stage';
import { reviewerUserPrompt } from '../../../../src/review/pipeline/reviewer-prompts';
import type { ReviewUnit } from '../../../../src/review/pipeline/units';
import { verifierUserPrompt } from '../../../../src/review/pipeline/verify';
import { candidateOf, reported } from '../candidate-repair-fixtures';

const committed = useCommittedRepos('recoder-skills-stage-');

function skill(name: string, description: string, body: string): string {
	return `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`;
}

async function revisionWithSkills() {
	const root = await committed({ '.agents/skills/lint/SKILL.md': skill('lint', 'Lint rules', 'target lint text') });
	const targetSha = git(root, ['rev-parse', 'HEAD']);

	await writeTree(root, { '.agents/skills/lint/SKILL.md': skill('lint', 'Lint rules', 'head lint text') });
	commitAll(root, 'head');

	const revision = {
		checkoutPath: root,
		headSha: git(root, ['rev-parse', 'HEAD']),
		targetSha,
		mergeBaseSha: targetSha,
		targetRef: 'main'
	};

	return { root, revision };
}

function unit(id: string): ReviewUnit {
	return {
		id,
		title: id,
		reason: 'Review it',
		scope: [{ path: `src/${id}.ts`, hunkIds: [id] }],
		lenses: ['correctness']
	};
}

test('the skills attached to a review reach every agent as the same block, read at the head', async () => {
	const { root, revision } = await revisionWithSkills();
	const run = createRun({ diff: '', sandboxPath: root, revision, skills: ['lint'] });

	await skillsStage(run);

	const context = poolContext(run);
	const remaining = { turns: 8, calls: 50 };
	const openings = ['a', 'b'].map((id) => reviewerUserPrompt(unit(id), remaining, context, '', 'Unit'));

	const verifier = verifierUserPrompt(
		candidateOf(reported()),
		run.evidence,
		{ intent: '', skills: context.skills, setupNotes: '' },
		8
	);

	expect(run.skills).toContain('head lint text');
	expect(run.skills).not.toContain('target lint text');
	expect(run.skills).toContain('- lint: Lint rules');

	for (const prompt of [...openings, verifier]) expect(prompt).toContain(run.skills);
});

test('a skill attached to the brief that the checkout lacks is reported and the catalog still reaches the agents', async () => {
	const { root, revision } = await revisionWithSkills();
	const logs: string[] = [];
	const run = createRun({ diff: '', sandboxPath: root, revision, skills: ['ghost'] }, { onLog: (m) => logs.push(m) });

	await skillsStage(run);

	expect(logs.join('\n')).toContain('ghost');
	expect(run.skills).toContain('- lint: Lint rules');
	expect(run.skills).not.toContain('head lint text');
});

test('a repository with no skills adds nothing to the agents’ prompts', async () => {
	const root = await committed({ 'README.md': '# Hi\n' });
	const sha = git(root, ['rev-parse', 'HEAD']);
	const revision = { checkoutPath: root, headSha: sha, targetSha: sha, mergeBaseSha: sha, targetRef: 'main' };
	const run = createRun({ diff: '', sandboxPath: root, revision });

	await skillsStage(run);

	expect(run.skills).toBe('');
});
