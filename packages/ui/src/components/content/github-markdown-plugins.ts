import type { ExtraProps, Options } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

type HastElement = NonNullable<ExtraProps['node']>;

type HastChild = HastElement['children'][number];

interface HastRoot {
	type: 'root';
	children: HastChild[];
}

type HastParent = HastRoot | HastElement;

/** Global attributes untrusted HTML must never carry: they hijack Tab order or keyboard shortcuts. */
const BLOCKED_GLOBAL_ATTRIBUTES = new Set(['accessKey', 'tabIndex']);

const SAFE_GLOBAL_ATTRIBUTES = (defaultSchema.attributes?.['*'] ?? []).filter(
	(entry) => typeof entry !== 'string' || !BLOCKED_GLOBAL_ATTRIBUTES.has(entry)
);

/**
 * GitHub's HTML allowlist for forge prose (PR descriptions, comments, release notes):
 * strips comments, `<script>` and `<style>` bodies, event handlers, inline styles and unsafe
 * URLs while keeping disclosure blocks, pictures, tables, definition lists and phrasing tags.
 */
const GITHUB_SANITIZE_SCHEMA = {
	...defaultSchema,
	strip: ['script', 'style'],
	tagNames: [...(defaultSchema.tagNames ?? []), 'abbr', 'mark', 'small'],
	attributes: {
		...defaultSchema.attributes,
		'*': SAFE_GLOBAL_ATTRIBUTES
	},
	protocols: {
		...defaultSchema.protocols,
		href: ['http', 'https', 'mailto'],
		src: ['http', 'https']
	}
};

const HEADING_LEVELS: Record<string, string> = {
	h1: '1',
	h2: '2',
	h3: '3',
	h4: '4',
	h5: '5',
	h6: '6'
};

/** Block tags that HTML forbids inside `<h1>`–`<h6>`, such as CodeRabbit's `<h6><details>…</h6>`. */
const BLOCK_TAGS = new Set([
	'blockquote',
	'details',
	'div',
	'dl',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'hr',
	'ol',
	'p',
	'pre',
	'section',
	'table',
	'ul'
]);

const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n|$)/i;

/** Default forge host for `@mention` links when the caller does not name a custom host. */
const DEFAULT_FORGE_ORIGIN = 'https://github.com';

/** Elements whose text must never turn `@handle` into a link (code, existing links, collapsible buttons). */
const SKIP_MENTION_TAGS = new Set(['a', 'code', 'kbd', 'pre', 'samp', 'summary', 'var']);

/**
 * Matches a forge `@mention` preceded by start-of-text or non-identifier punctuation and not
 * followed by a path slash (`@scope/pkg`), domain dot (`@example.com`), or handle continuation.
 */
const MENTION =
	/(^|[^a-zA-Z0-9._%+\-/\\])@([a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,37}[a-zA-Z0-9])?)(?![a-zA-Z0-9_/-]|\.[a-zA-Z0-9])/g;

/** True when `node` holds a block element anywhere inside it. */
function containsBlock(node: HastElement): boolean {
	return node.children.some(
		(child) => child.type === 'element' && (BLOCK_TAGS.has(child.tagName) || containsBlock(child))
	);
}

/** First non-whitespace child of a HAST element, or null when it holds only whitespace. */
function firstContentChild(node: HastElement): { child: HastChild; index: number } | null {
	for (let index = 0; index < node.children.length; index++) {
		const child = node.children[index];

		if (child.type === 'text' && child.value.trim() === '') continue;

		return { child, index };
	}

	return null;
}

/**
 * Marks a GitHub alert blockquote (`> [!NOTE]`, `> [!WARNING]`, …) with `data-alert`
 * and removes the leading marker line from its first paragraph.
 */
function markAlert(blockquote: HastElement): void {
	const first = firstContentChild(blockquote);

	if (!first || first.child.type !== 'element' || first.child.tagName !== 'p') return;

	const paragraph = first.child;
	const lead = paragraph.children[0];

	if (!lead || lead.type !== 'text') return;

	const match = ALERT_MARKER.exec(lead.value);

	if (!match) return;

	blockquote.properties['data-alert'] = match[1].toLowerCase();

	const rest = lead.value.slice(match[0].length);

	if (rest) {
		lead.value = rest;

		return;
	}

	paragraph.children.shift();

	if (paragraph.children[0]?.type === 'element' && paragraph.children[0].tagName === 'br') {
		paragraph.children.shift();
	}

	if (paragraph.children.length === 0) blockquote.children.splice(first.index, 1);
}

/** Splits a text node's `@handle` mentions into links to `${origin}/${handle}`, or returns null when none appear. */
function splitMentionText(value: string, origin: string): HastChild[] | null {
	if (!value.includes('@')) return null;

	const pieces: HastChild[] = [];
	let at = 0;

	for (const match of value.matchAll(MENTION)) {
		const prefix = match[1];
		const handle = match[2];
		const mentionStart = match.index + prefix.length;

		if (mentionStart > at) pieces.push({ type: 'text', value: value.slice(at, mentionStart) });

		pieces.push({
			type: 'element',
			tagName: 'a',
			properties: { href: `${origin}/${handle}`, 'data-mention': '' },
			children: [{ type: 'text', value: `@${handle}` }]
		});

		at = match.index + match[0].length;
	}

	if (pieces.length === 0) return null;
	if (at < value.length) pieces.push({ type: 'text', value: value.slice(at) });

	return pieces;
}

/** Normalizes sanitized GitHub HAST trees: lifts headings around block HTML, marks GFM alerts and links `@mentions`. */
function polishTree(parent: HastParent, origin: string | null, allowMentions: boolean): void {
	for (let index = 0; index < parent.children.length; index++) {
		const child = parent.children[index];

		if (child.type === 'text') {
			if (!allowMentions || !origin) continue;

			const linked = splitMentionText(child.value, origin);

			if (!linked) continue;

			parent.children.splice(index, 1, ...linked);
			index += linked.length - 1;
			continue;
		}

		if (child.type !== 'element') continue;

		const headingLevel = HEADING_LEVELS[child.tagName];

		if (headingLevel && containsBlock(child)) {
			child.tagName = 'div';
			child.properties['data-heading-level'] = headingLevel;
		} else if (child.tagName === 'blockquote') {
			markAlert(child);
		}

		polishTree(child, origin, allowMentions && !SKIP_MENTION_TAGS.has(child.tagName));
	}
}

/** Rehype plugin that polishes sanitized GitHub HAST nodes without adding raw HTML. */
function rehypeGitHubPolish(origin: string | null) {
	return () => (tree: HastRoot) => {
		polishTree(tree, origin, origin !== null);
	};
}

/** Normalizes an origin to `http(s)://host`, or null when disabled or invalid. */
export function normalizeForgeOrigin(origin: string | null | undefined): string | null {
	if (origin === null) return null;

	const raw = origin === undefined ? DEFAULT_FORGE_ORIGIN : origin;
	const safe = safeHttpUrl(raw);

	return safe ? new URL(safe).origin : null;
}

const REHYPE_BY_ORIGIN = new Map<string, NonNullable<Options['rehypePlugins']>>();

/** The rehype pipeline for GitHub/forge Markdown, cached per forge origin for `@mention` links. */
export function githubRehype(origin: string | null): NonNullable<Options['rehypePlugins']> {
	const key = origin ?? '';
	const kept = REHYPE_BY_ORIGIN.get(key);

	if (kept) return kept;

	const plugins: NonNullable<Options['rehypePlugins']> = [
		rehypeRaw,
		[rehypeSanitize, GITHUB_SANITIZE_SCHEMA],
		rehypeGitHubPolish(origin)
	];

	REHYPE_BY_ORIGIN.set(key, plugins);

	return plugins;
}

/** Returns `raw` as a trimmed `http:` or `https:` URL, or null for any other protocol or malformed value. */
export function safeHttpUrl(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;

	const trimmed = raw.trim();

	if (!/^https?:\/\//i.test(trimmed)) return null;

	try {
		const parsed = new URL(trimmed);

		return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? trimmed : null;
	} catch {
		return null;
	}
}

const SRCSET_DESCRIPTOR = /^\d+(?:\.\d+)?[wx]$/i;

/**
 * Validates an HTML `srcset` attribute so every candidate uses `http:` or `https:` and an optional
 * width/density descriptor. Splits only before another `http(s)://` URL so commas in query strings stay whole.
 */
export function safeSrcSet(raw: unknown): { src: string; srcSet?: string } | null {
	const text = Array.isArray(raw) ? raw.map(String).join(', ') : typeof raw === 'string' ? raw : '';
	const trimmed = text.trim();

	if (!trimmed) return null;

	const candidates = trimmed.split(/,\s+(?=https?:\/\/)/i);
	const valid: string[] = [];
	let firstSrc: string | null = null;

	for (const candidate of candidates) {
		const parts = candidate.trim().split(/\s+/);

		if (parts.length === 0 || parts.length > 2) return null;

		const url = safeHttpUrl(parts[0]);

		if (!url) return null;
		if (parts[1] && !SRCSET_DESCRIPTOR.test(parts[1])) return null;

		firstSrc ??= url;
		valid.push(parts[1] ? `${url} ${parts[1]}` : url);
	}

	if (!firstSrc) return null;

	return { src: firstSrc, srcSet: valid.length > 1 ? valid.join(', ') : undefined };
}
