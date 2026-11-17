import { expect, test } from 'bun:test';
import { isSkillName, skillMentions } from '../src/skills';

test('a skill name is a safe file-name token of at most 64 characters', () => {
	expect(isSkillName('giga-ui')).toBe(true);
	expect(isSkillName('Review_2.v1')).toBe(true);
	expect(isSkillName('a'.repeat(64))).toBe(true);

	for (const name of ['', 'a'.repeat(65), '-lead', '.hidden', '../up', 'a/b', 'a b', 'a\nb', 'né']) {
		expect(isSkillName(name)).toBe(false);
	}
});

test('skill mentions are the slash words of a text, without sentence punctuation, repeats or paths', () => {
	const text = '/lint first, then ask /maya. Open src/app.ts or /src/app.ts about /giga-ui) and /lint again; /../up';

	expect(skillMentions(text)).toEqual(['lint', 'maya', 'giga-ui']);
});
