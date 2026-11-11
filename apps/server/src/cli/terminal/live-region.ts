import { format } from 'node:util';
import { claimStderr } from '../output/streams.js';
import { truncate } from './text.js';

const ESCAPE = '\u001b[';

const HIDE_CURSOR = `${ESCAPE}?25l`;

const SHOW_CURSOR = `${ESCAPE}?25h`;

/** Erases from the cursor to the end of the screen. */
const CLEAR_BELOW = `${ESCAPE}J`;

/**
 * Asks the terminal to show everything between the two at once, so a redraw never shows half a frame. A terminal that
 * does not know the mode ignores it.
 */
const BEGIN_FRAME = `${ESCAPE}?2026h`;

const END_FRAME = `${ESCAPE}?2026l`;

const CONSOLE_METHODS = ['log', 'info', 'debug', 'warn', 'error'] as const;

/** The terminal a region draws on: `process.stderr` fits. */
export interface RegionStream {
	write(text: string): unknown;
	columns?: number;
	rows?: number;
}

/**
 * A block of lines at the bottom of a terminal that is redrawn in place. While it is open, anything else written to
 * standard error (`writeStderrLine`, and the console, which the pipeline uses for warnings) is printed above it:
 * a line written straight through would land inside the block and be overwritten by the next frame.
 */
export class LiveRegion {
	private height = 0;

	private lines: string[] = [];

	private isOpen = true;

	private readonly release: () => void;

	constructor(
		private readonly stream: RegionStream,
		private readonly ellipsis: string
	) {
		const restoreConsole = printConsoleThrough((line) => this.print(line));
		const releaseStderr = claimStderr((line) => this.print(line));

		this.release = () => {
			restoreConsole();
			releaseStderr();
			process.off('exit', this.showCursor);
		};

		process.on('exit', this.showCursor);
		this.stream.write(HIDE_CURSOR);
	}

	/** Replaces the block with these lines. A line wider than the terminal is cut, since a wrapped line breaks the redraw. */
	render(lines: readonly string[]): void {
		if (!this.isOpen) return;

		this.lines = this.fit(lines);
		this.stream.write(`${BEGIN_FRAME}${this.erase()}${this.lines.map((line) => `${line}\n`).join('')}${END_FRAME}`);
		this.height = this.lines.length;
	}

	/** Writes text above the block, which stays where it is. */
	print(text: string): void {
		if (!this.isOpen) {
			this.stream.write(`${text}\n`);

			return;
		}

		const block = this.lines.map((line) => `${line}\n`).join('');

		this.stream.write(`${BEGIN_FRAME}${this.erase()}${text}\n${block}${END_FRAME}`);
	}

	/** Removes the block and gives standard error and the cursor back. Safe to call twice. */
	close(): void {
		if (!this.isOpen) return;

		this.isOpen = false;
		this.stream.write(`${this.erase()}${SHOW_CURSOR}`);
		this.height = 0;
		this.release();
	}

	/** Moves to the block's first line and erases from there down. */
	private erase(): string {
		return this.height === 0 ? `\r${CLEAR_BELOW}` : `${ESCAPE}${this.height}A\r${CLEAR_BELOW}`;
	}

	/** The lines that fit the terminal: each within its width, and no more of them than it has rows. */
	private fit(lines: readonly string[]): string[] {
		const columns = Math.max(1, (this.stream.columns ?? Infinity) - 1);
		const rows = Math.max(1, (this.stream.rows ?? Infinity) - 1);

		return lines.slice(0, rows).map((line) => truncate(line, columns, this.ellipsis));
	}

	/** A process that ends while the block is open, as on a second Ctrl-C, must not leave the cursor hidden. */
	private readonly showCursor = (): void => {
		this.stream.write(SHOW_CURSOR);
	};
}

/** Sends what the console prints through `print` for as long as the region is open; the returned function undoes it. */
function printConsoleThrough(print: (line: string) => void): () => void {
	const originals = CONSOLE_METHODS.map((method) => ({ method, write: console[method] }));

	for (const method of CONSOLE_METHODS) console[method] = (...args: unknown[]) => print(format(...args));

	return () => {
		for (const { method, write } of originals) console[method] = write;
	};
}
