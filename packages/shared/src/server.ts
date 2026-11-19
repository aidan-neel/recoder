/**
 * Running a Recoder server from the browser: the setup checklist a fresh
 * install walks through, the server's checks and overview, its backups and its
 * log. The contract is plans/AID-deploy-api.md in the Recoder Captain drive.
 * Every route is the admin's once an account exists; before that, the setup
 * routes answer anyone and the ones that change the server refuse a locked
 * browser with 403 `setup-locked`, like the claim routes do.
 */

/** The setup checklist's steps, in order. */
export type SetupStepId = 'claim' | 'address' | 'admin' | 'provider' | 'model' | 'storage' | 'check';

/** One step of the checklist. The first step not done is the current one; the app picks it. */
export interface SetupStep {
	id: SetupStepId;
	done: boolean;
	/** One line of what is in place once done (`recoder.acme.dev · certificate issued`); unset before. */
	fact?: string;
	/** Why the step's last attempt failed, until it is tried again. */
	error?: string;
}

/** `GET /api/setup`: where the checklist stands. `complete` turns it off for good (`POST /api/setup/finish`). */
export interface SetupChecklist {
	steps: SetupStep[];
	complete: boolean;
}

/** Where HTTPS for the server's address stands. `external`: a proxy in front of Recoder terminates TLS. */
export type TlsState = 'off' | 'pending' | 'issued' | 'failed' | 'external';

export interface TlsStatus {
	state: TlsState;
	/** The domain the certificate is for; null before one is set. */
	domain: string | null;
	issuer?: string;
	expiresAt?: string;
	/** Why the last certificate request failed. */
	error?: string;
}

/** Whether the domain's DNS points at this server. */
export interface DnsCheck {
	domain: string;
	points: boolean;
	/** The addresses the domain resolves to now. */
	found: string[];
	/** The addresses it must resolve to. */
	expected: string[];
}

/** `GET /api/setup/address`: the address step's state, polled while the certificate is `pending`. */
export interface SetupAddress {
	/** The address this browser reached the server on (`http://203.0.113.7`). */
	reachedAt: string;
	/** The public address, once set. */
	publicUrl: string | null;
	tls: TlsStatus;
	/** Present once a domain was given. */
	dns?: DnsCheck;
}

/**
 * `POST /api/setup/address`: a domain Recoder gets a certificate for, or the public address of a proxy that
 * already terminates TLS in front of it. Answers `SetupAddress`.
 */
export type SetAddress = { domain: string } | { external: string };

/** Which store the server keeps its data in. */
export type StorageKind = 'builtin' | 'postgres';

export interface StorageStatus {
	kind: StorageKind;
	/** The database's size; null when the server cannot read it. */
	sizeBytes: number | null;
	/** PostgreSQL: the host and database, never the credentials. */
	location?: string;
}

/**
 * `POST /api/setup/storage`: keep the built-in database, or move to PostgreSQL. A move restarts the server
 * through the updater and answers its `UpdateStatus` (operation `storage`); `import` copies the built-in data
 * across first.
 */
export type SetStorage = { kind: 'builtin' } | { kind: 'postgres'; url: string; import: boolean };

/** `POST /api/server/storage/test`: whether the server can open a PostgreSQL URL. */
export interface StorageTest {
	ok: boolean;
	/** PostgreSQL's version when it answered. */
	version?: string;
	error?: string;
}

/** The server's checks, in the order the app lists them. */
export type ServerCheckId = 'https' | 'reachable' | 'forge' | 'webhooks' | 'model' | 'database' | 'disk' | 'version';

/** `warn` does not block setup; `fail` does. `skipped`: the check does not apply to this install. */
export type ServerCheckState = 'ok' | 'warn' | 'fail' | 'pending' | 'skipped';

export interface ServerCheck {
	id: ServerCheckId;
	state: ServerCheckState;
	/** What was found (`Let's Encrypt, 89 days`, `41 GB free`). */
	detail: string;
	/** What to do about a `warn` or `fail`. */
	fix?: string;
}

/** `GET /api/server/checks`, and `POST` to run them again (`?only=<id>` runs one). */
export interface ServerChecks {
	checkedAt: string;
	/** True while a run is in flight; the app polls until it is false. */
	running: boolean;
	checks: ServerCheck[];
}

/** `GET /api/server`: Settings → Server's overview. */
export interface ServerOverview {
	version: string;
	startedAt: string;
	publicUrl: string | null;
	tls: TlsStatus;
	storage: StorageStatus;
	/** The data volume's space; null when the server cannot read it. */
	disk: { freeBytes: number; totalBytes: number } | null;
	reviews: { running: number; queued: number };
}

/** Why a backup was taken. */
export type BackupReason = 'nightly' | 'update' | 'manual';

/** One backup: the database and the data folder's settings in one archive. Never the secret key. */
export interface Backup {
	id: string;
	createdAt: string;
	sizeBytes: number;
	reason: BackupReason;
	/** The Recoder version that took it. */
	version: string;
	dataVersion: number;
}

export interface BackupPolicy {
	schedule: 'off' | 'nightly';
	/** The hour of the nightly backup, 0 to 23, in the server's time zone. */
	hour: number;
	/** How many backups to keep, 1 to 30; the oldest go first. Backups taken before an update count too. */
	keep: number;
}

/**
 * `GET /api/server/backups`; `POST` takes one now (202), `PUT /api/server/backups/policy` saves the policy,
 * `DELETE /api/server/backups/:id` removes one, `GET /api/server/backups/:id/download` streams it, and
 * `POST /api/server/backups/:id/restore` restores it through the updater, answering `UpdateStatus`.
 */
export interface BackupsState {
	/** False on PostgreSQL and managed installs: the database's own backups are the ones that count. */
	supported: boolean;
	/** Why backups are not supported here. */
	note?: string;
	/** True while a backup is being taken. */
	running: boolean;
	backups: Backup[];
	policy: BackupPolicy;
}

/** Where a log line came from. */
export type LogSource = 'server' | 'updater' | 'proxy';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** One line of the server's log, already redacted. `seq` only grows. */
export interface LogLine {
	seq: number;
	at: string;
	level: LogLevel;
	source: LogSource;
	message: string;
}

/**
 * `GET /api/server/logs?before=<seq>&limit=<n>&source=<source>&level=<level>`: newest first, at most 500. New lines
 * arrive on `GET /api/server/logs/events` as server-sent `line` events carrying a `LogLine`.
 */
export interface LogPage {
	lines: LogLine[];
	/** The `seq` to pass as `before` for older lines; null at the start of what the server keeps. */
	before: number | null;
}
