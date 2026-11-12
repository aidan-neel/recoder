/** Server messages that read as code, said the way the app speaks. A map, so no message can match an object's own members. */
const KNOWN = new Map([
	['review is not running', 'The review isn’t running.'],
	['review not found', 'This review no longer exists.'],
	['repo not found', 'Its repository is no longer tracked.']
]);

/** A forge CLI that could not use its token: the server names every such `gh` or `glab` failure this way. */
const FORGE_AUTH = /\b(gh|glab) not authenticated\b/i;

/** GitHub's own words for a token it refused. No other service the review calls answers this way. */
const BAD_CREDENTIALS = /\bbad credentials\b/i;

/**
 * After a forge CLI's name, a token the forge refused outright, as opposed to
 * one that was never set. A bare HTTP 401 means the forge only there, since
 * any service the review calls can answer one.
 */
const REJECTED = new RegExp(`${BAD_CREDENTIALS.source}|\\bHTTP 401\\b`, 'i');

/** The forge's limit on the size of a pull request's diff, with the file count when the forge gives one. */
const TOO_LARGE = /maximum number of files(?: \((\d+)\))?|\btoo_large\b/i;

/**
 * What a forge failure comes from, when it is one a person can act on: the
 * forge's token (`auth`), named by the server's forge CLI prefix or by
 * GitHub's own answer, or a diff over the forge's size limit (`too-large`),
 * which fails the same way however often it is tried.
 */
export function forgeCause(message: string): 'auth' | 'too-large' | null {
	if (TOO_LARGE.test(message)) return 'too-large';

	return FORGE_AUTH.test(message) || BAD_CREDENTIALS.test(message) ? 'auth' : null;
}

/** The forge a CLI's name stands for. */
function forgeOf(cli: string): string {
	return cli.toLowerCase() === 'glab' ? 'GitLab' : 'GitHub';
}

/** A forge CLI's token failure in plain words: a refused token, or none set. */
function forgeAuth(match: RegExpMatchArray): string {
	const forge = forgeOf(match[1]);

	if (REJECTED.test(match.input?.slice(match.index) ?? '')) {
		return `${forge} rejected the token. Update it in Settings → Connections.`;
	}

	return `${forge} isn’t signed in. Add a token in Settings → Connections.`;
}

/** The forge's diff size limit in plain words, with the file count when the forge gave one. */
function tooLarge(match: RegExpMatchArray | null): string {
	return match?.[1]
		? `GitHub won’t send a diff of more than ${match[1]} files.`
		: 'The diff is too large for the forge to send.';
}

/**
 * A diff over the forge's limit in plain words, never the tool's own text:
 * the file count when GitHub's sentence gives one, else a plain sentence.
 */
export function tooLargeText(message: string): string {
	return tooLarge(message.match(TOO_LARGE));
}

/**
 * Raw forge and CLI failures the server passes through, each said in plain
 * words. The first whose pattern matches the message wins; an empty answer
 * means the message holds nothing a person can use.
 */
const REWORDED: [RegExp, (match: RegExpMatchArray) => string][] = [
	[FORGE_AUTH, forgeAuth],
	[BAD_CREDENTIALS, () => 'The forge rejected the token. Update it in Settings → Connections.'],
	[TOO_LARGE, tooLarge],
	[/in JSON at position|end of JSON input|JSON Parse error|is not valid JSON/i, () => ''],
	[/^\s*\d{3}(?: [\w ]*)?\s*$/, () => '']
];

/**
 * CLI and forge noise that never helps a person: stream tags, links in
 * parentheses, status prefixes, sign-in commands, the forge's advice, and
 * error codes on a line of their own.
 */
const NOISE: RegExp[] = [
	/\[(stderr|stdout)\]/gi,
	/\s*\(https?:\/\/[^)\s]*\)/g,
	/\bHTTP \d{3}:\s*/g,
	/try authenticating with:.*$/gim,
	/consider using [^.]* instead\./gi,
	/^\s*\w+\.\w+ [a-z]+(?:_[a-z]+)+\s*$/gm
];

/**
 * A bare HTTP status phrase, such as the server's own `internal server
 * error`: it says nothing a person can use, and next to the app's own
 * sentence about the server it would say "server" twice.
 */
const STATUS_PHRASE =
	/^(?:internal server error|server error|bad gateway|service unavailable|gateway time-?out|not found)\.?$/i;

/** Past this length a message is cut at its last whole sentence, or its last word. */
const MAX_CHARS = 240;

/**
 * The text cut to {@link MAX_CHARS}, at a sentence end when one is near
 * enough, else at its last word. A text with no space is cut one short of the
 * limit, so the ellipsis still fits.
 */
function shorten(text: string): string {
	if (text.length <= MAX_CHARS) return text;

	const head = text.slice(0, MAX_CHARS);
	const sentence = head.search(/[.!?…](?=[^.!?…]*$)/);

	if (sentence > MAX_CHARS / 2) return head.slice(0, sentence + 1);

	const space = head.lastIndexOf(' ');
	const cut = space > 0 ? head.slice(0, space) : head.slice(0, MAX_CHARS - 1);

	return `${cut.replace(/[\s,;:]+$/, '')}…`;
}

/** The message with CLI noise taken out and its lines run together into one. */
function cleaned(message: string): string {
	const stripped = NOISE.reduce((text, pattern) => text.replace(pattern, ''), message);

	return stripped
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)
		.join(' ')
		.replace(/\s+/g, ' ')
		.replace(/^sorry,\s*/i, '')
		.replace(/\s*:\s*$/, '');
}

/**
 * A server error as plain copy for a toast or notice: raw forge and CLI
 * failures are reworded, noise is taken out (stream tags, links, sign-in
 * commands, error codes), known messages are reworded, a long one is cut
 * short, and the rest start with a capital and end with a period. An empty
 * answer means the message held nothing a person can use, such as a bare
 * status phrase.
 */
export function plainError(message: string): string {
	for (const [pattern, say] of REWORDED) {
		const match = message.match(pattern);

		if (match) return say(match);
	}

	const text = shorten(cleaned(message));
	const known = KNOWN.get(text.toLowerCase());

	if (known) return known;
	if (!text || STATUS_PHRASE.test(text)) return '';

	const sentence = text[0].toUpperCase() + text.slice(1);

	return /[.!?…]$/.test(sentence) ? sentence : `${sentence}.`;
}
