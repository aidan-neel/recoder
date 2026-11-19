import { UpdaterRefused } from './protocol';

export interface ReleaseData {
	dataVersion: number;
	oldestDataVersion: number;
}

export function requireCompatibleData(release: ReleaseData, version: number): void {
	if (version < release.oldestDataVersion || version > release.dataVersion) {
		throw new UpdaterRefused(`This release cannot read data version ${version}.`);
	}
}

/** A cross-version rollback is a deliberate restore, never a lower-version server starting on today's files. */
export function rollbackBackup(
	current: number,
	target: ReleaseData,
	previous: { id: string; dataVersion: number } | undefined
): string | undefined {
	if (current === target.dataVersion) return;

	if (!previous || previous.dataVersion !== target.dataVersion) {
		throw new UpdaterRefused('Rollback requires the original pre-update backup for the target data version.');
	}

	requireCompatibleData(target, previous.dataVersion);

	return previous.id;
}
