import type { ModelCallRow } from '@recoder/shared';
import { postgres } from './backend';
import { currentPostgresTransaction } from './postgres-transactions';
import { sqlite } from './sqlite';
import { metricWrites } from './persistence-queue';

/** Recorded call timestamps are ISO UTC; read just the indexed calendar days the report will add up. */
export async function modelCallsInWindow(from: string, to: string): Promise<ModelCallRow[]> {
	await metricWrites.drainAll();

	if (postgres) {
		const rows = await (currentPostgresTransaction() ?? postgres)<{ value: ModelCallRow }[]>`
			SELECT value FROM recoder_records WHERE collection = 'model_calls'
			AND substring(value->>'at', 1, 10) BETWEEN ${from} AND ${to} ORDER BY position
		`;

		return rows.map((row) => row.value);
	}

	return sqlite()
		.query<{ value: string }, [string, string]>(
			`SELECT value FROM model_calls
			WHERE substr(json_extract(value, '$.at'), 1, 10) BETWEEN ? AND ? ORDER BY rowid`
		)
		.all(from, to)
		.map((row) => JSON.parse(row.value) as ModelCallRow);
}
