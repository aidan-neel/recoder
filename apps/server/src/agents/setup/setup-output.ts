import { redacted } from '../../util/redact';

/** How many of a job's last lines are kept for the status response. */
const OUTPUT_LINES = 200;

/**
 * ANSI escape sequences a TUI prints: CSI colors and movement, OSC titles and hyperlinks up to BEL or ST, and the
 * single-character and charset forms.
 */
const ANSI_ESCAPE =
	// eslint-disable-next-line no-control-regex -- it matches the control characters that make up terminal escapes
	/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][0-2A-Z]|#?[0-9A-Za-z]|[=>~])/g;

/** An https URL in a CLI's output; trailing punctuation the terminal may add is not part of it. */
const HTTPS_URL = /https:\/\/[^\s'"<>[\]{}()|\\^`]+/;

/** The visible text of one output line: escapes removed, carriage-return redraws collapsed to their last frame. */
function visible(line: string): string {
	return (
		line
			.replace(ANSI_ESCAPE, '')
			.split('\r')
			.filter((part) => part !== '')
			.pop() ?? ''
	);
}

/**
 * The tail of what a setup job's CLI printed. Lines are stored raw so a secret pasted after they were printed
 * still redacts on read; redaction happens in {@link text}, with the pasted inputs added as secrets.
 */
export class SetupOutput {
	private readonly lines: string[] = [];
	private partial = '';
	private first: string | null = null;
	private readonly secrets: string[] = [];

	/** The bytes pushed so far, counted before escaping and trimming; the runner kills a job that writes too much. */
	bytes = 0;

	/** A chunk of stdout or stderr; carriage-return redraws and escapes are folded into the current line. */
	push(chunk: string): void {
		this.bytes += chunk.length;

		const lines = (this.partial + chunk).split('\n');

		this.partial = lines.pop() ?? '';

		for (const line of lines) {
			const clean = visible(line);

			this.first ??= clean.match(HTTPS_URL)?.[0].replace(/[.,;:!?'"]+$/, '') ?? null;
			this.lines.push(clean);
		}

		if (this.lines.length > OUTPUT_LINES) this.lines.splice(0, this.lines.length - OUTPUT_LINES);
	}

	/** Text the user pasted into the CLI's stdin; it may be a token, so it must never appear in the output. */
	addSecret(secret: string): void {
		if (secret) this.secrets.push(secret);
	}

	/** The last {@link OUTPUT_LINES} lines plus the partial line in progress, secrets redacted. */
	text(): string {
		return redacted([...this.lines, visible(this.partial)].join('\n').trimEnd(), this.secrets);
	}

	/**
	 * The first https URL the CLI printed — a sign-in page. It is kept once seen so it survives scrolling out of
	 * the tail, and redacted on read so a URL cannot smuggle a pasted secret back out.
	 */
	url(): string | null {
		const found =
			this.first ??
			visible(this.partial)
				.match(HTTPS_URL)?.[0]
				?.replace(/[.,;:!?'"]+$/, '');

		return found ? redacted(found, this.secrets) : null;
	}
}
