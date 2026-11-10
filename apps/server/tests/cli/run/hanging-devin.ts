import { readFileSync } from 'node:fs';
import { watch } from 'node:fs/promises';
import { join } from 'node:path';

const PID_FILE = 'devin.pid';
const STOPPED_FILE = 'devin.stopped';

/**
 * A `devin` whose model list never ends. It writes its process id when the listing starts and a second file when it
 * is told to stop, so a test can wait for each without reading the process table: a process that has just ended keeps
 * its id until its parent collects it.
 */
export const HANGING_DEVIN = `#!/bin/sh
if [ "$1" = "--version" ]; then echo "devin 3000.11.3"; exit 0; fi
if [ "$1" = "models" ]; then
	trap 'kill "$waiting"; echo stopped > "$FAKE_DEVIN_DIR/${STOPPED_FILE}"; exit 143' TERM
	sleep 60 &
	waiting=$!
	echo $$ > "$FAKE_DEVIN_DIR/${PID_FILE}"
	wait "$waiting"
fi
exit 1
`;

/** Resolves with the process id the fake wrote, as soon as the file has it. */
export async function startedProcess(dir: string): Promise<number> {
	return Number(await writtenFile(dir, PID_FILE));
}

/** Resolves once the fake has been told to stop. Call it before the stop, so the file is not written unseen. */
export async function stoppedProcess(dir: string): Promise<void> {
	await writtenFile(dir, STOPPED_FILE);
}

/** The text of `name` in `dir`, as soon as the file has any; `dir` is watched, not polled. */
async function writtenFile(dir: string, name: string): Promise<string> {
	for await (const event of watch(dir)) {
		const text = event.filename === name ? readFileSync(join(dir, name), 'utf8').trim() : '';

		if (text) return text;
	}

	throw new Error('the watch ended');
}
