import { expect, test } from 'bun:test';
import { requestedReview } from '../../src/repo-chat/chat-review';

test('a message that asks for a review of a numbered pull request names that pull request', () => {
	expect(requestedReview('review #42')).toBe(42);
	expect(requestedReview('Can you review PR 7 and focus on auth?')).toBe(7);
	expect(requestedReview('please run a review of pull request 12')).toBe(12);
	expect(requestedReview('review https://github.com/acme/shop/pull/305')).toBe(305);
	expect(requestedReview('review !9')).toBe(9);
});

test('a question about a pull request, or a review request without a number, goes to the model', () => {
	expect(requestedReview('What does #42 change?')).toBeNull();
	expect(requestedReview('review the auth code')).toBeNull();
	expect(requestedReview('Why did the review of #42 fail?')).toBeNull();
});
