import { afterEach, expect, test } from 'bun:test';
import { findingCitations } from '../../src/evidence/citations';

const original = process.env.RECODER_AGENT_TOOLS;

afterEach(() => {
	if (original === undefined) delete process.env.RECODER_AGENT_TOOLS;
	else process.env.RECODER_AGENT_TOOLS = original;
});

const WRITTEN = ['ev_3', 'cd pkg && bun test src/repro.test.ts 2>&1 | tail -20', 'src/a.ts:12', '', 7, 'ev_11'];

test("a finding from an agent on its CLI's own tools keeps only evidence ids, not the commands and paths it cited", () => {
	process.env.RECODER_AGENT_TOOLS = 'cli';

	expect(findingCitations(WRITTEN)).toEqual(['ev_3', 'ev_11']);
});

test("a finding from an agent on Recoder's tools keeps every string it cited, so a made-up id still drops it", () => {
	delete process.env.RECODER_AGENT_TOOLS;

	expect(findingCitations(WRITTEN)).toEqual([
		'ev_3',
		'cd pkg && bun test src/repro.test.ts 2>&1 | tail -20',
		'src/a.ts:12',
		'ev_11'
	]);
});
