/**
 * The user name and password of a URL (`https://user:token@host`), up to the
 * last `@` before the path, so a password holding an `@` goes too. Only a
 * literal `@` ends user info in a URL git is given; `%40` is part of it.
 */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s]*@/gi;

/**
 * User info of a URL quoted in a text, its separators literal or
 * percent-encoded (`https%3A%2F%2Fuser%3Atoken%40host`). It may take more
 * than the user info when the slashes are encoded; that only hides more.
 */
const QUOTED_URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*(?::|%3A)(?:\/|%2F){2})[^/\s]*(@|%40)/gi;

/** An HTTP authorization header as git prints it with tracing on, its colon literal or encoded, to the end of its line. */
const AUTHORIZATION_HEADER = /\b((?:proxy-)?authorization)(?:\s|%20)*(?::|%3A).*$/gim;

/** A query or form parameter that carries a secret (`private_token=`, `access_token%3D`, `password=`). */
const SECRET_PARAMETER = /\b([a-z_-]*(?:token|password|secret)[a-z_-]*)(?:=|%3D)[^&\s'"#]+/gi;

/** The shapes GitHub and GitLab give their tokens, wherever one appears. */
const TOKEN_SHAPES = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,})/g;

/** Characters that mean something in a pattern, escaped to match themselves. */
const PATTERN_SYNTAX = /[\\^$.*+?()[\]{}|/-]/g;

/** How much of a redacted text `redactedTail` keeps: its last lines, capped in length. */
const TAIL_LINES = 5;

const TAIL_CHARS = 600;

const REDACTED = '[redacted]';

/**
 * Drops the user name and password from a URL, so a token someone put in a
 * remote URL never reaches a message, a log or a clone command.
 */
export function withoutCredentials(url: string): string {
	return url.replace(URL_CREDENTIALS, '$1');
}

/**
 * The last lines of `text`, at most `TAIL_CHARS` long, with every credential
 * removed first: redacting the whole text before the cut means a credential
 * the cut would split is never left half shown.
 */
export function redactedTail(text: string, secrets: string[]): string {
	const lines = redactCredentials(text, secrets).trim().split('\n');

	return lines.slice(-TAIL_LINES).join('\n').slice(-TAIL_CHARS);
}

/**
 * Text from git or a forge with every credential it may quote replaced: the
 * `secrets` the run was given, in any percent-encoding, user info in URLs,
 * authorization headers, secret parameters and anything shaped like a forge
 * token. The known secrets go first, before a pattern can split one.
 */
function redactCredentials(text: string, secrets: string[]): string {
	const withoutKnown = secrets
		.filter(Boolean)
		.reduce((redacted, secret) => redacted.replace(quotedSecretPattern(secret), REDACTED), text);

	return withoutKnown
		.replace(QUOTED_URL_CREDENTIALS, `$1${REDACTED}$2`)
		.replace(AUTHORIZATION_HEADER, `$1: ${REDACTED}`)
		.replace(SECRET_PARAMETER, `$1=${REDACTED}`)
		.replace(TOKEN_SHAPES, REDACTED);
}

/**
 * `secret` as a text may quote it: each character literal or percent-encoded
 * (`%XX` for each of its UTF-8 bytes, either hex case), in any mix, which
 * covers `encodeURIComponent` and fully encoded forms alike.
 */
function quotedSecretPattern(secret: string): RegExp {
	return new RegExp([...secret].map(quotedCharacter).join(''), 'g');
}

function quotedCharacter(character: string): string {
	const encoded = [...new TextEncoder().encode(character)].map(percentEncodedByte).join('');

	return `(?:${character.replace(PATTERN_SYNTAX, '\\$&')}|${encoded})`;
}

function percentEncodedByte(byte: number): string {
	const hex = byte.toString(16).padStart(2, '0');
	const anyCase = (digit: string) => `[${digit}${digit.toUpperCase()}]`;

	return `%${anyCase(hex.charAt(0))}${anyCase(hex.charAt(1))}`;
}
