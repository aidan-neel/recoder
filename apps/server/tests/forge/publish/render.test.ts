import { expect, test } from 'bun:test';
import type { Finding } from '@recoder/shared';
import { RECODER_MARKER } from '../../../src/forge/watch/mention';
import { pullCommentMarker, renderPullComment, type PullCommentView } from '../../../src/forge/publish/render';

function finding(index: number, severity: Finding['severity'], message = `Problem ${index}`): Finding {
	return { id: `f${index}`, file: `src/file-${index}.ts`, line: index + 1, severity, message, title: `Title ${index}` };
}

function view(overrides: Partial<PullCommentView> = {}): PullCommentView {
	return {
		provider: 'github',
		prUrl: 'https://github.com/acme/app/pull/7',
		prNumber: 7,
		headSha: 'abcdef1234567',
		status: 'passed',
		summary: 'Looks mostly fine.',
		findings: [],
		limit: 65_536,
		...overrides
	};
}

test('carries the pull request marker and the watcher marker', () => {
	const body = renderPullComment(view());

	expect(body).toContain(pullCommentMarker(7));
	expect(body).toContain(RECODER_MARKER);
	expect(body).toContain('Reviewed `abcdef1`');
});

test('lists errors before warnings and folds low findings into a closed details block', () => {
	const body = renderPullComment(view({ findings: [finding(1, 'info'), finding(2, 'warning'), finding(3, 'error')] }));

	expect(body.indexOf('Title 3')).toBeLessThan(body.indexOf('Title 2'));
	expect(body.indexOf('<details>')).toBeLessThan(body.indexOf('Title 1'));
	expect(body).not.toContain('<details open');
});

test('links a finding to its line in the GitHub diff', () => {
	const body = renderPullComment(view({ findings: [finding(1, 'error')] }));

	expect(body).toMatch(
		/\[`src\/file-1\.ts:2`\]\(https:\/\/github\.com\/acme\/app\/pull\/7\/files#diff-[0-9a-f]{64}R2\)/
	);
});

test('never writes a bare mention handle, from the summary, a finding or the requester', () => {
	const body = renderPullComment(
		view({
			summary: 'Ask @recoder again after fixing.',
			findings: [finding(1, 'error', 'cc @recoder and @someone')],
			requestedBy: 'alice'
		})
	);

	expect(body).not.toMatch(/(^|[^\w])@recoder\b/);
	expect(body).not.toMatch(/(^|[^\w])@someone\b/);
	expect(body).toContain('requested by @alice');
});

test('drops the lowest findings with a note when the body passes the limit', () => {
	const findings = [
		...Array.from({ length: 20 }, (_, index) => finding(index, 'error', 'x'.repeat(400))),
		...Array.from({ length: 20 }, (_, index) => finding(index + 20, 'info', 'y'.repeat(400)))
	];

	const body = renderPullComment(view({ findings, limit: 6000 }));

	expect(body.length).toBeLessThanOrEqual(6000);
	expect(body).toContain('Title 0');
	expect(body).not.toContain('Title 39');
	expect(body).toMatch(/\d+ more findings didn’t fit in this comment/);
});

test('cuts an oversized summary to fit', () => {
	const body = renderPullComment(view({ summary: 'z'.repeat(10_000), limit: 2000 }));

	expect(body.length).toBeLessThanOrEqual(2000);
	expect(body).toContain('summary cut short');
});

test('a suggestion block in a finding’s own words shows as plain code, so the forge offers nothing to apply', () => {
	const words = ['Use the guard.', '```suggestion', 'if (!entry) return load(key);', '```'].join('\n');

	const body = renderPullComment(
		view({ findings: [{ ...finding(0, 'error', words), suggestion: '~~~ suggestion:-0+0\nreturn 1;\n~~~' }] })
	);

	expect(body).not.toMatch(/(```|~~~) ?suggestion/);
	expect(body).toContain('```text\nif (!entry) return load(key);\n```');
});
