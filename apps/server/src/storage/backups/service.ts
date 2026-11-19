import { lstat, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Backup, BackupPolicy, BackupReason, BackupsState } from '@recoder/shared';
import { serverDataDir } from '../../util/data-dir';
import { postgres } from '../backend';
import { flushPersistence } from '../../store';
import { backupRoot, createBackup, describeBackup, findBackup, isMissingFile } from './store';

export const backupPolicySchema = z.object({
	schedule: z.enum(['off', 'nightly']),
	hour: z.number().int().min(0).max(23),
	keep: z.number().int().min(1).max(30)
});

const DEFAULT_POLICY: BackupPolicy = { schedule: 'nightly', hour: 3, keep: 7 };
const POLICY_FILE = 'policy.json';
const backupId = z.uuid();

let running = false;
let lastError: string | undefined;

export class BackupRefusedError extends Error {}

function managedNote(): string | undefined {
	if (postgres) return 'Use your PostgreSQL provider’s backup and restore process for this installation.';
	if (process.env.KUBERNETES_SERVICE_HOST) return 'Back up the data volume with your Kubernetes storage provider.';
}

async function policyAt(root: string): Promise<BackupPolicy> {
	const path = join(root, POLICY_FILE);

	try {
		const info = await lstat(path);

		if (!info.isFile() || info.size > 4096) throw new Error('The backup policy file is invalid.');

		return backupPolicySchema.parse(await Bun.file(path).json());
	} catch (error) {
		if (isMissingFile(error)) return { ...DEFAULT_POLICY };
		throw error;
	}
}

async function list(root: string): Promise<Backup[]> {
	const entries = await readdir(root, { withFileTypes: true });

	const backups = await Promise.all(
		entries
			.filter((entry) => entry.isDirectory() && backupId.safeParse(entry.name).success)
			.map(async (entry) => {
				try {
					const backup = await describeBackup(join(root, entry.name));

					return backup.id === entry.name ? backup : undefined;
				} catch (error) {
					if (isMissingFile(error)) return undefined;
					throw error;
				}
			})
	);

	return backups
		.filter((backup) => backup !== undefined)
		.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function backupStatus(): Promise<BackupsState> {
	const note = managedNote();

	if (note) return { supported: false, note, running: false, backups: [], policy: { ...DEFAULT_POLICY } };

	const root = await backupRoot(serverDataDir());
	const [backups, policy] = await Promise.all([list(root), policyAt(root)]);

	return { supported: true, running, backups, policy, ...(lastError ? { note: lastError } : {}) };
}

function requireLocalBackups(): void {
	const reason = managedNote();

	if (reason) throw new BackupRefusedError(reason);
}

/** A single pending snapshot bounds resource usage even when the timer and a request arrive together. */
export function startBackup(reason: BackupReason): Promise<Backup> {
	requireLocalBackups();
	if (running) throw new BackupRefusedError('A backup is already running.');

	running = true;
	lastError = undefined;

	return takeBackup(reason).finally(() => {
		running = false;
	});
}

async function takeBackup(reason: BackupReason): Promise<Backup> {
	try {
		await flushPersistence();

		const data = serverDataDir();
		const created = await createBackup(data, reason);
		const root = await backupRoot(data);
		const [backups, policy] = await Promise.all([list(root), policyAt(root)]);

		for (const backup of backups.slice(policy.keep)) await rm(join(root, backup.id), { recursive: true, force: true });

		return created;
	} catch (error) {
		lastError = 'The last backup failed. Check that the data volume has enough space and try again.';
		console.error('[backups] snapshot failed', error instanceof Error ? error.name : typeof error);
		throw new BackupRefusedError(lastError);
	}
}

export async function saveBackupPolicy(policy: BackupPolicy): Promise<BackupsState> {
	requireLocalBackups();

	const root = await backupRoot(serverDataDir());
	const temporary = join(root, `.policy-${crypto.randomUUID()}`);

	try {
		await writeFile(temporary, JSON.stringify(policy), { mode: 0o600, flag: 'wx', flush: true });
		await rename(temporary, join(root, POLICY_FILE));
	} finally {
		await rm(temporary, { force: true });
	}

	return backupStatus();
}

export async function deleteBackup(id: string): Promise<BackupsState | undefined> {
	requireLocalBackups();

	const directory = await findBackup(serverDataDir(), id);

	if (!directory) return undefined;

	await rm(directory, { recursive: true, force: true });

	return backupStatus();
}

async function maybeNightly(): Promise<void> {
	if (running) return;

	const { policy, backups } = await backupStatus();
	const now = new Date();

	if (policy.schedule === 'off' || policy.hour !== now.getHours()) return;
	if (
		backups.some(
			(backup) => backup.reason === 'nightly' && new Date(backup.createdAt).toDateString() === now.toDateString()
		)
	)
		return;

	await startBackup('nightly');
}

export function startNightlyBackups(): void {
	if (managedNote()) return;

	const timer = setInterval(() => void maybeNightly().catch(() => {}), 60_000);

	timer.unref();
}
