import { within, type ServerCheck, type ServerChecks, type ServerCheckId } from '@recoder/shared';
import { settingsOperation, storageNow } from '../../storage/backend';
import { readDeploymentState, updateDeploymentState } from '../setup/state';

const CHECK_IDS = ['https', 'reachable', 'forge', 'webhooks', 'model', 'database', 'disk', 'version'] as const;
const PROBE_TIMEOUT_MS = 40_000;
const LEASE_MS = 90_000;

type CheckState = Awaited<ReturnType<typeof readDeploymentState>>;

type Probe = (id: ServerCheckId) => Promise<ServerCheck>;

export function isServerCheckId(value: string): value is ServerCheckId {
	return CHECK_IDS.some((id) => id === value);
}

export async function readServerChecks(): Promise<ServerChecks> {
	const [state, now] = await Promise.all([readDeploymentState(), storageNow()]);

	return checksSnapshot(state, now);
}

export function checksSnapshot(state: CheckState, now: number): ServerChecks {
	const { checks, checkLease } = state ?? {};

	if (!checks) {
		return {
			checkedAt: new Date(0).toISOString(),
			running: false,
			checks: CHECK_IDS.map((id) => ({ id, state: 'pending', detail: 'Not checked yet.' }))
		};
	}

	if (!checkLease || checkLease.expiresAt > now) return checks;

	return {
		...checks,
		running: false,
		checks: checks.checks.map((check) =>
			checkLease.selected.includes(check.id) ? failedCheck(check.id, 'The check was interrupted.') : check
		)
	};
}

export async function startServerChecks(probe: Probe, only?: ServerCheckId): Promise<ServerChecks | null> {
	const now = await storageNow();
	const token = crypto.randomUUID();
	const selected: readonly ServerCheckId[] = only ? [only] : CHECK_IDS;

	const saved = await updateDeploymentState((state) => {
		const previous = checksSnapshot(state, now);

		if (previous.running) return state;

		return {
			...state,
			checkLease: { token, expiresAt: now + LEASE_MS, selected },
			checks: {
				checkedAt: new Date(now).toISOString(),
				running: true,
				checks: previous.checks.map((check) =>
					selected.includes(check.id) ? { id: check.id, state: 'pending', detail: 'Checking…' } : check
				)
			}
		};
	});

	if (saved.checkLease?.token !== token || !saved.checks) return null;

	void runChecks(probe, selected, token).catch(() => {
		console.warn('[diagnostics] could not save server checks');
	});

	return saved.checks;
}

async function runChecks(probe: Probe, selected: readonly ServerCheckId[], token: string): Promise<void> {
	const results = await settingsOperation(() => Promise.all(selected.map((id) => runOne(probe, id)))).catch(() =>
		selected.map((id) => failedCheck(id, 'The check could not read server settings.'))
	);

	const now = await storageNow();

	await updateDeploymentState((state) => {
		if (state.checkLease?.token !== token || state.checkLease.expiresAt <= now || !state.checks) return state;

		return {
			...state,
			checkLease: undefined,
			checks: {
				checkedAt: new Date(now).toISOString(),
				running: false,
				checks: state.checks.checks.map((check) => results.find((result) => result.id === check.id) ?? check)
			}
		};
	});
}

async function runOne(probe: Probe, id: ServerCheckId): Promise<ServerCheck> {
	try {
		return await within(probe(id), PROBE_TIMEOUT_MS, failedCheck(id, 'The check timed out.'));
	} catch {
		return failedCheck(id, 'The check could not be completed.');
	}
}

function failedCheck(id: ServerCheckId, detail: string): ServerCheck {
	return id === 'version'
		? { id, state: 'warn', detail, fix: 'See Settings → Server → Updates.' }
		: { id, state: 'fail', detail, fix: 'Run this check again.' };
}
