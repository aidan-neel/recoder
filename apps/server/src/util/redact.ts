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

/**
 * An HTTP header that carries a credential (`Authorization`, `Proxy-Authorization`, `X-Api-Key`, `Api-Key`) as git
 * or a CLI prints it, its colon literal or encoded, to the end of its line.
 */
const AUTHORIZATION_HEADER = /\b((?:proxy-)?authorization|(?:x-)?api-key)(?:\s|%20)*(?::|%3A).*$/gim;

/**
 * An authorization field quoted as JSON (`"Authorization":"Basic …"`): the
 * quote before the colon keeps the header pattern from matching, so the
 * quoted value is taken to its closing quote.
 */
const QUOTED_AUTHORIZATION = /\b((?:proxy-)?authorization)"\s*:\s*"[^"\n]*"/gi;

/** A query or form parameter that carries a secret (`private_token=`, `access_token%3D`, `password=`, `api_key=`). */
const SECRET_PARAMETER = /\b([a-z_-]*(?:token|password|secret|api[_-]?key)[a-z_-]*)(?:=|%3D)[^&\s'"#]+/gi;

/**
 * A secret quoted as a JSON field with a text value (`"apiKey":"…"`, `"password":"…"`, `"access_token":"…"`), taken
 * to its closing quote. A number, such as a token count, is not a text value and stays.
 */
const QUOTED_SECRET_FIELD = /"([a-z_-]*(?:token|password|secret|api[_-]?key)[a-z_-]*)"\s*:\s*"[^"\n]*"/gi;

/** The shapes GitHub and GitLab give their tokens, wherever one appears. */
const TOKEN_SHAPES = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,})/g;

/** API keys as providers shape them (`sk-…`, `sk-ant-…`, `sk-or-v1-…`) and bearer tokens quoted inside a body. */
const KEY_SHAPES = /\b(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,})/g;

/**
 * The path token of a tool slot Recoder leases to an agent CLI (`http://127.0.0.1:<port>/mcp/<token>`, see
 * `agents/tools/mcp-host.ts`), its separators literal or percent-encoded. A CLI that cannot reach the slot may print
 * the URL, and the token opens the slot until the run closes.
 */
const TOOL_SLOT_TOKEN = /(127\.0\.0\.1(?::|%3A)\d+(?:\/|%2F)mcp(?:\/|%2F))[A-Za-z0-9_-]+/gi;

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
	const lines = redacted(text, secrets).trim().split('\n');

	return lines.slice(-TAIL_LINES).join('\n').slice(-TAIL_CHARS);
}

/**
 * Text from git, a forge or a CLI with every credential it may quote
 * replaced: the `secrets` the run was given, in any percent-encoding, user
 * info in URLs, credential headers, secret parameters and JSON fields, the
 * path token of a leased tool slot, and anything shaped like a forge token or
 * a provider key. The known secrets go first, before a pattern can split one.
 */
export function redacted(text: string, secrets: string[]): string {
	const withoutKnown = secrets
		.filter(Boolean)
		.reduce((redacted, secret) => redacted.replace(quotedSecretPattern(secret), REDACTED), text);

	return withoutKnown
		.replace(QUOTED_URL_CREDENTIALS, `$1${REDACTED}$2`)
		.replace(AUTHORIZATION_HEADER, `$1: ${REDACTED}`)
		.replace(QUOTED_AUTHORIZATION, `$1":"${REDACTED}"`)
		.replace(SECRET_PARAMETER, `$1=${REDACTED}`)
		.replace(QUOTED_SECRET_FIELD, `"$1":"${REDACTED}"`)
		.replace(TOOL_SLOT_TOKEN, `$1${REDACTED}`)
		.replace(TOKEN_SHAPES, REDACTED)
		.replace(KEY_SHAPES, REDACTED);
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
