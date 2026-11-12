import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
	closePublicationStorage,
	initializePublication,
	PostgresPublications,
	PublicationUncertainError,
	type PublishedComment
} from '../../src/storage/postgres-publication';
import { PostgresCoordinator } from '../../src/review/runtime/coordinator';
import { assertOwnership, OwnershipLostError, withLease } from '../../src/review/runtime/ownership';

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `publication_${crypto.randomUUID().replaceAll('-', '')}`;

class MissingComment extends Error {}

class RejectedComment extends Error {}

function remote(inline = false) {
	let comment: PublishedComment | null = null;
	let creates = 0;
	let edits = 0;
	let loseResponse = false;
	let rejected = false;

	return {
		get creates() {
			return creates;
		},
		get edits() {
			return edits;
		},
		set loseResponse(value: boolean) {
			loseResponse = value;
		},
		set rejected(value: boolean) {
			rejected = value;
		},
		remove: () => {
			comment = null;
		},
		attempt: {
			marker: 'recoder-test-marker',
			find: async () => comment,
			edit: async (known: PublishedComment) => {
				if (!comment || comment.id !== known.id) throw new MissingComment();

				edits++;

				return comment;
			},
			create: async () => {
				creates++;

				if (rejected) throw new RejectedComment();

				comment = { id: String(creates), url: `https://forge.invalid/comment/${creates}`, inline };

				if (loseResponse) throw new Error('The create response was lost.');

				return comment;
			},
			isMissing: (error: unknown) => error instanceof MissingComment,
			isRejected: (error: unknown) => error instanceof RejectedComment
		}
	};
}

describe.skipIf(!databaseUrl)('Postgres publication (requires TEST_DATABASE_URL)', () => {
	const url = databaseUrl ?? 'postgres://unused.invalid/disabled';
	const admin = new SQL(url);
	const options = { max: 2, connection: { search_path: schema, statement_timeout: 5000, lock_timeout: 1000 } };
	const firstSql = new SQL(url, options);
	const secondSql = new SQL(url, options);
	const first = new PostgresPublications(firstSql, assertOwnership);
	const second = new PostgresPublications(secondSql, assertOwnership);
	const coordination = new PostgresCoordinator(firstSql, { leaseMs: 30_000 });

	beforeAll(async () => {
		await admin`CREATE SCHEMA ${admin(schema)}`;
		await Promise.all([initializePublication(firstSql), initializePublication(secondSql)]);
		await coordination.initialize();
	});

	beforeEach(async () => {
		await firstSql`TRUNCATE recoder_publications, review_actor_leases, review_actor_commands CASCADE`;
	});

	afterAll(async () => {
		await Promise.all([closePublicationStorage(firstSql), closePublicationStorage(secondSql)]);
		await Promise.all([firstSql.close(), secondSql.close()]);
		await admin`DROP SCHEMA ${admin(schema)} CASCADE`;
		await admin.close();
	});

	test('concurrent replicas create one comment and reuse its durable record', async () => {
		const forge = remote();

		const posted = await Promise.all(
			Array.from({ length: 12 }, (_, index) =>
				(index % 2 ? first : second).run('github:acme/app:7', (session) => session.publish(forge.attempt))
			)
		);

		expect(forge.creates).toBe(1);
		expect(forge.edits).toBe(11);
		expect(posted.every((comment) => comment.id === '1')).toBe(true);
	});

	for (const inline of [false, true]) {
		test(`a lost ${inline ? 'inline' : 'summary'} create response is reconciled without another create`, async () => {
			const forge = remote(inline);

			forge.loseResponse = true;

			await expect(first.run('pull-7', (session) => session.publish(forge.attempt))).rejects.toThrow(
				'response was lost'
			);

			const posted = await second.run('pull-7', (session) => session.publish(forge.attempt));

			expect(posted).toMatchObject({ id: '1', inline });
			expect(forge.creates).toBe(1);
			expect(forge.edits).toBe(1);
		});
	}

	test('an uncertain create without a visible marker refuses a second create', async () => {
		const forge = remote();

		const attempt = {
			...forge.attempt,
			create: async () => {
				throw new Error('Request outcome unknown.');
			}
		};

		await expect(first.run('pull-7', (session) => session.publish(attempt))).rejects.toThrow('outcome unknown');

		await expect(second.run('pull-7', (session) => session.publish(forge.attempt))).rejects.toBeInstanceOf(
			PublicationUncertainError
		);

		expect(forge.creates).toBe(0);
	});

	test('a confirmed rejection can be retried after its cause is fixed', async () => {
		const forge = remote();

		forge.rejected = true;

		await expect(first.run('pull-7', (session) => session.publish(forge.attempt))).rejects.toBeInstanceOf(
			RejectedComment
		);

		forge.rejected = false;

		const posted = await second.run('pull-7', (session) => session.publish(forge.attempt));

		expect(posted.id).toBe('2');
	});

	test('a known successful comment that was deleted can be recreated', async () => {
		const forge = remote();

		await first.run('pull-7', (session) => session.publish(forge.attempt));
		forge.remove();

		const replacement = await second.run('pull-7', (session) => session.publish(forge.attempt));

		expect(replacement.id).toBe('2');
		expect(forge.creates).toBe(2);
	});

	test('an expired executor cannot begin a remote create', async () => {
		const forge = remote();

		await coordination.enqueue('review-1');

		const old = await coordination.claim('old-server');

		if (!old) throw new Error('Expected a review lease.');

		await firstSql`UPDATE review_actor_leases SET expires_at = clock_timestamp() - interval '1 second'`;

		await expect(
			withLease(old, () => first.run('pull-7', (session) => session.publish(forge.attempt)))
		).rejects.toBeInstanceOf(OwnershipLostError);

		expect(forge.creates).toBe(0);
	});

	test('lease loss after a remote create preserves uncertainty for the successor', async () => {
		const forge = remote();

		await coordination.enqueue('review-1');

		const old = await coordination.claim('old-server');

		if (!old) throw new Error('Expected a review lease.');

		const create = async () => {
			const posted = await forge.attempt.create();

			await secondSql`UPDATE review_actor_leases SET expires_at = clock_timestamp() - interval '1 second'`;

			return posted;
		};

		await expect(
			withLease(old, () => first.run('pull-7', (session) => session.publish({ ...forge.attempt, create })))
		).rejects.toBeInstanceOf(OwnershipLostError);

		const successor = await coordination.claim('new-server');

		if (!successor) throw new Error('Expected takeover of the expired review.');

		const posted = await withLease(successor, () => second.run('pull-7', (session) => session.publish(forge.attempt)));

		expect(posted.id).toBe('1');
		expect(forge.creates).toBe(1);
	});

	test('final publication waits for queued writes and keeps shared settings alive until they finish', async () => {
		const name = `publication_lifetime_${crypto.randomUUID().replaceAll('-', '')}`;
		const directory = await mkdtemp(join(tmpdir(), 'recoder-publication-lifetime-'));
		const isolatedUrl = new URL(url);

		isolatedUrl.pathname = `/${name}`;
		await admin`CREATE DATABASE ${admin(name)}`;

		const child = Bun.spawn([process.execPath, resolve(import.meta.dir, 'publication-lifetime.ts')], {
			cwd: resolve(import.meta.dir, '../../../..'),
			env: {
				...process.env,
				HOME: directory,
				GH_TOKEN: '',
				GITHUB_TOKEN: '',
				GITLAB_TOKEN: '',
				RECODER_DATABASE_URL: isolatedUrl.href,
				RECODER_DATA_DIR: directory,
				RECODER_OPENCODE_BIN: '',
				RECODER_CLAUDE_BIN: ''
			},
			stdout: 'pipe',
			stderr: 'pipe'
		});

		const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
		const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000);

		try {
			const exitCode = await child.exited;
			const logs = await output;

			expect({ exitCode, logs: exitCode ? logs : [] }).toEqual({ exitCode: 0, logs: [] });
		} finally {
			clearTimeout(timeout);
			if (child.exitCode === null) child.kill('SIGKILL');
			await child.exited;
			await admin`DROP DATABASE ${admin(name)} WITH (FORCE)`;
			await rm(directory, { recursive: true, force: true });
		}
	}, 15_000);
});
