import { SQL } from 'bun';
import { chmod } from 'node:fs/promises';
import { postgresDataVersion } from '../postgres-migrations';

const OPTIONS = {
	sslmode: 'PGSSLMODE',
	sslrootcert: 'PGSSLROOTCERT',
	sslcert: 'PGSSLCERT',
	sslkey: 'PGSSLKEY',
	sslcrl: 'PGSSLCRL',
	connect_timeout: 'PGCONNECT_TIMEOUT',
	application_name: 'PGAPPNAME',
	options: 'PGOPTIONS',
	target_session_attrs: 'PGTARGETSESSIONATTRS'
} as const;

/** Give libpq credentials over its private environment, never command arguments or subprocess error output. */
function connectionEnvironment(address: string): Record<string, string | undefined> {
	const url = new URL(address);

	if ((url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') || !url.hostname || url.pathname.length < 2)
		throw new Error('Set RECODER_DATABASE_URL to an explicit PostgreSQL host and database.');

	const environment: Record<string, string | undefined> = {
		PATH: process.env.PATH,
		HOME: process.env.HOME,
		PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
		PGPORT: url.port || '5432',
		PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
		PGUSER: decodeURIComponent(url.username) || undefined,
		PGPASSWORD: decodeURIComponent(url.password) || undefined,
		PGCONNECT_TIMEOUT: '5'
	};

	for (const [name, value] of url.searchParams) {
		if (!Object.hasOwn(OPTIONS, name))
			throw new Error('The PostgreSQL URL has an option this backup command cannot pass safely to libpq.');

		environment[OPTIONS[name as keyof typeof OPTIONS]] = value;
	}

	return environment;
}

async function runClient(executable: 'pg_dump' | 'pg_restore', args: string[], address: string): Promise<void> {
	const program = Bun.which(executable);

	if (!program) throw new Error(`Install ${executable} for your PostgreSQL version before continuing.`);

	const child = Bun.spawn([program, '--no-password', ...args], {
		env: connectionEnvironment(address),
		stdin: 'ignore',
		stdout: 'ignore',
		stderr: 'ignore',
		signal: AbortSignal.timeout(30 * 60_000)
	});

	if ((await child.exited) !== 0)
		throw new Error(`${executable} failed. Check PostgreSQL access and the client version, then retry.`);
}

function connect(address: string): SQL {
	return new SQL(address, { max: 1, connectionTimeout: 5, connection: { statement_timeout: 10_000 } });
}

/** Run against a dedicated Recoder database while migrations and maintenance are stopped. */
export async function snapshotPostgres(address: string, destination: string): Promise<number> {
	const database = connect(address);

	try {
		const version = await postgresDataVersion(database);

		await runClient('pg_dump', ['--format=custom', '--file', destination], address);
		await chmod(destination, 0o600);

		return version;
	} finally {
		await database.close();
	}
}

/** Never overwrite a running HA installation. Restore only to a provisioned, empty database. */
export async function restorePostgres(address: string, source: string): Promise<void> {
	const database = connect(address);

	try {
		const rows = await database`
			SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
			LIMIT 1
		`;

		if (rows.length)
			throw new Error('Restore PostgreSQL into a new, empty database with all Recoder replicas stopped.');
	} finally {
		await database.close();
	}

	await runClient(
		'pg_restore',
		['--dbname', '', '--single-transaction', '--no-owner', '--no-privileges', source],
		address
	);
}
