import { expect, test } from 'bun:test';

import { splitSections } from '~/lib/doc-sections';

test('a page splits into its intro and one section for each ## heading', () => {
	const outline = splitSections('Intro text.\n\n## Install\n\nRun it.\n\n## Set up\n\nThen this.');

	expect(outline).toEqual({
		intro: 'Intro text.',
		sections: [
			{ id: 'install', title: 'Install', body: 'Run it.' },
			{ id: 'set-up', title: 'Set up', body: 'Then this.' }
		]
	});
});

test('a ## line inside a fenced block stays code', () => {
	const body = '## Notes\n\n```md\n## Not a heading\n```\n\nAfter.';

	expect(splitSections(body).sections).toEqual([
		{ id: 'notes', title: 'Notes', body: '```md\n## Not a heading\n```\n\nAfter.' }
	]);
});

test('a shorter fence marker inside a longer fence does not close it', () => {
	const body = '````md\n```\n## Still code\n```\n````\n\n## Real';

	expect(splitSections(body).sections.map((section) => section.title)).toEqual(['Real']);
});

test('sections with the same heading get different ids', () => {
	const ids = splitSections('## Usage\n\na\n\n## Usage\n\nb').sections.map((section) => section.id);

	expect(ids).toEqual(['usage', 'usage-2']);
});

test('a deeper heading stays in its section', () => {
	expect(splitSections('## One\n\n### Inner\n\ntext').sections).toEqual([
		{ id: 'one', title: 'One', body: '### Inner\n\ntext' }
	]);
});
