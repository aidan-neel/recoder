import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatasetPr, HostConfig } from '$lib/reports/types';
import { datasetsDir } from './mirror';

/** One labeled PR as the devtool needs it: where it lives on the forge and how many defects it plants. */
interface LabelRef {
	id: string;
	codebase: string;
	repo: string;
	pull: number;
	defects: unknown[];
}

/** The dataset's labeled PRs, read from the host's labels (a cached copy for a remote host). */
export function readLabels(target: HostConfig, dataset: string): LabelRef[] {
	const dir = join(datasetsDir(target), dataset, 'labels');

	if (!existsSync(dir)) return [];

	return readdirSync(dir)
		.filter((name) => name.endsWith('.json'))
		.map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as LabelRef)
		.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/** The datasets on the host that have labels. */
export function listDatasets(target: HostConfig): string[] {
	const dir = datasetsDir(target);

	if (!existsSync(dir)) return [];

	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'labels')))
		.map((entry) => entry.name)
		.sort();
}

/** The dataset's PRs for the run form. */
export function datasetPrs(target: HostConfig, dataset: string): DatasetPr[] {
	return readLabels(target, dataset).map((label) => ({
		id: label.id,
		codebase: label.codebase,
		defects: label.defects.length
	}));
}
