import { expect, test } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readExport } from '../../../src/agents/devin/devin-output';

test('Devin exports retain internal model turns independently of wrapper prompts and token usage', async () => {
	const root = await mkdtemp(join(tmpdir(), 'devin-turns-'));
	const file = join(root, 'export.json');

	try {
		await writeFile(
			file,
			JSON.stringify({ session_id: 's', final_metrics: { total_steps: 11, total_prompt_tokens: 900 } })
		);

		expect((await readExport(file))?.final_metrics?.total_steps).toBe(11);
		await writeFile(file, JSON.stringify({ session_id: 's', final_metrics: {} }));
		expect((await readExport(file))?.final_metrics?.total_steps).toBeUndefined();
		expect(await readExport(join(root, 'missing'))).toBeNull();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
