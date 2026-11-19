import type {
	LogLine,
	UpdateHistoryEntry,
	UpdateOperation,
	UpdateState,
	UpdateStep,
	UpdateStatus
} from '@recoder/shared';
import { requireCompatibleData, rollbackBackup } from './compatibility';
import { UpdaterRefused, type UpdaterAction, type UpdaterStatus } from './protocol';
import type { ContainerRelease } from './releases';

export interface RunningContainer {
	id: string;
	version: string;
	dataVersion: number;
}

export interface UpdateDocker {
	current(): Promise<RunningContainer>;
	backup(id: string): Promise<{ id: string; dataVersion: number }>;
	pull(release: ContainerRelease): Promise<void>;
	startCandidate(original: string, release: ContainerRelease): Promise<void>;
	startWithBackup(original: string, backup: string, release?: ContainerRelease): Promise<void>;
	recover(original: string, checkpoint: string): Promise<void>;
	healthy(version: string, dataVersion: number): Promise<boolean>;
	finish(original: string): Promise<void>;
}

interface HistoryEntry extends UpdateHistoryEntry {
	dataVersion: number;
	checkpoint?: string;
}

interface Recovery {
	original: RunningContainer;
	checkpoint: string;
}

export interface Journal {
	format: 1;
	current?: RunningContainer;
	state: UpdateState;
	operation?: UpdateOperation;
	error?: string;
	steps: UpdateStep[];
	history: HistoryEntry[];
	logs: Record<string, LogLine[]>;
	pending?: Recovery;
	checkpoint?: string;
}

interface Dependencies {
	docker: UpdateDocker;
	authorize(version: string): Promise<ContainerRelease>;
	write(journal: Journal): Promise<void>;
}

const STEPS: UpdateStep[] = [
	{ id: 'pause', state: 'done' },
	{ id: 'backup', state: 'done' },
	{ id: 'download', state: 'pending' },
	{ id: 'start', state: 'pending' },
	{ id: 'health', state: 'pending' }
];

export function emptyJournal(): Journal {
	return { format: 1, state: 'idle', steps: [], history: [], logs: {} };
}

function refuseUnlessNewer(release: ContainerRelease, current: RunningContainer): void {
	if (Bun.semver.order(release.version, current.version) <= 0)
		throw new UpdaterRefused('The requested release is not newer than the running version.');
	if (Bun.semver.order(release.minVersion, current.version) > 0)
		throw new UpdaterRefused('Update to a supported intermediate release first.');

	requireCompatibleData(release, current.dataVersion);
}

export function createUpdater(deps: Dependencies, existing: Journal = emptyJournal()) {
	let journal = existing;
	let running = false;
	let sequence = Date.now() * 1000;
	let operationLog: LogLine[] = [];

	async function save(patch: Partial<Journal>): Promise<void> {
		const next = { ...journal, ...patch };

		await deps.write(next);
		journal = next;
	}

	function status(): UpdaterStatus {
		const update: UpdateStatus = {
			mode: 'container',
			current: { version: journal.current?.version },
			available: null,
			state: journal.state,
			operation: journal.operation,
			error: journal.error,
			steps: journal.steps
		};

		return {
			update,
			history: journal.history.map(({ checkpoint: _checkpoint, dataVersion: _version, ...entry }) => entry),
			logs: Object.fromEntries(Object.entries(journal.logs).map(([id, lines]) => [id, { lines, before: null }])),
			recoveryRequired: running || journal.pending !== undefined,
			checkpoint: journal.checkpoint,
			protectedBackups: [
				...new Set([
					...(running && journal.checkpoint ? [journal.checkpoint] : []),
					...(journal.pending ? [journal.pending.checkpoint] : []),
					...journal.history.flatMap((item) =>
						item.rollback === 'restore' && item.checkpoint ? [item.checkpoint] : []
					)
				])
			]
		};
	}

	async function step(id: UpdateStep['id'], state: UpdateStep['state'], detail: string): Promise<void> {
		const steps = journal.steps.map((step) => (step.id === id ? { id, state, detail } : step));

		log(state === 'failed' ? 'error' : 'info', detail);
		await save({ steps });
	}

	function log(level: LogLine['level'], message: string): void {
		operationLog.push({ seq: ++sequence, at: new Date().toISOString(), level, source: 'updater', message });
	}

	async function finish(
		id: string,
		action: UpdaterAction,
		original: RunningContainer,
		version: string,
		dataVersion: number,
		installedAt: number,
		outcome: HistoryEntry['outcome'],
		error?: string
	): Promise<void> {
		const previous = journal.history.map((entry) => {
			if (entry.outcome !== 'running' || outcome !== 'running') return entry;

			return {
				...entry,
				outcome: 'replaced' as const,
				checkpoint: action.checkpoint,
				rollback: entry.dataVersion === dataVersion ? ('swap' as const) : ('restore' as const)
			};
		});

		const entry: HistoryEntry = {
			id,
			version,
			dataVersion,
			by: action.by,
			installedAt: new Date(installedAt).toISOString(),
			durationMs: Date.now() - installedAt,
			outcome,
			rollback: 'none',
			error
		};

		const history = [entry, ...previous].slice(0, 20);

		log(error ? 'error' : 'info', error ?? `Version ${version} passed its readiness checks.`);

		const logs = Object.fromEntries(
			history.map((item) => [item.id, item.id === id ? [...operationLog].reverse() : (journal.logs[item.id] ?? [])])
		);

		await save({
			state: outcome === 'running' ? 'idle' : outcome === 'rolled-back' ? 'rolled-back' : 'failed',
			current: outcome === 'running' ? { ...original, version, dataVersion } : original,
			pending: outcome === 'failed' ? journal.pending : undefined,
			history,
			logs,
			error
		});
	}

	async function initial(original: RunningContainer): Promise<void> {
		if (journal.history.length) return;

		await save({
			current: original,
			history: [
				{
					id: crypto.randomUUID(),
					version: original.version,
					dataVersion: original.dataVersion,
					by: null,
					installedAt: new Date().toISOString(),
					durationMs: null,
					outcome: 'running',
					rollback: 'none'
				}
			]
		});
	}

	async function preflight(action: UpdaterAction, original: RunningContainer) {
		const anchor = await deps.docker.backup(action.checkpoint);

		if (anchor.dataVersion !== original.dataVersion) {
			throw new UpdaterRefused('The checkpoint backup does not match the running data version.');
		}

		if (action.action === 'restore') {
			const backup = await deps.docker.backup(action.backup);

			if (backup.dataVersion > original.dataVersion)
				throw new UpdaterRefused('This backup needs a newer Recoder image.');

			return { backup: backup.id };
		}

		const release = await deps.authorize(action.version);

		if (action.action === 'install') {
			refuseUnlessNewer(release, original);

			return { release };
		}

		const recorded = journal.history.find((entry) => entry.version === action.version && entry.outcome === 'replaced');

		if (!recorded || action.version === original.version)
			throw new UpdaterRefused('This version cannot be rolled back to.');

		const saved = recorded.checkpoint
			? await deps.docker.backup(recorded.checkpoint).catch(() => undefined)
			: undefined;

		return { release, backup: rollbackBackup(original.dataVersion, release, saved) };
	}

	async function execute(action: UpdaterAction, original: RunningContainer): Promise<void> {
		const id = crypto.randomUUID();
		const started = Date.now();
		const version = action.action === 'restore' ? original.version : action.version;
		let dataVersion = original.dataVersion;

		try {
			await step('download', 'running', 'Verifying the published release and its image.');

			const { release, backup } = await preflight(action, original);

			if (release) {
				dataVersion = release.dataVersion;
				await deps.docker.pull(release);
			}

			await step(
				'download',
				release ? 'done' : 'skipped',
				release ? 'Pulled the signed image by digest.' : 'Using the running image.'
			);

			await save({ state: 'restarting', pending: { original, checkpoint: action.checkpoint } });
			await step('start', 'running', 'Starting Recoder.');

			if (backup) await deps.docker.startWithBackup(original.id, backup, release);
			else if (release) await deps.docker.startCandidate(original.id, release);
			else throw new UpdaterRefused('No image or backup was selected.');

			await step('start', 'done', 'Started Recoder.');
			await save({ state: 'health-check' });
			await step('health', 'running', 'Waiting for readiness and the expected data version.');

			if (!(await deps.docker.healthy(version, dataVersion)))
				throw new UpdaterRefused(`Recoder ${version} failed its readiness check.`);

			await step('health', 'done', 'Recoder is ready.');
			await finish(id, action, original, version, dataVersion, started, 'running');
			await deps.docker.finish(original.id).catch(() => {});
		} catch (failure) {
			const detail =
				failure instanceof UpdaterRefused ? failure.message : 'The updater could not complete the operation.';

			const active = journal.steps.find((step) => step.state === 'running');

			if (active) await step(active.id, 'failed', detail);

			if (!journal.pending) {
				await finish(id, action, original, version, dataVersion, started, 'failed', detail);

				return;
			}

			await save({ state: 'rolling-back', error: detail });

			try {
				await deps.docker.recover(original.id, action.checkpoint);

				if (!(await deps.docker.healthy(original.version, original.dataVersion)))
					throw new Error('Previous image is not ready.', { cause: failure });
			} catch {
				await finish(
					id,
					action,
					original,
					version,
					dataVersion,
					started,
					'failed',
					`${detail} Automatic rollback did not complete.`
				);

				return;
			}

			await finish(id, action, original, version, dataVersion, started, 'rolled-back', detail);
		}
	}

	async function initialize(): Promise<void> {
		if (journal.pending || journal.history.length) return;

		const original = await deps.docker.current().catch(() => undefined);

		if (original) await initial(original);
	}

	async function recover(): Promise<void> {
		const pending = journal.pending;

		if (!pending) {
			if (journal.state === 'updating')
				await save({ state: 'failed', error: 'The updater restarted before switching images.' });

			return;
		}

		const { original, checkpoint } = pending;

		await save({ state: 'rolling-back' });

		try {
			await deps.docker.recover(original.id, checkpoint);

			if (!(await deps.docker.healthy(original.version, original.dataVersion)))
				throw new Error('Previous image is not ready.');

			await save({
				state: 'rolled-back',
				current: original,
				pending: undefined,
				error: 'Recovered the previous image after the updater restarted.'
			});
		} catch {
			await save({ state: 'failed', error: 'The previous image needs manual recovery.' });
		}
	}

	async function start(action: UpdaterAction): Promise<UpdaterStatus> {
		if (running || journal.pending) throw new UpdaterRefused('An update or its recovery is already running.');

		running = true;
		operationLog = [];

		try {
			const current = await deps.docker.current();

			await initial(current);

			await save({
				current,
				checkpoint: action.checkpoint,
				error: undefined,
				state: 'updating',
				operation: action.action === 'install' ? 'update' : action.action,
				steps: STEPS
			});

			void execute(action, current)
				.catch(() => {})
				.finally(() => (running = false));

			return status();
		} catch (error) {
			running = false;
			throw error;
		}
	}

	return { status, start, recover, initialize };
}
