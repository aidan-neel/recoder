import { rm } from 'node:fs/promises';

/**
 * Calls `clonefile(2)` on a directory, which makes APFS clone the whole tree in one call. Measured on a 25,000
 * file install: 0.3 s, where `cp -c -R` (a clone per file) takes 4.8 s. It runs in a child because the call
 * blocks its thread for as long as the clone takes.
 */
const CLONE_SCRIPT = `const { dlopen, FFIType } = require('bun:ffi');
const lib = dlopen('libSystem.B.dylib', {
	clonefile: { args: [FFIType.cstring, FFIType.cstring, FFIType.i32], returns: FFIType.i32 }
});
const [from, to] = process.argv.slice(-2);
process.exit(lib.symbols.clonefile(Buffer.from(from + '\\0'), Buffer.from(to + '\\0'), 0) === 0 ? 0 : 1);`;

/**
 * Clones the directory `from` to `to`, which must not exist, sharing every file's blocks until one side writes.
 * False when this host cannot (not macOS, a volume that is not APFS, two volumes): nothing is left at `to`, and
 * the caller copies some other way. `BUN_BE_BUN` makes the `recoder` binary run the script as Bun would.
 */
export async function cloneTree(from: string, to: string): Promise<boolean> {
	if (process.platform !== 'darwin') return false;

	const proc = Bun.spawn([process.execPath, '-e', CLONE_SCRIPT, from, to], {
		env: { ...process.env, BUN_BE_BUN: '1' },
		stdin: 'ignore',
		stdout: 'ignore',
		stderr: 'ignore'
	});

	if ((await proc.exited) === 0) return true;

	await rm(to, { recursive: true, force: true });

	return false;
}
