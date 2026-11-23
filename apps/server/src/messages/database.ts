import type { SQL } from 'bun';
import type { Database } from 'bun:sqlite';

type Parameter = string | number | null;

interface Statement {
	text: string;
	params: Parameter[];
}

export type QueryWork<T> = Generator<Statement, T, unknown[]>;

export function* rows<T = never>(text: string, ...params: Parameter[]): QueryWork<T[]> {
	return (yield { text, params }) as T[];
}

export type MessageDatabase = { kind: 'postgres'; sql: SQL } | { kind: 'sqlite'; open: () => Database };

/** A query program lets SQLite keep its synchronous writer lock and PostgreSQL await each statement in order. */
export async function runMessageQueries<T>(database: MessageDatabase, write: boolean, work: QueryWork<T>): Promise<T> {
	if (database.kind === 'sqlite') {
		const sqlite = database.open();

		const run = sqlite.transaction(() => {
			let step = work.next();

			while (!step.done) {
				const { text, params } = step.value;

				step = work.next(sqlite.query(text).all(...params));
			}

			return step.value;
		});

		return write ? run.immediate() : run.deferred();
	}

	return database.sql.begin(async (transaction) => {
		if (!write) await transaction`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;

		let step = work.next();

		while (!step.done) {
			const { text, params } = step.value;

			step = work.next(await transaction.unsafe(text, params));
		}

		return step.value;
	});
}
