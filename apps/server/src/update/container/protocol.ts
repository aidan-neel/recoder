import type { LogPage, UpdateHistoryEntry, UpdateStatus } from '@recoder/shared';
import { z } from 'zod';
import { isReleaseTag } from '../../cli/upgrade/release-tag';
import { sameSecret } from '../../util/same-secret';
import type { ContainerRelease } from './releases';

const version = z
	.string()
	.max(100)
	.refine((value) => isReleaseTag(`v${value}`));

const backup = z.uuid();
const operator = z.string().max(200).nullable();
const context = { checkpoint: backup, by: operator };

const actionSchema = z.discriminatedUnion('action', [
	z.strictObject({ action: z.literal('install'), version, ...context }),
	z.strictObject({ action: z.literal('rollback'), version, ...context }),
	z.strictObject({ action: z.literal('restore'), backup, ...context })
]);

export type UpdaterAction = z.infer<typeof actionSchema>;

export interface UpdaterStatus {
	update: UpdateStatus;
	history: UpdateHistoryEntry[];
	logs: Record<string, LogPage>;
	releases?: Partial<Record<ContainerRelease['channel'], ContainerRelease>>;
	lookingUpReleases?: boolean;
	recoveryRequired?: boolean;
	checkpoint?: string;
	protectedBackups?: string[];
}

export function updaterTerminal(state: UpdateStatus['state']): boolean {
	return state === 'idle' || state === 'failed' || state === 'rolled-back';
}

export class UpdaterRefused extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UpdaterRefused';
	}
}

interface UpdaterService {
	status(): UpdaterStatus;
	start(action: UpdaterAction): Promise<UpdaterStatus>;
}

/** Only these four HTTP operations are defined on the local authenticated socket. */
export function updaterHandler(secret: string, service: UpdaterService) {
	if (!/^[\x21-\x7e]{32,200}$/.test(secret)) throw new Error('The updater requires a private authentication token.');

	return async (request: Request): Promise<Response> => {
		const token = /^Bearer ([\x21-\x7e]+)$/.exec(request.headers.get('authorization') ?? '')?.[1];

		if (!sameSecret(secret, token))
			return Response.json({ error: 'Updater authentication required.' }, { status: 401 });

		const { pathname, search } = new URL(request.url);

		if (!search && request.method === 'GET' && pathname === '/status') return Response.json(service.status());
		if (search || request.method !== 'POST' || !['/install', '/rollback', '/restore'].includes(pathname))
			return Response.json({ error: 'Unknown updater action.' }, { status: 404 });

		const parsed = actionSchema.safeParse({
			...(await request.json().catch(() => null)),
			action: pathname.slice(1)
		});

		if (!parsed.success) return Response.json({ error: 'Invalid updater request.' }, { status: 400 });

		try {
			return Response.json(await service.start(parsed.data), { status: 202 });
		} catch (error) {
			return error instanceof UpdaterRefused
				? Response.json({ error: error.message }, { status: 409 })
				: Response.json({ error: 'The updater could not start the operation.' }, { status: 500 });
		}
	};
}

export interface UpdaterSocket {
	path: string;
	token: string;
}

export async function requestUpdater(socket: UpdaterSocket, action?: UpdaterAction): Promise<UpdaterStatus> {
	const response = await fetch(`http://localhost/${action?.action ?? 'status'}`, {
		unix: socket.path,
		method: action ? 'POST' : 'GET',
		headers: { Authorization: `Bearer ${socket.token}`, 'Content-Type': 'application/json' },
		signal: AbortSignal.timeout(action ? 45_000 : 5000),
		body: action ? JSON.stringify(action) : undefined
	});

	if (!response.ok) {
		const body = (await response.json().catch(() => ({}))) as { error?: string };

		throw new UpdaterRefused(body.error || 'The updater is unavailable.');
	}

	return response.json() as Promise<UpdaterStatus>;
}
