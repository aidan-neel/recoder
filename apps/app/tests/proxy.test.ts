import { describe, expect, test } from 'bun:test';

import { malformedPath } from '../src/proxy';

describe('malformedPath', () => {
	test('a percent escape that does not decode anywhere in the path is malformed', () => {
		for (const path of [
			'/review/%E0%A4%A',
			'/review/%ZZ',
			'/review/a%E0%A4%A',
			'/settings/%E0%A4%A',
			'/settings/%',
			'/review/%ZZ/x',
			'/review/%C3'
		]) {
			expect(malformedPath(path)).toBe(true);
		}
	});

	test('paths that decode, escaped or not, go on to their pages', () => {
		for (const path of [
			'/',
			'/review/b5440484-4d40-4012-a8ab-9775e000cb48',
			'/review/%25',
			'/review/%20',
			'/review/%E0%A4%A4',
			'/settings/agent',
			'/settings/'
		]) {
			expect(malformedPath(path)).toBe(false);
		}
	});
});
