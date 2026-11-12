import { describe, expect, test } from 'bun:test';
import type { RepoGuidelines } from '@recoder/shared';

import {
	activeSource,
	caretAt,
	firstRule,
	globalSummary,
	repoSummary,
	saveLabel,
	seedText,
	streamingDraft,
	successLabel,
	trimEmptyBullets
} from '../../src/lib/guidelines/rules';

const TEMPLATE = '## Focus\n-\n\n## Ignore\n-\n\n## Severity\n-\n\n## Conventions\n-\n';

function repo(patch: Partial<RepoGuidelines>): RepoGuidelines {
	return {
		repoId: 'r1',
		path: '.recoder/guidelines.md',
		ref: 'main',
		sha: null,
		content: null,
		pending: null,
		canPropose: false,
		...patch
	};
}

describe('the first rule of a guidelines text', () => {
	test('the starter template has no rule, so its bare bullets never read as one', () => {
		expect(firstRule(TEMPLATE)).toBeNull();
	});

	test('skips headings, blank lines and "None." and drops the bullet', () => {
		expect(firstRule('## Ignore\n- None.\n\n## Focus\n*   Check auth on new routes\n')).toBe(
			'Check auth on new routes'
		);
	});
});

describe('opening the starter template', () => {
	test('the caret lands in the first empty bullet, and saving leaves no line ending in a space', () => {
		const seed = seedText(null, TEMPLATE);

		expect(seed.slice(0, caretAt(seed))).toBe('## Focus\n- ');
		expect(trimEmptyBullets(seed)).toBe(TEMPLATE);
	});
});

describe('the global row', () => {
	const neverSaved = globalSummary({ content: '', updatedAt: null });

	test('a layer never saved reads as Recoder’s defaults even though it holds their text', () => {
		const defaults = globalSummary({ content: '## Focus\n- Report what blocks a merge\n', updatedAt: null });

		expect(defaults).toBe(neverSaved);
		expect(defaults).not.toContain('Report what blocks a merge');
	});

	test('a layer saved empty is not mistaken for the defaults', () => {
		expect(globalSummary({ content: '', updatedAt: '2026-10-17T00:00:00Z' })).not.toBe(neverSaved);
	});
});

describe('the repository row', () => {
	test('previews the first rule in force, or the pending branch’s when it has one', () => {
		expect(repoSummary(repo({ content: '## Focus\n- Check auth\n' }))).toBe('Check auth');

		expect(
			repoSummary(
				repo({
					content: '## Focus\n- Old\n',
					pending: { number: 4, url: 'https://x', branch: 'b', content: '## Focus\n- New\n' }
				})
			)
		).toBe('New');
	});

	test('a repository with no rule yet names where its file would be', () => {
		expect(repoSummary(repo({}))).toBe('No .recoder/guidelines.md yet');
	});
});

describe('the source a repository file was read from', () => {
	test('names the path, branch and short commit', () => {
		expect(activeSource(repo({ sha: 'abcdef1234567890' }))).toBe('.recoder/guidelines.md on main at abcdef1');
		expect(activeSource(repo({}))).toBe('.recoder/guidelines.md on main');
	});
});

describe('the save and success labels', () => {
	test('the global layer saves in place; a repository opens or updates a pull request', () => {
		expect(saveLabel(null)).toBe('Save');
		expect(saveLabel(repo({}))).toBe('Open pull request');

		expect(saveLabel(repo({ pending: { number: 4, url: 'u', branch: 'b', content: null } }))).toBe(
			'Update pull request'
		);
	});

	test('the success line mirrors what the save did', () => {
		expect(successLabel(null)).toBe('Saved');
		expect(successLabel(repo({}))).toBe('Opened');
		expect(successLabel(repo({ pending: { number: 4, url: 'u', branch: 'b', content: null } }))).toBe('Updated');
	});
});

describe('a draft while it streams', () => {
	test('hides an opening fence that has not finished its line yet', () => {
		expect(streamingDraft('```mark')).toBe('');
		expect(streamingDraft('``')).toBe('');
	});

	test('hides a whole-document fence, including a closing fence still arriving', () => {
		expect(streamingDraft('```markdown\n## Focus\n- Auth\n``')).toBe('## Focus\n- Auth');
		expect(streamingDraft('```\n## Focus\n- Auth')).toBe('## Focus\n- Auth');
	});

	test('keeps backticks that belong to the rules', () => {
		expect(streamingDraft('## Focus\n- Use `Decimal` for money\n```')).toBe('## Focus\n- Use `Decimal` for money\n```');
		expect(streamingDraft('```md\n- Wrap `fetch` in `retry')).toBe('- Wrap `fetch` in `retry');
	});
});
