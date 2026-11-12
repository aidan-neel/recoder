import { describe, expect, test } from 'bun:test';
import type { RepoGuidelines } from '@recoder/shared';

import { editorNote } from '../../src/lib/guidelines/editor-note';

const repo: RepoGuidelines = {
	repoId: 'r1',
	path: '.recoder/guidelines.md',
	ref: 'main',
	sha: null,
	content: null,
	pending: null,
	canPropose: false
};

describe('the note under the guidelines editor', () => {
	test('a failure wins over everything', () => {
		const note = editorNote({ error: 'Could not save.', length: 999_999, max: 4_000, repo: null });

		expect(note).toEqual({ kind: 'error', key: 'error:Could not save.', tone: 'danger', text: 'Could not save.' });
	});

	test('over the limit is the next-most pressing', () => {
		const note = editorNote({ error: null, length: 4_001, max: 4_000, repo });

		expect(note?.kind).toBe('over');
	});

	test('a repository that cannot propose says saving is blocked', () => {
		expect(editorNote({ error: null, length: 10, max: 4_000, repo })?.kind).toBe('blocked');
	});

	test('a pending pull request says the save updates it', () => {
		const note = editorNote({
			error: null,
			length: 10,
			max: 4_000,
			repo: { ...repo, canPropose: true, pending: { number: 7, url: 'u', branch: 'b', content: null } }
		});

		expect(note?.kind).toBe('pending');
		expect(note && 'text' in note ? note.text : '').toContain('#7');
	});

	test('nothing to say without a repository or a reason', () => {
		expect(editorNote({ error: null, length: 10, max: 4_000, repo: null })).toBeNull();
	});
});
