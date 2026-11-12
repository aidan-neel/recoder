import { spyOn } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AntigravityAgent } from '../../../src/agents/antigravity/antigravity';
import type { AgentEvent, AgentRun } from '../../../src/agents/contract';
import { fakeAntigravity } from '../../helpers/fake-antigravity';

export const PROMPT = { tools: true, timeoutMs: 10_000 };

export interface OpenRunOptions {
	tools?: string[];
	home?: string;
	env?: Record<string, string>;
	onEvent?: (event: AgentEvent) => void;
	user?: {
		settings?: Record<string, unknown>;
		hooks?: Record<string, unknown>;
		mcpServers?: Record<string, unknown>;
	};
}

/** Opens an `AntigravityRun` on the fake CLI in `mode`, collecting emitted events and the call log path. */
export async function openRun(
	mode = 'answer',
	options: OpenRunOptions = {}
): Promise<{ agent: AntigravityAgent; run: AgentRun; events: AgentEvent[]; log: string; home: string }> {
	const env = await fakeAntigravity(
		{
			FAKE_ANTIGRAVITY_MODE: mode,
			...(options.home ? { HOME: options.home } : {}),
			...options.env
		},
		options.user
	);

	const events: AgentEvent[] = [];
	const agent = new AntigravityAgent(env);

	const run = await agent.openRun({
		model: 'gemini-3.8-flash',
		reasoningEffort: 'low',
		system: 'Review the diff.',
		tools: options.tools ?? ['read_diff'],
		runTool: async (name) => ({ text: `read ${name}`, isError: false }),
		onEvent: (event) => {
			events.push(event);
			options.onEvent?.(event);
		},
		signal: new AbortController().signal
	});

	return { agent, run, events, log: env.FAKE_ANTIGRAVITY_LOG ?? '', home: env.HOME ?? '' };
}

/**
 * Makes `jetbox_summaries_proto.pb` under `home` unreadable for the adapter: it starts with a group-start tag (wire
 * type 3), which the CLI never writes. Entries the fake CLI appends later land behind it.
 */
export function breakSummariesSnapshot(home: string): void {
	const cliDir = join(home, '.gemini', 'antigravity-cli');

	mkdirSync(cliDir, { recursive: true });
	writeFileSync(join(cliDir, 'jetbox_summaries_proto.pb'), Uint8Array.of(0x0b));
}

/** Runs `act` with the server's warnings kept off the test output, and returns what it warned, one line per warning. */
export async function warningsFrom(act: () => unknown): Promise<string> {
	const warn = spyOn(console, 'warn').mockImplementation(() => {});

	try {
		await act();

		return warn.mock.calls.map((line) => line.join(' ')).join('\n');
	} finally {
		warn.mockRestore();
	}
}
