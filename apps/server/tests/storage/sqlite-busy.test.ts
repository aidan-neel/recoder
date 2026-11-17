import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { sqlite, sqliteCollection } from '../../src/storage/sqlite';
import { serverDataDir } from '../../src/util/data-dir';

/** How long the other process holds its write lock: well under the busy timeout. */
const HOLD_MS = 300;

/** Opens the same database in another process, takes the write lock, says so, then commits after `HOLD_MS`. */
function holdWriteLock(path: string) {
	const script = `
		const { Database } = require('bun:sqlite');
		const db = new Database(${JSON.stringify(path)});
		db.run('BEGIN IMMEDIATE');
		console.log('locked');
		setTimeout(() => { db.run('COMMIT'); db.close(); }, ${HOLD_MS});
	`;

	return Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'inherit' });
}

test('a write waits for another process that holds the write lock instead of failing as locked', async () => {
	const db = sqlite();
	const holder = holdWriteLock(join(serverDataDir(), 'recoder.db'));
	const reader = holder.stdout.getReader();

	expect(new TextDecoder().decode((await reader.read()).value)).toContain('locked');

	expect(() => db.run(`INSERT OR REPLACE INTO repos (id, value) VALUES ('busy-test', '{}')`)).not.toThrow();
	expect(await holder.exited).toBe(0);

	db.run(`DELETE FROM repos WHERE id = 'busy-test'`);
});

test("an update keeps the write lock from its read, so another connection's write cannot fail it as locked", async () => {
	const repos = sqliteCollection<{ id: string; name: string }>('repos');
	const other = new Database(join(serverDataDir(), 'recoder.db'));
	let otherRefused = false;

	await repos.set({ id: 'update-race', name: 'before' });

	const updated = await repos.update('update-race', (current) => {
		try {
			other.run(`INSERT OR REPLACE INTO repos (id, value) VALUES ('update-race-other', '{}')`);
		} catch (error) {
			otherRefused = String(error).includes('locked');
		}

		return current && { ...current, name: 'after' };
	});

	expect(updated?.name).toBe('after');
	expect(otherRefused).toBe(true);

	other.close();
	await repos.delete('update-race');
	await repos.delete('update-race-other');
});
