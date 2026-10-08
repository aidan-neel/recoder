import { fail, redirect } from '@sveltejs/kit';
import { REASONING_EFFORTS, type ReasoningEffort } from '@recoder/shared';
import type { RunRequest } from '$lib/reports/types';
import { datasetPrs, listDatasets } from '$lib/server/datasets';
import { host, hosts } from '$lib/server/hosts';
import { launch } from '$lib/server/launch';
import { syncHost } from '$lib/server/mirror';
import { runSetups } from '$lib/server/run-setup';

export async function load({ url }) {
	const target = host(url.searchParams.get('host') ?? 'local');

	await syncHost(target);

	const datasets = listDatasets(target);
	const asked = url.searchParams.get('dataset');

	const dataset =
		asked && datasets.includes(asked) ? asked : (datasets.find((name) => name === 'synth-v1') ?? datasets[0] ?? null);

	return {
		hosts: hosts().map((item) => ({ id: item.id, label: item.label })),
		host: target.id,
		base: target.base,
		setup: runSetups.read(target.id),
		datasets,
		dataset,
		prs: dataset ? datasetPrs(target, dataset) : [],
		tag: `bench-${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')}`
	};
}

function effort(value: FormDataEntryValue | null): ReasoningEffort | null {
	const efforts: readonly string[] = REASONING_EFFORTS;

	return typeof value === 'string' && efforts.includes(value) ? (value as ReasoningEffort) : null;
}

export const actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const text = (name: string) => String(form.get(name) ?? '').trim();

		const run: RunRequest = {
			host: text('host'),
			base: text('base'),
			dataset: text('dataset'),
			only: text('only').split(',').filter(Boolean),
			model: text('model') || null,
			effort: effort(form.get('effort')),
			runs: Number(text('runs')),
			concurrency: Number(text('concurrency')),
			timeout: Number(text('timeout')),
			judge: text('judge'),
			judgeEffort: effort(form.get('judgeEffort')),
			tag: text('tag')
		};

		let started: { host: string; pid: number };

		try {
			started = await launch(run);
		} catch (error) {
			return fail(400, { error: error instanceof Error ? error.message : String(error) });
		}

		redirect(303, `/active/${started.host}/${started.pid}`);
	}
};
