import { readFileSync } from 'node:fs';
import { watch } from 'node:fs/promises';
import { join } from 'node:path';

const PID_FILE = 'devin.pid';

/** A `devin` whose model list never ends and which writes its process id, so a test can wait for it to start. */
export const HANGING_DEVIN = `#!/bin/sh
if [ "$1" = "--version" ]; then echo "devin 3000.11.3"; exit 0; fi
if [ "$1" = "models" ]; then echo $$ > "$FAKE_DEVIN_DIR/${PID_FILE}"; exec sleep 60; fi
exit 1
`;

/** Resolves with the process id the fake wrote, as soon as the file has it; `dir` is watched, not polled. */
export async function startedProcess(dir: string): Promise<number> {
	for await (const event of watch(dir)) {
		const text = event.filename === PID_FILE ? readFileSync(join(dir, PID_FILE), 'utf8').trim() : '';

		if (text) return Number(text);
	}

	throw new Error('the watch ended');
}
