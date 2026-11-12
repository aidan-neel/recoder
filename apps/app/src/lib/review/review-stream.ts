import type { ProgressMessage } from '@recoder/shared';

import { reviewsApi } from '../api/reviews';

/** How the live connection stands, for the small status line beside the progress. */
export type Connection = 'connecting' | 'live' | 'reconnecting' | 'closed';

interface StreamHandlers {
	/**
	 * One message. `opening` is true for the snapshot each connection starts
	 * with, which holds all the progress the server has, so it replaces what
	 * the page shows even when the server has less (after a hard restart).
	 */
	onMessage: (message: ProgressMessage, opening: boolean) => void;
	onConnection: (connection: Connection) => void;
	/**
	 * Nothing arrived for a while (heartbeats come every 5s), the server
	 * refused the stream, or it failed twice in a row: the caller re-reads
	 * the review over REST, which also finds out when the review is gone.
	 */
	onStale: () => void;
	/**
	 * No snapshot arrived within {@link SNAPSHOT_MS} of opening the stream or
	 * of a retry. The stream keeps trying; the caller says the live view did
	 * not load and offers {@link ReviewStream.retry}.
	 */
	onNoSnapshot: () => void;
	/** The count of failed attempts in a row changed: up with each failure, back to 0 once one opens or on a retry. */
	onFailures: (failures: number) => void;
}

/** A connection that has not opened by now shows as reconnecting. */
const READY_MS = 1500;

/** The server sends a heartbeat this often while nothing else happens. */
const HEARTBEAT_MS = 5000;

/** The watchdog checks this often. */
const WATCH_MS = 1000;

/** One heartbeat is late by now, so the status line says the stream is reconnecting... */
const LATE_MS = HEARTBEAT_MS * 1.5;

/** ...and two missed heartbeats reopen it. */
const SILENCE_MS = HEARTBEAT_MS * 2 + 1000;

/** Wait before reopening a stream the browser gave up on; each failure in a row doubles it, up to the ceiling. */
const RETRY_MS = 2000;

const RETRY_MAX_MS = 30000;

/** How long the first snapshot may take before the live views stop waiting for it. */
export const SNAPSHOT_MS = 8000;

/** A frame's message; null when it is not JSON, so a bad frame is skipped. */
function parse(data: string): ProgressMessage | null {
	try {
		return JSON.parse(data) as ProgressMessage;
	} catch {
		return null;
	}
}

/**
 * Follows one review's `/events` stream. Every connection starts with a fresh
 * snapshot, so reconnecting never loses progress. The stream stays open after
 * the review ends, because replies to questions arrive on it too.
 */
export class ReviewStream {
	private source: EventSource | null = null;
	private lastAt = 0;
	private watchdog: ReturnType<typeof setInterval> | null = null;
	private readyTimer: ReturnType<typeof setTimeout> | null = null;
	private retryTimer: ReturnType<typeof setTimeout> | null = null;
	private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
	private retries = 0;
	private closed = false;
	private snapshot = false;
	/** True until the open connection's first message: the snapshot the server starts every connection with. */
	private opening = false;
	private connection: Connection = 'closed';

	constructor(
		private readonly id: string,
		private readonly handlers: StreamHandlers
	) {}

	open(): void {
		this.closed = false;
		this.connect();
		this.awaitSnapshot();
		this.watchdog = setInterval(() => this.watch(), WATCH_MS);
	}

	close(): void {
		this.closed = true;
		this.disconnect();

		if (this.watchdog) clearInterval(this.watchdog);
		if (this.retryTimer) clearTimeout(this.retryTimer);
		if (this.snapshotTimer) clearTimeout(this.snapshotTimer);

		this.report('closed');
	}

	/** Reconnects now, as the person asked, with the backoff reset and the wait for a snapshot started over. */
	retry(): void {
		if (this.closed) return;

		this.countFailures(0);
		this.connect();
		this.awaitSnapshot();
	}

	/** Sets the count of failures in a row, and passes it on when it changed. */
	private countFailures(retries: number): void {
		if (retries === this.retries) return;

		this.retries = retries;
		this.handlers.onFailures(retries);
	}

	/** Gives the first snapshot {@link SNAPSHOT_MS}; once one arrived, a later connection is not timed. */
	private awaitSnapshot(): void {
		if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
		if (this.snapshot) return;

		this.snapshotTimer = setTimeout(() => {
			if (!this.closed && !this.snapshot) this.handlers.onNoSnapshot();
		}, SNAPSHOT_MS);
	}

	/** Passes on a change of state; the same state twice says nothing, so the status line never blinks. */
	private report(connection: Connection): void {
		if (connection === this.connection) return;

		this.connection = connection;
		this.handlers.onConnection(connection);
	}

	/** Opens a stream. Only the first one is "connecting"; any later one is a reconnect, whatever started it. */
	private connect(): void {
		if (this.retryTimer) clearTimeout(this.retryTimer);

		this.retryTimer = null;
		this.disconnect();
		this.opening = true;
		this.lastAt = Date.now();
		this.report(this.connection === 'closed' ? 'connecting' : 'reconnecting');

		const source = new EventSource(reviewsApi.eventsUrl(this.id));

		this.source = source;
		this.readyTimer = setTimeout(() => this.report('reconnecting'), READY_MS);
		source.onopen = () => this.opened();
		source.onmessage = (event) => this.received(event.data);
		source.onerror = () => this.failed(source);
	}

	private disconnect(): void {
		if (this.readyTimer) clearTimeout(this.readyTimer);

		this.source?.close();
		this.source = null;
	}

	/** The connection opened, so the next failure waits the shortest time again. */
	private opened(): void {
		if (this.readyTimer) clearTimeout(this.readyTimer);

		this.countFailures(0);
		this.report('live');
	}

	private received(data: string): void {
		this.lastAt = Date.now();

		if (this.source?.readyState === EventSource.OPEN) this.report('live');

		const message = parse(data);

		if (!message) return;

		const opening = this.opening && !!message.snapshot;

		this.opening = false;

		if (message.snapshot && !this.snapshot) {
			this.snapshot = true;

			if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
		}

		this.handlers.onMessage(message, opening);
	}

	/**
	 * A connection failed: the server refused it (the browser closed it), or
	 * it dropped or never reached the server (the browser would retry it on
	 * its own every few seconds, for good). Either way it is closed here and
	 * reopened after a wait that doubles with each failure in a row, up to
	 * the ceiling. The review is read again over REST on a refusal, which
	 * also finds out when it is gone, and on a second failure in a row; a
	 * single drop is only reconnected, since the new connection's snapshot
	 * brings the page up to date.
	 */
	private failed(source: EventSource): void {
		if (this.closed || source !== this.source) return;

		const refused = source.readyState === EventSource.CLOSED;
		const wait = Math.min(RETRY_MS * 2 ** this.retries, RETRY_MAX_MS);

		this.report('reconnecting');
		this.disconnect();

		if (refused || this.retries > 0) this.handlers.onStale();

		this.countFailures(this.retries + 1);

		this.retryTimer = setTimeout(() => {
			if (!this.closed) this.connect();
		}, wait);
	}

	/**
	 * A late heartbeat shows as reconnecting at once; a second missed one
	 * reopens the stream. A stream that failed waits out its retry instead,
	 * so its wait keeps doubling up to the ceiling.
	 */
	private watch(): void {
		const quiet = Date.now() - this.lastAt;

		if (this.closed || this.retryTimer || quiet < LATE_MS) return;
		if (quiet < SILENCE_MS) return this.report('reconnecting');

		this.handlers.onStale();
		this.connect();
	}
}
