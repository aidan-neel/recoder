import { expect, test } from 'bun:test';

import { matchLabBrief, resolveLabLink } from '@/lib/compose/compose-lab';
import { composeLabHref, routeOf } from '@/lib/shell/routes';

test('a paste resolves an open pull request by both its repository and number', () => {
	expect(resolveLabLink('https://github.com/acme/api/pull/216?tab=files').pull?.number).toBe(216);
	expect(resolveLabLink('https://github.com/acme/web/pull/216').pull).toBeUndefined();
	expect(resolveLabLink('https://github.com/acme/api/pull/198').pull).toBeUndefined();
	expect(resolveLabLink('#216').pull).toBeUndefined();
});

test('a brief returns every matching change without treating substrings as matches', () => {
	expect(matchLabBrief('Check S3 and webhook retries.').map(({ pull, term }) => [pull.number, term])).toEqual([
		[216, 's3'],
		[211, 'webhook retries']
	]);

	expect(matchLabBrief('The webhookless case.')).toEqual([]);
});

test('composer lab variants are not routed in the live app', () => {
	expect(routeOf(composeLabHref('b'), '/sample')).toEqual({ screen: 'compose-lab', variant: 'b' });
	expect(routeOf('/compose-lab/b', '')).toEqual({ screen: 'missing' });
	expect(routeOf('/sample/compose-lab/d', '/sample')).toEqual({ screen: 'missing' });
});
