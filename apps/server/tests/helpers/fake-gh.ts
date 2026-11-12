import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeBin } from './fake-bin';

/** What the fake `gh` does for one call: print `out` as JSON, or fail with `err` on stderr. */
export type GhReply = { out: unknown } | { err: string };

/** A fake `gh` on PATH and the argument lines it was called with. */
export interface FakeGh {
	/** The PATH that finds the fake `gh` first. */
	path: string;
	calls(): Promise<string[]>;
}

/**
 * A fake `gh` that answers by its first two arguments (`pr view` → `pr-view`).
 * Each key's replies are used in order and the last one repeats, so a test can
 * show a pull request open before a merge and merged after it.
 */
export async function fakeGh(replies: Record<string, GhReply[]>): Promise<FakeGh> {
	const dir = await mkdtemp(join(tmpdir(), 'recoder-fake-gh-'));

	for (const [key, list] of Object.entries(replies)) {
		for (const [index, reply] of list.entries()) {
			const file = join(dir, `${key}.${index + 1}`);

			if ('err' in reply) await writeFile(`${file}.err`, reply.err);
			else await writeFile(`${file}.out`, JSON.stringify(reply.out));
		}

		await writeFile(join(dir, `${key}.max`), String(list.length));
	}

	const script = `#!/bin/sh
dir='${dir}'
key="$1-$2"
echo "$*" >> "$dir/calls"
n=$(( $(cat "$dir/$key.count" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$dir/$key.count"
max=$(cat "$dir/$key.max" 2>/dev/null || echo 0)
[ "$n" -gt "$max" ] && n=$max
if [ -e "$dir/$key.$n.err" ]; then cat "$dir/$key.$n.err" >&2; exit 1; fi
if [ -e "$dir/$key.$n.out" ]; then cat "$dir/$key.$n.out"; exit 0; fi
echo "unexpected gh $*" >&2
exit 1
`;

	const { env } = await fakeBin('gh', script);

	const callsFile = join(dir, 'calls');

	return {
		path: env.PATH,
		calls: async () => (existsSync(callsFile) ? (await readFile(callsFile, 'utf8')).split('\n').filter(Boolean) : [])
	};
}
