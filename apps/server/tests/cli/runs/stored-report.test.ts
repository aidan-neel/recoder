import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { EXIT } from '../../../src/cli/exit';
import { createRunFolder } from '../../../src/cli/runs/run-files';
import { readStoredReport, saveReport } from '../../../src/cli/runs/stored-report';
import { finding, report } from '../output/fixtures';
import { runIdAt, useFreshDataDir } from './run-fixtures';

useFreshDataDir();

test('a report with a file-level finding, which has no line, survives saving and reading back', async () => {
	const files = await createRunFolder(runIdAt(1));

	const saved = report({
		findings: [finding({ line: undefined })],
		unconfirmed: [finding({ id: 'u', line: undefined })]
	});

	await saveReport(files, saved);

	expect(await readStoredReport(runIdAt(1), files)).toEqual(JSON.parse(JSON.stringify(saved)));
});

test('a report whose field a renderer reads has the wrong type is unreadable rather than crashing the renderer', async () => {
	const files = await createRunFolder(runIdAt(1));
	const saved = JSON.parse(JSON.stringify(report()));

	writeFileSync(files.report, JSON.stringify({ ...saved, settings: { ...saved.settings, lenses: 1 } }));

	await expect(readStoredReport(runIdAt(1), files)).rejects.toMatchObject({ exitCode: EXIT.failed });
});

test('a report from before the start and scope fields reads without error', async () => {
	const files = await createRunFolder(runIdAt(1));
	const saved = JSON.parse(JSON.stringify(report()));

	delete saved.target.since;
	delete saved.target.sinceRunId;
	delete saved.settings.include;
	delete saved.settings.exclude;
	writeFileSync(files.report, JSON.stringify(saved));

	const read = await readStoredReport(runIdAt(1), files);

	expect(read?.outcome).toBe('complete');
	expect(read?.target.headSha).toBe(saved.target.headSha);
});
