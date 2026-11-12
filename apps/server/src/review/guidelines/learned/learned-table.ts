import { join } from 'node:path';
import type { z } from 'zod';
import { readSharedSetting, sharedSettingsActive, writeSharedSetting } from '../../../config/shared-settings.js';
import { serverDataDir } from '../../../util/data-dir.js';
import { readJsonObject, writeJsonAtomically } from '../../../util/json-file.js';

/** Entries Recoder learned from people, by repository id. */
export type LearnedTable<T> = Record<string, T[]>;

/** Where a learned table lives: its shared setting under PostgreSQL, else its file in the data directory. */
interface LearnedTableStorage<T> {
	setting: 'dismissals' | 'finding-votes';
	file: string;
	schema: z.ZodType<LearnedTable<T>>;
}

/**
 * Reads and writes one learned table. Every API replica and executor must see
 * the same table, since it changes what reviews report, so it is a shared
 * setting whenever shared settings are active. A missing or unreadable local
 * file reads as empty, since losing it only means learning again.
 */
export function learnedTable<T>(storage: LearnedTableStorage<T>): {
	read: () => LearnedTable<T>;
	write: (table: LearnedTable<T>) => void;
} {
	const file = (): string => join(serverDataDir(), storage.file);

	return {
		read: () => {
			if (sharedSettingsActive()) return storage.schema.parse(readSharedSetting(storage.setting) ?? {});

			return readJsonObject(file()) as LearnedTable<T>;
		},
		write: (table) => {
			if (sharedSettingsActive()) writeSharedSetting(storage.setting, table);
			else writeJsonAtomically(file(), table);
		}
	};
}
