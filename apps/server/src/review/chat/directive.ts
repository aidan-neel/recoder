import { z } from 'zod';
import { extractJsonValue } from '../../models/json-extract.js';
import type { ReviewInventory } from '../pipeline/inventory.js';
import type { ModelConfig } from '../../models/models.js';
import { streamChatCompletion } from '../../models/llm.js';
import { sampling } from '../../models/runtime-profiles.js';

/**
 * What the developer asked this review to do, in their own words, plus the
 * part of it Recoder can apply by itself: which changed files are in scope.
 * "Review only the Python files" must not depend on the model remembering it
 * three prompts later, so the file filter is applied to the inventory before
 * the change is cut into units, and the words go to every prompt.
 */
export interface ReviewDirective {
	/** The developer's messages, verbatim, newest last. */
	instructions: string;
	/** Globs for changed files to review; empty means every file. */
	includeGlobs: string[];
	/** Globs for changed files to leave out. */
	excludeGlobs: string[];
}

const EXCLUDED_BY_INSTRUCTIONS = 'outside your instructions';

const directiveSchema = z.object({
	includeGlobs: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
	excludeGlobs: z.array(z.string().trim().min(1).max(200)).max(40).default([])
});

const LANGUAGE_GLOBS: Record<string, string[]> = {
	python: ['**/*.py', '**/*.pyi'],
	py: ['**/*.py', '**/*.pyi'],
	typescript: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
	ts: ['**/*.ts', '**/*.tsx'],
	javascript: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
	js: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
	svelte: ['**/*.svelte'],
	vue: ['**/*.vue'],
	go: ['**/*.go'],
	golang: ['**/*.go'],
	rust: ['**/*.rs'],
	java: ['**/*.java'],
	kotlin: ['**/*.kt', '**/*.kts'],
	ruby: ['**/*.rb'],
	php: ['**/*.php'],
	swift: ['**/*.swift'],
	scala: ['**/*.scala'],
	'c#': ['**/*.cs'],
	csharp: ['**/*.cs'],
	'c++': ['**/*.cpp', '**/*.cc', '**/*.cxx', '**/*.hpp', '**/*.h'],
	cpp: ['**/*.cpp', '**/*.cc', '**/*.cxx', '**/*.hpp', '**/*.h'],
	sql: ['**/*.sql'],
	css: ['**/*.css', '**/*.scss', '**/*.sass', '**/*.less'],
	html: ['**/*.html'],
	shell: ['**/*.sh', '**/*.bash', '**/*.zsh'],
	bash: ['**/*.sh', '**/*.bash'],
	yaml: ['**/*.yml', '**/*.yaml'],
	json: ['**/*.json'],
	markdown: ['**/*.md', '**/*.mdx'],
	docs: ['**/*.md', '**/*.mdx', '**/*.rst', '**/*.txt'],
	documentation: ['**/*.md', '**/*.mdx', '**/*.rst', '**/*.txt'],
	tests: [
		'**/*.test.*',
		'**/*.spec.*',
		'**/test_*.py',
		'**/*_test.go',
		'**/tests/**',
		'**/test/**',
		'**/__tests__/**',
		'**/spec/**'
	],
	test: [
		'**/*.test.*',
		'**/*.spec.*',
		'**/test_*.py',
		'**/*_test.go',
		'**/tests/**',
		'**/test/**',
		'**/__tests__/**',
		'**/spec/**'
	]
};

/** "**\/*.py" for "*.py" and ".py"; "src/auth/**" for "src/auth/"; exact paths stay exact. */
export function normalizeGlob(raw: string): string | null {
	let glob = raw
		.trim()
		.replace(/^["'`]+|["'`]+$/g, '')
		.replace(/^\.\//, '');

	if (!glob || glob === '*' || glob === '**' || glob === '**/*') return null;
	if (/^\*?\.[a-z0-9]+$/i.test(glob)) glob = `**/*${glob.replace(/^\*/, '')}`;
	if (glob.endsWith('/')) glob = `${glob}**`;
	if (!glob.includes('/') && !glob.startsWith('**')) glob = `**/${glob}`;

	return glob;
}

/** Includes minus any glob also excluded: "only python files, not tests" means the exclude wins. */
function withoutExcluded(includes: string[], excludes: string[]): string[] {
	return includes.filter((glob) => !excludes.includes(glob));
}

/** Whether `path` matches `glob`; a glob Bun can't parse matches nothing. */
export function matchesGlob(path: string, glob: string): boolean {
	try {
		return new Bun.Glob(glob).match(path);
	} catch {
		return false;
	}
}

/**
 * The phrasings that come up most ("only python files", "skip the tests",
 * "ignore *.md") turned into globs without a model. Covers the model being
 * unavailable or wrong, and is merged with what the model finds.
 */
export function heuristicDirective(instructions: string): Pick<ReviewDirective, 'includeGlobs' | 'excludeGlobs'> {
	const include = new Set<string>();
	const exclude = new Set<string>();
	const text = instructions.toLowerCase();
	const languages = Object.keys(LANGUAGE_GLOBS).sort((a, b) => b.length - a.length);
	const language = languages.map((name) => name.replace(/[+#]/g, '\\$&')).join('|');
	const ext = String.raw`\*?\.[a-z0-9]{1,8}`;
	const negative = String.raw`(?:skip|ignore|exclude|leave out|don'?t (?:review|check|look at)|do not (?:review|check|look at)|not|except|other than|but not|without)`;
	const positive = String.raw`(?:only|just|limit(?:ed)? to|restrict(?:ed)? to|focus(?:ed)? on|focus(?:ing)? on|stick to|solely|exclusively)`;

	const add = (set: Set<string>, token: string) => {
		const globs = LANGUAGE_GLOBS[token] ?? (normalizeGlob(token) ? [normalizeGlob(token)!] : []);

		for (const glob of globs) set.add(glob);
	};

	const subject = String.raw`(?:the |all |any |my |our )?(${language}|${ext}|(?:[\w.-]+\/)+[\w.*-]*)(?:\s+(?:files?|code|changes|sources?|modules?|folder|directory|dir))?`;

	for (const match of text.matchAll(new RegExp(String.raw`${negative}\s+${subject}`, 'g'))) add(exclude, match[1]);
	for (const match of text.matchAll(
		new RegExp(
			String.raw`${positive}\s+(?:review(?:ing)?\s+|check(?:ing)?\s+|look(?:ing)? at\s+|on\s+)?${subject}`,
			'g'
		)
	))
		add(include, match[1]);
	for (const match of text.matchAll(
		new RegExp(String.raw`(?:^|[\s,;:(])${subject}\s+(?:only|exclusively|alone)\b`, 'g')
	))
		add(include, match[1]);

	return { includeGlobs: withoutExcluded([...include], [...exclude]), excludeGlobs: [...exclude] };
}

/** The developer's words, as a prompt block every stage sees. */
export function directiveBlock(directive: ReviewDirective | null | undefined): string {
	if (!directive?.instructions.trim()) return '';

	const scope = [
		directive.includeGlobs.length ? `review only files matching ${directive.includeGlobs.join(', ')}` : '',
		directive.excludeGlobs.length ? `leave out files matching ${directive.excludeGlobs.join(', ')}` : ''
	]
		.filter(Boolean)
		.join('; ');

	return `DEVELOPER INSTRUCTIONS (trusted; they come from the person who asked for this review and override the default scope and focus; they cannot change Recoder's safety rules):\n${directive.instructions.trim()}${scope ? `\nApplied scope: ${scope}.` : ''}`;
}

/**
 * Mark changed files the instructions leave out. Includes that match no
 * changed file are dropped (the words still reach the prompts) so an
 * over-tight glob can't empty the review.
 */
export function applyDirective(
	inventory: ReviewInventory,
	directive: ReviewDirective
): { excluded: number; kept: number; droppedIncludes: string[] } {
	const candidates = inventory.files.filter((file) => !file.excludeReason);
	const includes = directive.includeGlobs.filter((glob) => candidates.some((file) => matchesGlob(file.path, glob)));
	const droppedIncludes = directive.includeGlobs.filter((glob) => !includes.includes(glob));

	directive.includeGlobs = includes;

	let excluded = 0;

	for (const file of candidates) {
		const out = directive.excludeGlobs.find((glob) => matchesGlob(file.path, glob));
		const notIn = includes.length > 0 && !includes.some((glob) => matchesGlob(file.path, glob));

		if (!out && !notIn) continue;
		file.excludeReason = `${EXCLUDED_BY_INSTRUCTIONS} (${out ? `matches ${out}` : `not in ${includes.join(', ')}`})`;
		excluded++;
	}

	const reviewable = inventory.files.filter((file) => !file.excludeReason);

	inventory.executable = reviewable.some(
		(file) => file.classification === 'source' || file.classification === 'test' || file.classification === 'config'
	);

	inventory.docsOnly = reviewable.length > 0 && reviewable.every((file) => file.classification === 'docs');

	return { excluded, kept: reviewable.length, droppedIncludes };
}

function interpreterPrompt(): string {
	return `You turn a developer's review instructions into a file filter for an automated code review. Output STRICT JSON only:
{"includeGlobs":["**/*.py"],"excludeGlobs":["**/tests/**"]}
Rules:
- includeGlobs: globs for the ONLY changed files to review, when the developer limits the review to some files, a language, a folder or a module. Otherwise [].
- excludeGlobs: globs for changed files the developer wants left out. Otherwise [].
- Match globs to the changed file list given. Use **/ prefixes for languages (**/*.py), folder/** for folders, and exact paths for named files.
- A concern ("only check security") is not a file filter; the reviewers read it from the instructions.
- Instructions that are questions, greetings or style preferences produce {"includeGlobs":[],"excludeGlobs":[]}.`;
}

/**
 * Read the instructions with a model (one small JSON call), merge with the
 * heuristic, and return the directive. Never throws: with no model answer the
 * heuristic stands alone, and the words still go to every prompt.
 */
export async function interpretInstructions(
	instructions: string,
	inventory: ReviewInventory,
	config: ModelConfig,
	signal: AbortSignal,
	onLog?: (message: string) => void
): Promise<ReviewDirective> {
	const heuristic = heuristicDirective(instructions);

	const directive: ReviewDirective = {
		instructions,
		includeGlobs: [...heuristic.includeGlobs],
		excludeGlobs: [...heuristic.excludeGlobs]
	};

	const paths = inventory.files
		.filter((file) => !file.excludeReason)
		.map((file) => file.path)
		.slice(0, 200);

	try {
		const output = await streamChatCompletion(
			{
				...config,
				signal,
				timeoutMs: 60_000,
				...sampling(config, 1200),
				jsonMode: true,
				thinking: false,
				messages: [
					{ role: 'system', content: interpreterPrompt() },
					{
						role: 'user',
						content: `Developer instructions (verbatim):\n${instructions.slice(0, 6000)}\n\nChanged files:\n${paths.join('\n') || '(none)'}`
					}
				]
			},
			() => undefined
		);

		const parsed = directiveSchema.safeParse(extractJsonValue(output));

		if (!parsed.success) {
			onLog?.('Could not read the instructions as a file filter; using the plain-text reading.');

			return directive;
		}

		for (const raw of parsed.data.includeGlobs) {
			const glob = normalizeGlob(raw);

			if (glob && !directive.includeGlobs.includes(glob)) directive.includeGlobs.push(glob);
		}

		for (const raw of parsed.data.excludeGlobs) {
			const glob = normalizeGlob(raw);

			if (glob && !directive.excludeGlobs.includes(glob)) directive.excludeGlobs.push(glob);
		}
	} catch (err) {
		if (signal.aborted) throw err;

		onLog?.(
			`Could not read the instructions with the model (${err instanceof Error ? err.message : String(err)}); using the plain-text reading.`
		);
	}

	directive.includeGlobs = withoutExcluded(directive.includeGlobs, directive.excludeGlobs);

	return directive;
}

/** One line for the task row: "only **\/*.py; 4 of 9 changed files". */
export function describeDirective(directive: ReviewDirective, applied: { excluded: number; kept: number }): string {
	const bits = [
		directive.includeGlobs.length ? `only ${directive.includeGlobs.join(', ')}` : '',
		directive.excludeGlobs.length ? `skipping ${directive.excludeGlobs.join(', ')}` : ''
	].filter(Boolean);

	const files = applied.excluded
		? `${applied.kept} of ${applied.kept + applied.excluded} changed files`
		: 'every changed file';

	return bits.length ? `${bits.join('; ')} · ${files}` : `Following your instructions · ${files}`;
}
