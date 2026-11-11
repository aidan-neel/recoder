import { expect, test } from 'bun:test';

import { pxToRem } from '../px-to-rem';

/** Runs the plugin on one declaration and returns its new value. */
function convert(value: string, selector = '.box'): string {
	const decl = { value, parent: { type: 'rule', selector } };

	pxToRem.Declaration(decl);

	return decl.value;
}

test('converts px lengths to rem and keeps hairlines in px', () => {
	expect(convert('1px solid; padding: 8px -24px .5px 12.5px')).toBe(
		'1px solid; padding: 0.5rem -1.5rem .5px 0.78125rem'
	);
});

test('reads an exponent as part of the number', () => {
	expect(convert('3.40282e38px')).toBe(`${3.40282e38 / 16}rem`);
});

test('leaves digits inside a longer token alone', () => {
	expect(convert('var(--size-12px) translate(a10px)')).toBe('var(--size-12px) translate(a10px)');
});

test('leaves the switch in px', () => {
	expect(convert('16px', "[data-ui='switch']")).toBe('16px');
});
