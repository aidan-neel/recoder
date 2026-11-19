import type { ServerCheck, ServerCheckId, ServerOverview } from '@recoder/shared';
import { db } from '../../store';
import { updateService } from '../../update/service';
import { VERSION } from '../../version';
import { diagnosticAddress, type AddressReader } from './address';
import { checkForge } from './forge';
import { checkModel } from './model';
import { diskStatus, probeDatabaseWrite, storageStatus } from './storage';
import { checkWebhooks } from './webhooks';

const STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();
const DAY_MS = 24 * 60 * 60 * 1000;
const GB = 1_000_000_000;

export async function serverOverview(readAddress?: AddressReader): Promise<ServerOverview> {
	const [address, storage, disk, summaries] = await Promise.all([
		diagnosticAddress(readAddress),
		storageStatus(),
		diskStatus(),
		db.reviews.summaries()
	]);

	const reviews = { running: 0, queued: 0 };

	for (const { status } of summaries) {
		if (status === 'running' || status === 'queued') reviews[status]++;
	}

	return { version: VERSION, startedAt: STARTED_AT, ...address, storage, disk, reviews };
}

export function probeServerCheck(id: ServerCheckId, readAddress?: AddressReader): Promise<ServerCheck> {
	const probes = {
		https: () => checkHttps(readAddress),
		reachable: () => checkReachable(readAddress),
		forge: checkForge,
		webhooks: checkWebhooks,
		model: checkModel,
		database: checkDatabase,
		disk: checkDisk,
		version: checkVersion
	};

	return probes[id]();
}

async function checkHttps(readAddress?: AddressReader): Promise<ServerCheck> {
	const id = 'https';
	const { publicUrl, tls } = await diagnosticAddress(readAddress);
	const fix = 'Check the public address and TLS settings.';

	if (tls.state === 'external') return { id, state: 'ok', detail: 'TLS is handled by your proxy.' };

	if (!publicUrl && tls.state === 'off' && process.env.RECODER_TLS === 'off') {
		return { id, state: 'skipped', detail: 'HTTPS is disabled and no public address is set.' };
	}

	if (tls.state === 'issued') {
		const remaining = Date.parse(tls.expiresAt ?? '') - Date.now();

		if (remaining > 0) {
			const days = Math.floor(remaining / DAY_MS);
			const detail = `${tls.issuer ?? 'Certificate'}, ${days} days left.`;

			return remaining <= 14 * DAY_MS ? { id, state: 'warn', detail, fix } : { id, state: 'ok', detail };
		}

		if (!tls.expiresAt) return { id, state: 'ok', detail: 'A TLS certificate was issued.' };
	}

	return { id, state: 'fail', detail: 'There is no active TLS certificate.', fix };
}

async function checkReachable(readAddress?: AddressReader): Promise<ServerCheck> {
	const id = 'reachable';
	const { publicUrl } = await diagnosticAddress(readAddress);

	if (!publicUrl) return { id, state: 'skipped', detail: 'No public address is set.' };

	try {
		const response = await fetch(new URL('/health', publicUrl), {
			redirect: 'error',
			signal: AbortSignal.timeout(5000)
		});

		if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
			const body = (await response.json()) as { ok?: unknown; name?: unknown };

			if (body.ok === true && body.name === 'recoder') {
				return { id, state: 'ok', detail: 'Recoder answered through its public address.' };
			}
		} else await response.body?.cancel();
	} catch {}

	return {
		id,
		state: 'fail',
		detail: 'Recoder did not answer through its public address.',
		fix: 'Check DNS, your proxy and access to /health.'
	};
}

async function checkDatabase(): Promise<ServerCheck> {
	const id = 'database';

	try {
		await probeDatabaseWrite();

		const { kind, sizeBytes } = await storageStatus();
		const name = kind === 'postgres' ? 'PostgreSQL' : 'Built-in database';
		const size = sizeBytes === null ? '' : `, ${(sizeBytes / 1_000_000).toFixed(1)} MB`;

		return { id, state: 'ok', detail: `${name}${size}.` };
	} catch {
		return {
			id,
			state: 'fail',
			detail: 'Recoder cannot write to its database.',
			fix: 'Check storage permissions and available space.'
		};
	}
}

async function checkDisk(): Promise<ServerCheck> {
	const id = 'disk';
	const disk = await diskStatus();
	const fix = 'Free space on the Recoder data volume.';

	if (!disk) return { id, state: 'warn', detail: 'Available disk space could not be read.', fix };

	const { freeBytes } = disk;
	const detail = `${(freeBytes / GB).toFixed(1)} GB free.`;

	if (freeBytes < GB) return { id, state: 'fail', detail, fix };
	if (freeBytes <= 5 * GB) return { id, state: 'warn', detail, fix };

	return { id, state: 'ok', detail };
}

async function checkVersion(): Promise<ServerCheck> {
	const id = 'version';
	const current = await updateService.status();

	if (current.mode === 'managed') return { id, state: 'skipped', detail: 'Updates are managed by this deployment.' };

	const status = current.state === 'idle' || current.state === 'failed' ? await updateService.check() : current;
	const fix = 'See Settings → Server → Updates.';

	if (status.available) return { id, state: 'warn', detail: 'An update is available.', fix };
	if (status.state !== 'idle') return { id, state: 'warn', detail: 'The latest version could not be confirmed.', fix };

	return { id, state: 'ok', detail: 'No update is available on this channel.' };
}
