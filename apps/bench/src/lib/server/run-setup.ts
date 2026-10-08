import type { ModelOption } from '$lib/reports/types';
import { host } from './hosts';
import { flag, probe } from './probe';
import { getSettings } from './recoder-api';
import { swr } from './swr';

/** What the run form needs from a host's live state: its servers, the runs on them, and the models it offers. */
export interface RunSetup {
	servers: number[];
	busy: { pid: number; base: string }[];
	models: ModelOption[];
	modelError: string | null;
}

/** The models the host's server offers, or why it could not say. */
async function models(target: ReturnType<typeof host>): Promise<{ models: ModelOption[]; error: string | null }> {
	try {
		const settings = await getSettings(target, target.base);

		return {
			models: settings.models.map((entry) => ({
				id: entry.id,
				label: entry.label,
				source: entry.source ?? null,
				efforts: entry.efforts ?? [],
				defaultEffort: entry.defaultEffort ?? null
			})),
			error: null
		};
	} catch (error) {
		return { models: [], error: error instanceof Error ? error.message : String(error) };
	}
}

async function loadRunSetup(id: string): Promise<RunSetup> {
	const target = host(id);

	const [found, offered] = await Promise.all([
		probe(target).catch(() => ({ benchmarks: [], servers: [] })),
		models(target)
	]);

	return {
		servers: found.servers.map((server) => server.port),
		busy: found.benchmarks.map((process) => ({
			pid: process.pid,
			base: flag(process.args, 'base') ?? 'http://localhost:3001'
		})),
		models: offered.models,
		modelError: offered.error
	};
}

/**
 * Run form state by host id. It is only a hint for the form: the start
 * action probes the host again before it launches anything.
 */
export const runSetups = swr(10_000, loadRunSetup, 60_000);
