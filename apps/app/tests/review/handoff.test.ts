import { describe, expect, test } from 'bun:test';
import type { Finding, Review } from '@recoder/shared';

import { handoffPrompt, sentItems } from '../../src/lib/review/handoff';
import { buildSurface } from '../../src/lib/review/surface';

function finding(id: string, status: 'verified' | 'unverified'): Finding {
	return {
		id,
		file: 'a.ts',
		line: 1,
		severity: 'error',
		message: `The parser drops ${id}.`,
		verification: { status, method: 'run', reason: '', command: `bun test ${id}` }
	};
}

describe('handoffPrompt', () => {
	test('offers a repro command only for a finding the command reproduced', () => {
		const review = { findings: [finding('proven', 'verified'), finding('unproven', 'unverified')] } as Review;
		const { decisions } = buildSurface(review, []);
		const sent = { state: 'sent' as const, note: '', at: 1 };

		const prompt = handoffPrompt(
			{ number: 1, title: 'T', branch: null },
			sentItems(decisions, { proven: sent, unproven: sent })
		);

		expect(prompt).toContain('`bun test proven`');
		expect(prompt).not.toContain('`bun test unproven`');
	});
});
