import { describe, expect, test } from 'bun:test';

import { embedMentions, findMentions } from '../../src/components/form/link-mention';
import { docFromText, segmentsOf } from '../../src/components/form/link-model';

const NAMES = new Set(['migrations', 'api-errors']);

describe('findMentions', () => {
	test('finds known names after a slash, leaving out the punctuation that ends a sentence', () => {
		const text = 'use /migrations, then /api-errors.';

		expect(findMentions(text, NAMES).map((range) => text.slice(range.start, range.end))).toEqual([
			'/migrations',
			'/api-errors'
		]);
	});

	test('skips unknown names and a slash inside a path', () => {
		expect(findMentions('see src/migrations, /migrations/up.sql, /migration or (/migrations)', NAMES)).toEqual([]);
	});
});

describe('embedMentions', () => {
	test('embeds a mention beside a link and keeps the word being typed as text', () => {
		const doc = docFromText('see https://github.com/acme/api/pull/1 /migrations /api-errors');
		const typing = { start: doc.text.length - '/api-errors'.length, end: doc.text.length };

		const embedded = embedMentions(doc, NAMES, typing);

		expect(segmentsOf(embedded).filter((segment) => segment.kind === 'link')).toEqual([
			{ kind: 'link', url: 'https://github.com/acme/api/pull/1' },
			{ kind: 'link', url: '/migrations' }
		]);
	});

	test('turns a mention back into text once its name is no longer offered', () => {
		const embedded = embedMentions(docFromText('use /migrations now'), NAMES, null);

		const dropped = embedMentions(embedded, new Set(['api-errors']), null);

		expect(dropped.links).toEqual([]);
		expect(dropped.text).toBe('use /migrations now');
	});
});
