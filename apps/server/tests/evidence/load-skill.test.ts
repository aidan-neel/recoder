import { expect, test } from 'bun:test';
import { EvidenceStore } from '../../src/evidence/evidence';
import { toolAction } from '../../src/evidence/native-tools';
import type { ReviewRevision } from '../../src/evidence/types';
import { buildInventory } from '../../src/review/pipeline/inventory';
import { commitAll, git, useCommittedRepos, writeTree } from '../helpers/git';

const committed = useCommittedRepos('recoder-load-skill-');

function skill(name: string, body: string): string {
	return `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}\n`;
}

/** A checkout whose target has `shared` and `target-only`; its head changes `shared`, adds `head-only` and drops `target-only`. */
async function checkout(): Promise<ReviewRevision> {
	const root = await committed({
		'.agents/skills/shared/SKILL.md': skill('shared', 'target text'),
		'.agents/skills/target-only/SKILL.md': skill('target-only', 'target-only text')
	});

	const targetSha = git(root, ['rev-parse', 'HEAD']);

	git(root, ['rm', '-q', '-r', '.agents/skills/target-only']);

	await writeTree(root, {
		'.agents/skills/shared/SKILL.md': skill('shared', 'head text'),
		'.agents/skills/head-only/SKILL.md': skill('head-only', 'head-only text')
	});

	commitAll(root, 'head');

	return {
		checkoutPath: root,
		headSha: git(root, ['rev-parse', 'HEAD']),
		targetSha,
		mergeBaseSha: targetSha,
		targetRef: 'main'
	};
}

function load(store: EvidenceStore, name: string) {
	return store.executeRound([{ action: 'loadSkill', skill: name }]).then(([result]) => result);
}

test('load_skill reads the skill at the head, then falls back to the target', async () => {
	const store = new EvidenceStore(await checkout(), buildInventory(''), 20_000);

	const shared = await load(store, 'shared');
	const headOnly = await load(store, 'head-only');
	const targetOnly = await load(store, 'target-only');

	expect(shared).toMatchObject({ ok: true, revision: 'head', path: '.agents/skills/shared/SKILL.md' });
	expect(shared.content).toContain('head text');
	expect(headOnly.revision).toBe('head');
	expect(targetOnly).toMatchObject({ ok: true, revision: 'target' });
	expect(targetOnly.content).toContain('target-only text');
});

test('load_skill refuses an unknown skill, a path-like name, and a review with no checkout', async () => {
	const store = new EvidenceStore(await checkout(), buildInventory(''), 20_000);
	const unknown = await load(store, 'nope');
	const traversal = await load(store, '../../etc/passwd');
	const bare = await load(new EvidenceStore(null, buildInventory(''), 20_000), 'shared');

	expect(unknown).toMatchObject({ ok: false, error: 'this repository has no skill named "nope"' });
	expect(traversal.ok).toBe(false);
	expect(bare).toMatchObject({ ok: false, error: 'skills need a local checkout' });
});

test('a load_skill tool call keeps its name argument as the skill to load', () => {
	const action = toolAction('load_skill', { name: 'shared' }, { exec: false, delegate: false });

	expect(action).toMatchObject({ action: 'loadSkill', skill: 'shared' });
});
