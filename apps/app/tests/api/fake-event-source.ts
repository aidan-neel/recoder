/** Every fake stream made, newest last, so a test can drive the one the code opened. Tests empty it between runs. */
export const sources: FakeEventSource[] = [];

/** Stands in for the browser's EventSource. It stays connecting until a test opens it or gives up on it. */
export class FakeEventSource {
	static CLOSED = 2;

	readyState = 0;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onerror: (() => void) | null = null;

	constructor() {
		sources.push(this);
	}

	close(): void {
		this.readyState = FakeEventSource.CLOSED;
	}

	/** The server accepts the stream. */
	accept(): void {
		this.readyState = 1;
		this.onopen?.();
	}

	/** The browser gives up on the stream for good. */
	giveUp(): void {
		this.readyState = FakeEventSource.CLOSED;
		this.onerror?.();
	}
}
