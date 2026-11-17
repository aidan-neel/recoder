import { isSkillName } from '@recoder/shared';

/** A skill's description is cut to this many characters, so a catalog of skills stays short. */
const MAX_DESCRIPTION_CHARS = 300;

const FENCE = /^---[ \t]*$/;
const FIELD = /^([A-Za-z][\w-]*):[ \t]*(.*)$/;
const BLOCK_SCALAR = /^[>|][+-]?$/;

/** What a skill's `SKILL.md` says about itself. */
export interface SkillIdentity {
	name: string;
	description: string;
}

/**
 * The name and description in a `SKILL.md`'s frontmatter, or the folder name and no description when it has none.
 * Null when neither the frontmatter's name nor the folder's can name a skill.
 */
export function skillIdentity(text: string, folder: string): SkillIdentity | null {
	const fields = frontmatterFields(text);
	const declared = fields.get('name') ?? '';
	const name = isSkillName(declared) ? declared : folder;

	if (!isSkillName(name)) return null;

	return { name, description: (fields.get('description') ?? '').slice(0, MAX_DESCRIPTION_CHARS) };
}

/**
 * The top-level `key: value` pairs of a leading `---` block. It reads plain, quoted and folded (`>`, `|`) values,
 * which is what skill files use; a file with no closed block has no fields.
 */
function frontmatterFields(text: string): Map<string, string> {
	const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
	const fields = new Map<string, string>();

	if (!FENCE.test(lines[0] ?? '')) return fields;

	const end = lines.findIndex((line, index) => index > 0 && FENCE.test(line));

	if (end < 0) return fields;

	const block = lines.slice(1, end);

	block.forEach((line, index) => {
		const match = FIELD.exec(line);

		if (!match) return;

		const raw = match[2].trim();

		fields.set(match[1], BLOCK_SCALAR.test(raw) ? foldedLines(block, index + 1) : plainValue(raw));
	});

	return fields;
}

/** The indented lines after a `>` or `|` key, joined on one line. */
function foldedLines(block: string[], from: number): string {
	const folded: string[] = [];

	for (const line of block.slice(from)) {
		if (line.trim() !== '' && !/^\s/.test(line)) break;
		if (line.trim() !== '') folded.push(line.trim());
	}

	return folded.join(' ');
}

/** A value without its quotes, or without a trailing ` # comment` when it has none. */
function plainValue(raw: string): string {
	const quote = raw[0];

	if ((quote === '"' || quote === "'") && raw.length >= 2 && raw.endsWith(quote)) {
		const inner = raw.slice(1, -1);

		return quote === '"' ? inner.replace(/\\(["\\])/g, '$1') : inner.replaceAll("''", "'");
	}

	return raw.replace(/\s+#.*$/, '');
}
