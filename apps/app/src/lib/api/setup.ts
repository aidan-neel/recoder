import type { SetAddress, SetupAddress, SetupChecklist, StorageTest } from '@recoder/shared';

import { post, request } from './http';

/**
 * The setup checklist's calls (plans/AID-deploy-api.md in the Captain drive). Before an account exists anyone may
 * read them, and the ones that change the server answer 403 `setup-locked` until this browser entered the setup
 * code; after that they are the admin's.
 */
export const setupApi = {
	checklist: () => request<SetupChecklist>('/api/setup'),
	address: () => request<SetupAddress>('/api/setup/address'),
	setAddress: (address: SetAddress) => post<SetupAddress>('/api/setup/address', address),
	useBuiltinStorage: () => post<SetupChecklist>('/api/setup/storage', { kind: 'builtin' }),
	/** Tries a PostgreSQL URL; a running install moves to it only offline, with the import the docs describe. */
	testStorage: (url: string) => post<StorageTest>('/api/server/storage/test', { url }),
	finish: () => post<SetupChecklist>('/api/setup/finish')
};
