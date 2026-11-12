import { expect, test } from 'bun:test';

import { reviewId } from '../../src/lib/shell/routes';

test('a review address whose percent escapes do not decode names no review instead of throwing', () => {
	expect(reviewId('/review/%E0%A4%A')).toBeNull();
	expect(reviewId('/review/%ZZ')).toBeNull();
});
