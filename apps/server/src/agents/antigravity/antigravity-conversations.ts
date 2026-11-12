import { rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { streamCli, type CliExit, type CliInvocation } from '../cli-stream';
import { isConversationUuid, type Env } from './antigravity-process';
import { deleteSummaryRecords, type SummaryStores } from './antigravity-summaries';

/** The files `agy` keeps for one conversation: its SQLite store, annotation, presence lock and brain directory. */
function conversationFiles(base: string, id: string): string[] {
	return [
		join(base, 'conversations', `${id}.db`),
		join(base, 'conversations', `${id}.db-wal`),
		join(base, 'conversations', `${id}.db-shm`),
		join(base, 'annotations', `${id}.pbtxt`),
		join(base, 'presence', `${id}.lock`),
		join(base, 'brain', id)
	];
}

/**
 * Says on the server log that conversations stayed in the CLI's history, and why. Removal is best effort, as every
 * adapter's history cleanup is: the failure is a locked or unreadable store on the user's side, and it must never
 * replace a reply the call already has or stop the server's exit.
 */
function reportLeftConversations(ids: readonly string[], cause: unknown): void {
	const reason = cause instanceof Error ? cause.message : String(cause);

	console.warn(`[antigravity] could not remove ${ids.join(', ')} from the CLI's history: ${reason}`);
}

/**
 * The conversations one adapter saved in the CLI's history under `~/.gemini/antigravity-cli`, and their removal.
 *
 * `agy` 1.5.6 has no flag to skip saving a conversation and no command to delete one, so Recoder deletes what a
 * call saved: the conversation's own files, and its entries in the two summary stores all conversations share.
 *
 * A running `agy` holds every summary it loaded at its start and writes them all back when it ends. So a
 * conversation deleted while another `agy` runs returns: that process puts it back into the snapshot, and the next
 * start copies it into the database, first prompt included (seen with two overlapping runs on the real CLI). Such
 * a conversation is kept as returning and deleted again once the adapter has no `agy` process left.
 *
 * Not covered: the user's own `agy` session, which Recoder cannot see. It can write back a conversation that
 * existed when it started, and it rewrites the snapshot without taking the database lock.
 */
export class ConversationLedger {
	/** Saved by a call or run still in flight. */
	private readonly active = new Set<string>();
	/** Deleted while another `agy` process ran, which writes them back when it ends. */
	private readonly returning = new Set<string>();
	private readonly base: string;
	private readonly stores: SummaryStores;

	constructor(
		env: Env,
		private readonly running: Set<Bun.Subprocess>
	) {
		this.base = join(env.HOME || homedir(), '.gemini', 'antigravity-cli');

		this.stores = {
			database: join(this.base, 'conversation_summaries.db'),
			snapshot: join(this.base, 'jetbox_summaries_proto.pb')
		};
	}

	/**
	 * Runs one `agy` process among the adapter's others. When the last of them ends, no process can write a deleted
	 * conversation back any more, so the returning ones are deleted for good.
	 */
	async stream(invocation: Omit<CliInvocation, 'running'>): Promise<CliExit> {
		try {
			return await streamCli({ ...invocation, running: this.running });
		} finally {
			this.deleteReturned();
		}
	}

	/**
	 * Starts tracking a conversation `agy` announced. An id that is not a UUID names nothing the CLI saved; it is
	 * not tracked, so it is never joined into a path.
	 */
	track(id: string): void {
		if (isConversationUuid(id)) this.active.add(id);
	}

	/** Deletes one tracked conversation. Rejects when a file or a store refuses; the conversation then stays tracked. */
	async delete(id: string): Promise<void> {
		if (!this.active.has(id)) return;

		await Promise.all(conversationFiles(this.base, id).map((target) => rm(target, { recursive: true, force: true })));
		deleteSummaryRecords(this.stores, [id]);

		this.active.delete(id);
		if (this.running.size > 0) this.returning.add(id);
	}

	/**
	 * Synchronously deletes every conversation still tracked when the server exits. It runs inside the exit
	 * listeners, where a throw would stop the other adapters' cleanup, so it never throws. The summary stores take
	 * one transaction for all conversations, which keeps the exit to one lock wait at most.
	 */
	sweep(): void {
		try {
			for (const id of this.active) {
				for (const target of conversationFiles(this.base, id)) rmSync(target, { recursive: true, force: true });
			}

			deleteSummaryRecords(this.stores, [...this.active, ...this.returning]);
			this.active.clear();
			this.returning.clear();
		} catch (sweepError) {
			reportLeftConversations([...this.active, ...this.returning], sweepError);
		}
	}

	private deleteReturned(): void {
		if (this.running.size > 0 || this.returning.size === 0) return;

		try {
			deleteSummaryRecords(this.stores, [...this.returning]);
			this.returning.clear();
		} catch (storeError) {
			reportLeftConversations([...this.returning], storeError);
		}
	}
}

/**
 * The conversations of one completion or agent run: each id is tracked from the `init` line that announces it, so
 * the shutdown sweep reaches a call in flight, and {@link removeAll} deletes them when the call or run ends.
 */
export class ConversationTracker {
	latestId: string | null = null;

	private readonly ids = new Set<string>();

	constructor(private readonly ledger: ConversationLedger) {}

	readonly add = (id: string): void => {
		this.latestId = id;
		this.ids.add(id);
		this.ledger.track(id);
	};

	/**
	 * Deletes every conversation this tracker saw. Never rejects: one that could not be deleted is reported and stays
	 * tracked, so a later call here or the shutdown sweep tries it again.
	 */
	async removeAll(): Promise<void> {
		await Promise.all([...this.ids].map((id) => this.remove(id)));
	}

	private async remove(id: string): Promise<void> {
		try {
			await this.ledger.delete(id);
			this.ids.delete(id);
		} catch (removalError) {
			reportLeftConversations([id], removalError);
		}
	}
}
