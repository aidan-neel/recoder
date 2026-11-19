import type { Grammar } from './languages';

/** The whitespace a line starts with. */
function indentOf(line: string): string {
	return line.slice(0, line.length - line.trimStart().length);
}

/** The longest start two strings share. */
function sharedStart(left: string, right: string): string {
	let length = 0;

	while (length < left.length && left[length] === right[length]) length += 1;

	return left.slice(0, length);
}

/**
 * The code without the indentation every line shares, so a passage quoted
 * from deep inside a file starts at the block's edge. Blank lines do not
 * count towards what is shared, and tabs and spaces compare as written.
 */
export function dedent(code: string): string {
	const lines = code.split('\n');
	const filled = lines.filter((line) => line.trim() !== '');

	if (filled.length === 0) return code;

	const shared = filled.map(indentOf).reduce(sharedStart);

	if (!shared) return code;

	return lines.map((line) => (line.startsWith(shared) ? line.slice(shared.length) : line.trimStart())).join('\n');
}

/** True when the whole text parses as a JSON object or array. */
function isJson(code: string): boolean {
	if (!/^\s*[{[]/.test(code)) return false;

	try {
		JSON.parse(code);

		return true;
	} catch {
		return false;
	}
}

/** True for a unified diff, or a block whose lines are marked as added and as removed. */
function isDiff(code: string): boolean {
	return /^(?:@@ -\d|diff --git |--- a\/)/m.test(code) || (/^\+(?!\+)/m.test(code) && /^-(?!-)/m.test(code));
}

/**
 * What marks each language, the most telling first. A sign is a construct
 * the others do not share and a sentence does not hold, so prose and logs
 * match none and stay plain: markup must open the block, a command must
 * start a line with a program's name, and SQL in lower case must end a line
 * with a semicolon.
 */
const SIGNS: readonly (readonly [Grammar, RegExp])[] = [
	['bash', /^\s*\$ \S/m],
	['xml', /^\s*<(?:!doctype|\?xml|[a-z][\w-]*(?:\s[^>]*)?\/?>)/i],
	['python', /^\s*(?:def \w+\(.*\).*:|class \w+.*:|from [\w.]+ import \w|elif .+:)\s*$/m],
	['go', /^\s*(?:package \w+\s*$|func (?:\([^)]*\) )?\w+\()/m],
	['rust', /\b(?:fn \w+\s*[(<]|let mut \w|impl(?:<[^>]*>)? \w)|^\s*pub (?:fn|struct|enum|mod) /m],
	['sql', /^\s*(?:SELECT\s.+\sFROM|INSERT INTO|UPDATE \w+ SET|DELETE FROM|CREATE TABLE|ALTER TABLE)\b/m],
	['sql', /^\s*(?:select\s.+\sfrom|insert into|update \w+ set|delete from|create table|alter table)\b.*;\s*$/m],
	[
		'typescript',
		/\b(?:import .+ from ['"]|export (?:default|const|function|class|interface|type)\b|(?:const|let) \w+\s*(?::[^=]+)?=|function \w*\(|interface \w+\s*\{)|\)\s*=>/
	],
	[
		'bash',
		/^\s*(?:(?:npm|npx|bun|bunx|pnpm|yarn|git|curl|docker|kubectl|helm|sudo|mkdir|brew|pip|cargo) [a-z@./-]|cd [\w./~-]+\s*$|export \w+=|make(?: -\S+)*(?: [\w./-]+)?\s*$)/m
	],
	['yaml', /^[a-z_][\w-]*:(?:[ \t]+\S.*)?\n[ \t]+(?:- |[\w-]+:)/m]
];

/**
 * The language of a fenced block that names none, read from its text: a
 * diff, JSON, a shell session, markup, or code with a construct only one of
 * the common languages has. Null when nothing marks it, which leaves the
 * block plain.
 */
export function guessLanguage(code: string): Grammar | null {
	if (isDiff(code)) return 'diff';
	if (isJson(code)) return 'json';

	return SIGNS.find(([, sign]) => sign.test(code))?.[0] ?? null;
}
