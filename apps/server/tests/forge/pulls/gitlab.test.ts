import { describe, expect, test } from 'bun:test';
import { gitlabMergeability, gitlabMergeMethods } from '../../../src/forge/pulls/gitlab';

describe('gitlabMergeability', () => {
	test('a conflict reads as conflicts in either status field', () => {
		expect(gitlabMergeability({ detailed_merge_status: 'conflict' })).toBe('conflicts');
		expect(gitlabMergeability({ detailed_merge_status: 'mergeable', has_conflicts: true })).toBe('conflicts');
		expect(gitlabMergeability({ merge_status: 'cannot_be_merged' })).toBe('conflicts');
	});

	test('a pipeline, an approval or a rule that stops the merge blocks it', () => {
		expect(gitlabMergeability({ detailed_merge_status: 'ci_must_pass' })).toBe('blocked');
		expect(gitlabMergeability({ detailed_merge_status: 'not_approved' })).toBe('blocked');
		expect(gitlabMergeability({ detailed_merge_status: 'discussions_not_resolved' })).toBe('blocked');
	});

	test('a status GitLab is still working out is unknown', () => {
		expect(gitlabMergeability({ detailed_merge_status: 'checking' })).toBe('unknown');
		expect(gitlabMergeability({ merge_status: 'unchecked' })).toBe('unknown');
		expect(gitlabMergeability({})).toBe('unknown');
	});

	test('a mergeable request is clean on new and old GitLab', () => {
		expect(gitlabMergeability({ detailed_merge_status: 'mergeable' })).toBe('clean');
		expect(gitlabMergeability({ merge_status: 'can_be_merged' })).toBe('clean');
	});
});

describe('gitlabMergeMethods', () => {
	test('a merge-commit project allows a merge and an optional squash', () => {
		expect(gitlabMergeMethods({ merge_method: 'merge', squash_option: 'default_off' })).toEqual(['merge', 'squash']);
	});

	test('a fast-forward project merges like a rebase', () => {
		expect(gitlabMergeMethods({ merge_method: 'ff', squash_option: 'never' })).toEqual(['rebase']);
	});

	test('a project that always squashes allows only a squash', () => {
		expect(gitlabMergeMethods({ merge_method: 'rebase_merge', squash_option: 'always' })).toEqual(['squash']);
	});
});
