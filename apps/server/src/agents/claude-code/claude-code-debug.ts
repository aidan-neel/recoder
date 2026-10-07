import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Env = Record<string, string | undefined>;

const TEXT_DELTA = '"type":"content_block_delta"';

/**
 * Keeps the raw `stream-json` lines of one call, text and thinking deltas left out, and writes them to
 * `RECODER_CLAUDE_CODE_DEBUG_DIR` when the call fails. With the variable unset it keeps nothing.
 */
export class FailedCallDump {
	private readonly lines: string[] = [];
	private readonly dir: string | undefined;

	constructor(env: Env) {
		this.dir = env.RECODER_CLAUDE_CODE_DEBUG_DIR || undefined;
	}

	add(line: string): void {
		if (this.dir && !line.includes(TEXT_DELTA)) this.lines.push(line);
	}

	write(model: string, error: unknown): void {
		if (!this.dir) return;

		try {
			mkdirSync(this.dir, { recursive: true });

			const message = error instanceof Error ? error.message : String(error);
			const name = `${Date.now()}-${model}-${crypto.randomUUID().slice(0, 8)}.jsonl`;

			writeFileSync(join(this.dir, name), [JSON.stringify({ model, error: message }), ...this.lines].join('\n'));
		} catch {
			return;
		}
	}
}
