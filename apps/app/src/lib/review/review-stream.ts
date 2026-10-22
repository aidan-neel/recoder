import type { ProgressMessage } from '@recoder/shared';

import { API_BASE, seg } from '../api/http';

/** How the live connection stands, for the small status line beside the progress. */
export type Connection = 'connecting' | 'live' | 'reconnecting' | 'closed';

interface StreamHandlers {
	onMessage: (message: ProgressMessage) => void;
	onConnection: (connection: Connection) => void;
	/**
	 * Nothing arrived for a while (heartbeats come every 5s), or the browser
	 * gave up on the stream: the caller re-reads the review over REST, which
	 * also finds out when the review is gone.
	 */
	onStale: () => void;
}

/** A connection that has not opened by now shows as reconnecting. */
const READY_MS = 1500;

/** The watchdog checks this often... */
const WATCH_MS = 5000;

/** ...and reconnects after this long without a message. */
const SILENCE_MS = 20000;

/** Wait before reopening a stream the browser gave up on; each failure in a row doubles it, up to the ceiling. */
const RETRY_MS = 2000;

const RETRY_MAX_MS = 30000;

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
	private retries = 0;
	private closed = false;
	private connection: Connection = 'closed';

	constructor(
		private readonly id: string,
		private readonly handlers: StreamHandlers
	) {}

	open(): void {
		this.closed = false;
		this.connect();
		this.watchdog = setInterval(() => this.watch(), WATCH_MS);
	}

	close(): void {
		this.closed = true;
		this.disconnect();

		if (this.watchdog) clearInterval(this.watchdog);
		if (this.retryTimer) clearTimeout(this.retryTimer);

		this.report('closed');
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
		this.lastAt = Date.now();
		this.report(this.connection === 'closed' ? 'connecting' : 'reconnecting');

		const source = new EventSource(`${API_BASE}/api/reviews/${seg(this.id)}/events`);

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

	private opened(): void {
		if (this.readyTimer) clearTimeout(this.readyTimer);

		this.retries = 0;
		this.report('live');
	}

	private received(data: string): void {
		this.lastAt = Date.now();

		const message = parse(data);

		if (message) this.handlers.onMessage(message);
	}

	/** The browser retries a dropped stream itself; one it closed for good is reopened here. */
	private failed(source: EventSource): void {
		if (this.closed || source !== this.source) return;

		this.report('reconnecting');

		if (source.readyState !== EventSource.CLOSED) return;

		const wait = Math.min(RETRY_MS * 2 ** this.retries, RETRY_MAX_MS);

		this.retries++;
		this.handlers.onStale();

		this.retryTimer = setTimeout(() => {
			if (!this.closed) this.connect();
		}, wait);
	}

	private watch(): void {
		if (this.closed || Date.now() - this.lastAt < SILENCE_MS) return;

		this.handlers.onStale();
		this.connect();
	}
}
