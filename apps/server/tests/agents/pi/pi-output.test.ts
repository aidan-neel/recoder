import { expect, test } from 'bun:test';
import { piError } from '../../../src/agents/pi/pi-output';
import { UsageLimitError } from '../../../src/models/llm/errors';

test('a per-minute throttle that mentions quota and billing is a retried 429, not a usage cap', () => {
	const error = piError(
		'429 RESOURCE_EXHAUSTED: You exceeded your current quota, please check your plan and billing details. ' +
			'Quota exceeded for metric: generate_content_free_tier_requests, limit: 10 per minute. Please retry in 41s.'
	);

	expect(error).not.toBeInstanceOf(UsageLimitError);
	expect(error.status).toBe(429);
});

test('a daily cap worded like a throttle is a usage cap, not a retried 429', () => {
	const error = piError(
		'429 RESOURCE_EXHAUSTED: You exceeded your current quota, please check your plan and billing details. ' +
			'Quota exceeded for metric: generate_content_free_tier_requests, limit: 250, ' +
			'quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier. Please retry in 14h32m5s.'
	);

	expect(error).toBeInstanceOf(UsageLimitError);
	expect(error.status).toBe(429);
});
