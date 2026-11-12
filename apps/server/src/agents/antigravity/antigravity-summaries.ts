import { Database } from 'bun:sqlite';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

const SUMMARY_DELETE_STATEMENTS: ReadonlyArray<{ table: string; sql: string }> = [
	{ table: 'conversation_summaries', sql: 'DELETE FROM conversation_summaries WHERE conversation_id = ?' },
	{ table: 'conversations_fts', sql: 'DELETE FROM conversations_fts WHERE conversation_id = ?' },
	{ table: 'conversation_parents', sql: 'DELETE FROM conversation_parents WHERE conversation_id = ?' }
];

interface VarintResult {
	next: number;
	value: bigint;
}

interface WireRecord {
	end: number;
	fieldNumber: number;
	payloadEnd: number;
	payloadStart: number;
	start: number;
	wireType: number;
}

/** Reads one base-128 varint from `buffer` starting at `offset`. */
function readVarint(buffer: Uint8Array, offset: number): VarintResult {
	let value = 0n;
	let shift = 0n;
	let cursor = offset;

	while (cursor < buffer.length) {
		const byte = buffer[cursor] ?? 0;

		cursor += 1;
		value |= BigInt(byte & 0x7f) << shift;
		if ((byte & 0x80) === 0) return { value, next: cursor };
		shift += 7n;
		if (shift > 63n) throw new Error('Protobuf varint exceeds 64 bits.');
	}

	throw new Error('Unexpected end of protobuf varint.');
}

/** Reads one protobuf wire record at `offset` in `buffer`. */
function readWireRecord(buffer: Uint8Array, offset: number): WireRecord {
	const tag = readVarint(buffer, offset);
	const fieldNumber = Number(tag.value >> 3n);
	const wireType = Number(tag.value & 7n);

	if (wireType === 0) {
		const skipped = readVarint(buffer, tag.next);

		return {
			start: offset,
			end: skipped.next,
			fieldNumber,
			wireType,
			payloadStart: tag.next,
			payloadEnd: skipped.next
		};
	}

	if (wireType === 1) {
		const end = tag.next + 8;

		if (end > buffer.length) throw new Error('Truncated 64-bit protobuf field.');

		return { start: offset, end, fieldNumber, wireType, payloadStart: tag.next, payloadEnd: end };
	}

	if (wireType === 2) {
		const length = readVarint(buffer, tag.next);
		const byteLength = Number(length.value);
		const end = length.next + byteLength;

		if (!Number.isSafeInteger(byteLength) || byteLength < 0 || end > buffer.length) {
			throw new Error('Truncated length-delimited protobuf field.');
		}

		return { start: offset, end, fieldNumber, wireType, payloadStart: length.next, payloadEnd: end };
	}

	if (wireType === 5) {
		const end = tag.next + 4;

		if (end > buffer.length) throw new Error('Truncated 32-bit protobuf field.');

		return { start: offset, end, fieldNumber, wireType, payloadStart: tag.next, payloadEnd: end };
	}

	throw new Error(`Unsupported protobuf wire type ${wireType}.`);
}

/** Extracts the string map key (field 1) from a serialized protobuf map-entry payload. */
function readMapEntryKey(payload: Uint8Array): string | null {
	let offset = 0;
	let key: string | null = null;

	while (offset < payload.length) {
		const field = readWireRecord(payload, offset);

		if (field.fieldNumber === 1 && field.wireType === 2) {
			key = Buffer.from(payload.subarray(field.payloadStart, field.payloadEnd)).toString('utf8');
		}

		offset = field.end;
	}

	return key;
}

/**
 * Removes every map entry keyed by `id` from `jetbox_summaries_proto.pb`, which `agy` 1.5.6 loads on startup and
 * mirrors back into `conversation_summaries.db`. Other entries are preserved byte-for-byte via atomic temp-file rename.
 */
function pruneSummariesProto(protoPath: string, id: string): void {
	if (!existsSync(protoPath)) return;

	let raw: Buffer;

	try {
		raw = readFileSync(protoPath);
	} catch (readError) {
		if (!existsSync(protoPath)) return;
		throw readError;
	}

	const kept: Uint8Array[] = [];
	let offset = 0;
	let removed = false;

	while (offset < raw.length) {
		const record = readWireRecord(raw, offset);

		if (
			record.fieldNumber === 1 &&
			record.wireType === 2 &&
			readMapEntryKey(raw.subarray(record.payloadStart, record.payloadEnd)) === id
		) {
			removed = true;
		} else {
			kept.push(raw.subarray(record.start, record.end));
		}

		offset = record.end;
	}

	if (!removed) return;

	const tempPath = `${protoPath}.${process.pid}.${crypto.randomUUID()}.tmp`;

	try {
		writeFileSync(tempPath, Buffer.concat(kept), { mode: 0o600 });
		renameSync(tempPath, protoPath);
	} catch (writeError) {
		rmSync(tempPath, { force: true });
		throw writeError;
	}
}

/**
 * Deletes `id` from `conversation_summaries.db` (`conversation_summaries`, `conversations_fts`, `conversation_parents`)
 * and `jetbox_summaries_proto.pb` inside one `IMMEDIATE` SQLite transaction when the database exists, serializing
 * concurrent Recoder cleanups in the same `$HOME`.
 */
export function deleteConversationSummaryRecords(summariesDb: string, summariesProto: string, id: string): void {
	if (!existsSync(summariesDb)) {
		try {
			pruneSummariesProto(summariesProto, id);
		} catch (protoError) {
			const detail = protoError instanceof Error ? protoError.message : String(protoError);

			throw new Error(`Failed to delete Antigravity conversation ${id} from summaries snapshot: ${detail}`, {
				cause: protoError
			});
		}

		return;
	}

	let database: Database;

	try {
		database = new Database(summariesDb, { readwrite: true, create: false });
	} catch (openError) {
		if (!existsSync(summariesDb)) return;

		const detail = openError instanceof Error ? openError.message : String(openError);

		throw new Error(`Failed to open Antigravity summaries database for conversation ${id}: ${detail}`, {
			cause: openError
		});
	}

	try {
		database.run('PRAGMA busy_timeout = 5000');

		const tables = new Set(
			database
				.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
				.all()
				.map((row) => row.name)
		);

		const removeRows = database.transaction((conversationId: string) => {
			for (const statement of SUMMARY_DELETE_STATEMENTS) {
				if (tables.has(statement.table)) database.query(statement.sql).run(conversationId);
			}

			pruneSummariesProto(summariesProto, conversationId);
		});

		removeRows.immediate(id);
	} catch (deleteError) {
		const detail = deleteError instanceof Error ? deleteError.message : String(deleteError);

		throw new Error(`Failed to delete Antigravity conversation ${id} from summaries database: ${detail}`, {
			cause: deleteError
		});
	} finally {
		database.close();
	}
}
