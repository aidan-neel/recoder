/** The schema this release writes, and the oldest schema it can migrate in place. */
export const DATA_VERSION = 3;

/** The oldest data version this release can open: 0 is data the releases before the ledger wrote. */
export const OLDEST_DATA_VERSION = 0;

export function assertReadableDataVersion(version: number): void {
	if (!Number.isSafeInteger(version) || version < OLDEST_DATA_VERSION)
		throw new Error('The database has an invalid or unsupported data version.');
	if (version > DATA_VERSION)
		throw new Error(
			`Data version ${version} is newer than this Recoder release understands (${DATA_VERSION}). Start a compatible release or restore a compatible backup.`
		);
}

export function pendingVersions(version: number, count: number): number[] {
	if (count !== DATA_VERSION) throw new Error('The migration list does not match this release’s data version.');

	assertReadableDataVersion(version);

	return Array.from({ length: DATA_VERSION - version }, (_, index) => version + index + 1);
}
