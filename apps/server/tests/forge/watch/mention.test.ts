import { expect, test } from 'bun:test';
import { findMention, RECODER_MARKER } from '../../../src/forge/watch/mention';

test('a mention gives the rest of the comment as instructions, in any case', () => {
	expect(findMention('@Recoder, focus on the auth changes', '@recoder')).toBe('focus on the auth changes');

	expect(findMention('Could you look?\n@recoder check the migration', '@recoder')).toBe(
		'Could you look? check the migration'
	);

	expect(findMention('@recoder', '@recoder')).toBe('');
});

test('the handle only matches as a whole word', () => {
	expect(findMention('@recoder-bot please', '@recoder')).toBeNull();
	expect(findMention('mail x@recoder.dev', '@recoder')).toBeNull();
	expect(findMention('@recoders assemble', '@recoder')).toBeNull();
	expect(findMention('thanks @recoder', '@recoder')).toBe('thanks');
});

test('quoted and code mentions are ignored, and so are Recoder’s own comments', () => {
	expect(findMention('> @recoder review this\nagreed', '@recoder')).toBeNull();
	expect(findMention('run `@recoder` to summon it', '@recoder')).toBeNull();
	expect(findMention('```\n@recoder\n```', '@recoder')).toBeNull();
	expect(findMention(`${RECODER_MARKER}\nAsked by @recoder`, '@recoder')).toBeNull();
});
