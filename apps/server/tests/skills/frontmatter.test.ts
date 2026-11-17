import { expect, test } from 'bun:test';
import { skillIdentity } from '../../src/skills/frontmatter';

test('a skill with no frontmatter takes its folder name and has no description', () => {
	expect(skillIdentity('# Just instructions\n\nDo the thing.\n', 'deploy')).toEqual({
		name: 'deploy',
		description: ''
	});
});

test('quoted values lose their quotes and keep what is inside', () => {
	const text = `---\nname: "pdf-tools"\ndescription: 'It''s a "PDF" skill: reads and writes them'\n---\nBody\n`;

	expect(skillIdentity(text, 'folder')).toEqual({
		name: 'pdf-tools',
		description: `It's a "PDF" skill: reads and writes them`
	});
});

test('Windows line endings and a byte order mark do not hide the frontmatter', () => {
	const text = '﻿---\r\nname: crlf-skill\r\ndescription: Works on Windows\r\n---\r\nBody\r\n';

	expect(skillIdentity(text, 'folder')).toEqual({ name: 'crlf-skill', description: 'Works on Windows' });
});

test('a folded description is joined into one line', () => {
	const text = '---\nname: folded\ndescription: >-\n  Use when the\n  user asks for X.\nother: 1\n---\nBody\n';

	expect(skillIdentity(text, 'folder')?.description).toBe('Use when the user asks for X.');
});

test('frontmatter that is never closed is not frontmatter', () => {
	expect(skillIdentity('---\nname: lost\ndescription: never closed\n\nBody\n', 'folder')).toEqual({
		name: 'folder',
		description: ''
	});
});

test('a declared name that is not a valid skill name falls back to the folder name', () => {
	const text = '---\nname: ../../etc/passwd\ndescription: Sneaky\n---\n';

	expect(skillIdentity(text, 'safe-folder')?.name).toBe('safe-folder');
	expect(skillIdentity(text, 'bad folder')).toBeNull();
});

test('a description is cut to 300 characters', () => {
	const text = `---\nname: long\ndescription: ${'x'.repeat(500)}\n---\n`;

	expect(skillIdentity(text, 'long')?.description).toHaveLength(300);
});

test('a trailing comment is not part of an unquoted value', () => {
	expect(skillIdentity('---\nname: a # the name\ndescription: B\n---\n', 'folder')?.name).toBe('a');
});
