import type { LogPage, UpdateHistoryEntry, UpdatePolicy, UpdateStatus } from '@recoder/shared';
import { z } from 'zod';
import { collection, storageDataVersion } from '../../storage/backend';
import { startBackup } from '../../storage/backups/service';
import { VERSION } from '../../version';
import { holdReviewStarts } from '../hold';
import { pauseReviewsForUpdate, resumeAfterUpdate, resumeHeldReviews, waitForUpdateCheckpoints } from '../pauses';
import { UPDATE_RECORD_ID, updateRecords } from '../record';
import { configuredUpdater } from './connection';
import { requestUpdater, updaterTerminal, UpdaterRefused, type UpdaterAction, type UpdaterSocket } from './protocol';

export const updatePolicySchema = z.strictObject({
	channel: z.enum(['stable', 'beta']),
	install: z.enum(['ask', 'auto']),
	window: z.strictObject({ weekday: z.number().int().min(0).max(6).nullable(), hour: z.number().int().min(0).max(23) }),
	backupFirst: z.literal(true)
});

const DEFAULT_POLICY: UpdatePolicy = {
	channel: 'stable',
	install: 'ask',
	window: { weekday: null, hour: 3 },
	backupFirst: true
};

const policy = collection<{ id: string; value: UpdatePolicy }>('update_state');
const POLICY = 'container-policy';

let available: UpdateStatus['available'] = null;
let preparing = false;
let lastAuto = '';
let localError: string | undefined;
let dismissedRollback = false;
let awaitingBootApproval = false;

const STEPS: UpdateStatus['steps'] = (['pause', 'backup', 'download', 'start', 'health'] as const).map((id) => ({
	id,
	state: 'pending'
}));

export async function readPolicy(): Promise<UpdatePolicy> {
	return (await policy.get(POLICY))?.value ?? DEFAULT_POLICY;
}

export async function writePolicy(value: UpdatePolicy): Promise<UpdatePolicy> {
	await policy.set({ id: POLICY, value });

	return value;
}

export async function containerStatus(socket: UpdaterSocket): Promise<UpdateStatus> {
	const remote = await requestUpdater(socket).catch(() => undefined);

	if (!remote)
		return {
			mode: 'container',
			current: { version: VERSION },
			available,
			state: 'failed',
			error: 'The private updater is unavailable.'
		};

	const [settings, dataVersion] = await Promise.all([readPolicy(), storageDataVersion()]);
	const { stable, beta } = remote.releases ?? {};

	const release =
		settings.channel === 'beta' && beta && (!stable || Bun.semver.order(beta.version, stable.version) > 0)
			? beta
			: stable;

	const current = remote.update.current.version ?? VERSION;

	available =
		release && Bun.semver.order(release.version, current) > 0
			? {
					version: release.version,
					notes: release.notes,
					releasedAt: release.releasedAt,
					dataChange: release.dataVersion !== dataVersion,
					commits: [],
					changes: { server: true, web: true, install: false }
				}
			: null;

	const blockedReason =
		available &&
		release &&
		(dataVersion < release.oldestDataVersion ||
			dataVersion > release.dataVersion ||
			Bun.semver.order(current, release.minVersion) < 0)
			? 'Update from a compatible Recoder and data version first.'
			: undefined;

	const reset = dismissedRollback && remote.update.state === 'rolled-back';
	const pending = preparing && updaterTerminal(remote.update.state);

	return {
		...remote.update,
		current: { version: current },
		available,
		blockedReason,
		state: localError
			? 'failed'
			: pending
				? 'backing-up'
				: reset
					? 'idle'
					: remote.lookingUpReleases && !remote.releases && remote.update.state === 'idle'
						? 'checking'
						: remote.update.state,
		error: localError ?? (reset ? undefined : remote.update.error),
		steps: available && remote.update.state === 'idle' ? STEPS : remote.update.steps
	};
}

export async function checkContainer(socket: UpdaterSocket): Promise<UpdateStatus> {
	dismissedRollback = true;
	localError = undefined;

	return containerStatus(socket);
}

type Operation = { action: 'install' | 'rollback'; version: string } | { action: 'restore'; backup: string };

export async function beginContainer(
	socket: UpdaterSocket,
	action: Operation,
	by: string | null
): Promise<UpdateStatus> {
	if (preparing) throw new UpdaterRefused('An update or restore is already running.');

	preparing = true;
	localError = undefined;
	dismissedRollback = false;

	try {
		const remote = await requestUpdater(socket);
		const status = remote.update;

		if (!updaterTerminal(status.state) || remote.recoveryRequired)
			throw new UpdaterRefused('An update or its recovery is already running.');

		void prepareAndSend(socket, action, by)
			.finally(() => (preparing = false))
			.catch(() => {});

		return {
			...status,
			state: 'pausing',
			operation: action.action === 'install' ? 'update' : action.action,
			available
		};
	} catch (error) {
		preparing = false;
		throw error;
	}
}

async function prepareAndSend(socket: UpdaterSocket, action: Operation, by: string | null): Promise<void> {
	let paused: string[] = [];
	let accepted = false;
	let uncertain = false;

	try {
		paused = await pauseReviewsForUpdate();
		await waitForUpdateCheckpoints(paused);

		await updateRecords.set({
			id: UPDATE_RECORD_ID,
			state: 'restarting',
			mode: 'container',
			current: { version: VERSION },
			available,
			pausedReviewIds: paused,
			updatedAt: new Date().toISOString()
		});

		const backup = await startBackup('update');
		const request = { ...action, by, checkpoint: backup.id } satisfies UpdaterAction;

		try {
			await requestUpdater(socket, request);
			accepted = true;
		} catch (error) {
			if (error instanceof UpdaterRefused) throw error;

			const status = await requestUpdater(socket).catch(() => undefined);

			uncertain = !status;
			accepted = status?.checkpoint === backup.id;
			if (!accepted) throw error;
		}

		await waitForUpdater(socket);
	} catch {
		if (uncertain) {
			awaitingBootApproval = true;
			localError = 'The updater did not confirm the request. Reviews stay held until it reports a safe state.';
			await waitForUpdater(socket);
			await updateRecords.delete(UPDATE_RECORD_ID);
			await resumeHeldReviews(paused);
			awaitingBootApproval = false;
			localError = undefined;
		} else if (!accepted) localError = 'Could not pause reviews, back up data, or reach the private updater.';
	} finally {
		if (!uncertain && (!accepted || (await safeTerminal(socket)))) {
			await updateRecords.delete(UPDATE_RECORD_ID);
			await resumeHeldReviews(paused);
		}
	}
}

async function safeTerminal(socket: UpdaterSocket): Promise<boolean> {
	return requestUpdater(socket).then(
		(status) => updaterTerminal(status.update.state) && !status.recoveryRequired,
		() => false
	);
}

async function waitForUpdater(socket: UpdaterSocket): Promise<void> {
	const deadline = Date.now() + 180_000;

	while (!(await safeTerminal(socket))) {
		const overdue = Date.now() >= deadline;

		if (overdue) localError = 'Waiting for the private updater to confirm it is safe to resume reviews.';
		await Bun.sleep(overdue ? 15_000 : 1000);
	}
}

/** A new server must answer readiness before the sidecar can release its held reviews. */
export async function resumeContainerAfterReady(): Promise<void> {
	const socket = await configuredUpdater();

	if (socket) {
		holdReviewStarts();
		awaitingBootApproval = true;
		await waitForUpdater(socket);
	}

	await resumeAfterUpdate();
	awaitingBootApproval = false;
	localError = undefined;
}

export function containerOperationPreparing(): boolean {
	return preparing || awaitingBootApproval;
}

export async function readBackupProtection(): Promise<{ busy: boolean; ids: string[] }> {
	const socket = await configuredUpdater();

	if (!socket) return { busy: false, ids: [] };

	const status = await requestUpdater(socket).catch(() => undefined);

	if (!status) throw new UpdaterRefused('The updater is unavailable; existing backups were kept.');

	return {
		busy: containerOperationPreparing() || !!status.recoveryRequired || !updaterTerminal(status.update.state),
		ids: status.protectedBackups ?? []
	};
}

export async function containerHistory(socket: UpdaterSocket): Promise<UpdateHistoryEntry[]> {
	return (await requestUpdater(socket)).history;
}

export async function containerLog(socket: UpdaterSocket, id: string): Promise<LogPage | undefined> {
	const { logs } = await requestUpdater(socket);

	return Object.hasOwn(logs, id) ? logs[id] : undefined;
}

export function startAutomaticUpdates(): void {
	const tick = async () => {
		const socket = await configuredUpdater();

		if (!socket || preparing) return;

		const settings = await readPolicy();
		const now = new Date();
		const key = `${now.toDateString()}:${now.getHours()}`;

		if (
			settings.install !== 'auto' ||
			settings.window.hour !== now.getHours() ||
			(settings.window.weekday !== null && settings.window.weekday !== now.getDay()) ||
			key === lastAuto
		)
			return;

		lastAuto = key;

		const remote = await requestUpdater(socket);

		if (remote.update.state !== 'idle' || remote.recoveryRequired) return;

		const status = await containerStatus(socket);

		if (status.available?.version && !status.blockedReason && status.state === 'idle')
			await beginContainer(socket, { action: 'install', version: status.available.version }, null);
	};

	const timer = setInterval(() => void tick().catch(() => {}), 60_000);

	timer.unref();
}
