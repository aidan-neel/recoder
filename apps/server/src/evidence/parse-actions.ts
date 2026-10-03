import { ACTION_NAMES, type ActionName, type RetrievalAction } from './types.js';

/** Names weaker models use for each action. */
const ACTION_ALIASES: Record<string, ActionName> = {
	listfiles: 'listFiles',
	list_files: 'listFiles',
	list: 'listFiles',
	ls: 'listFiles',
	readfile: 'readFile',
	read_file: 'readFile',
	read: 'readFile',
	open: 'readFile',
	cat: 'readFile',
	view: 'readFile',
	search: 'search',
	grep: 'search',
	find: 'search',
	search_code: 'search',
	searchcode: 'search',
	readdiff: 'readDiff',
	read_diff: 'readDiff',
	diff: 'readDiff',
	getdiff: 'readDiff',
	get_diff: 'readDiff',
	run: 'run',
	bash: 'run',
	shell: 'run',
	sh: 'run',
	exec: 'run',
	execute: 'run',
	run_command: 'run',
	runcommand: 'run',
	terminal: 'run',
	writefile: 'writeFile',
	write_file: 'writeFile',
	write: 'writeFile',
	create_file: 'writeFile',
	createfile: 'writeFile'
};

/** Keys models use for the list of requests. */
const ACTION_LIST_KEYS = [
	'actions',
	'tool_calls',
	'toolCalls',
	'tools',
	'calls',
	'requests',
	'retrieval',
	'retrievals',
	'retrieve'
];

/** Keys that name the action or wrap its arguments, stripped before the arguments are merged in. */
const ENVELOPE_KEYS = [
	'action',
	'name',
	'tool',
	'type',
	'function',
	'arguments',
	'args',
	'input',
	'parameters',
	'params'
];

function actionName(value: unknown): ActionName | null {
	if (typeof value !== 'string') return null;
	if ((ACTION_NAMES as readonly string[]).includes(value)) return value as ActionName;

	return ACTION_ALIASES[value.trim().toLowerCase()] ?? null;
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function toInt(value: unknown): number | undefined {
	const n = typeof value === 'string' ? Number.parseInt(value, 10) : value;

	return typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : undefined;
}

/** Moves the first present alias key onto `target`, unless `target` is already set. */
function pick(out: Record<string, unknown>, target: string, ...keys: string[]): void {
	if (out[target] !== undefined) return;

	for (const key of keys) {
		if (out[key] !== undefined) {
			out[target] = out[key];
			delete out[key];

			return;
		}
	}
}

/** `run` fields: the command may arrive as an argv array and the timeout as a string. */
function canonicalRunFields(out: Record<string, unknown>): void {
	pick(out, 'command', 'cmd', 'script', 'shell', 'bash');
	pick(out, 'timeoutSec', 'timeout', 'timeout_sec', 'timeoutSeconds');

	if (Array.isArray(out.command)) out.command = out.command.filter((part) => typeof part === 'string').join(' ');
	if (out.timeoutSec !== undefined) out.timeoutSec = toInt(out.timeoutSec);
}

/** `writeFile` fields: some models send a file as its list of lines. */
function canonicalWriteFields(out: Record<string, unknown>): void {
	pick(out, 'content', 'contents', 'text', 'body', 'code', 'data');

	if (Array.isArray(out.content) && out.content.every((line) => typeof line === 'string'))
		out.content = out.content.join('\n');
}

/** Splits a `lines: "10-40"` range into `startLine` and `endLine`. */
function splitLineRange(out: Record<string, unknown>): void {
	if (typeof out.lines !== 'string') return;

	const m = /^(\d+)\s*[-:–,]\s*(\d+)$/.exec(out.lines.trim());

	if (m) {
		out.startLine ??= Number(m[1]);
		out.endLine ??= Number(m[2]);
	}

	delete out.lines;
}

/** Maps everyday revision words (`base`, `pr`, `mergebase`…) onto our aliases. */
function canonicalRevision(revision: string): string {
	const lower = revision.toLowerCase();

	if (lower === 'base' || lower === 'old' || lower === 'main') return 'target';
	if (lower === 'new' || lower === 'pr') return 'head';
	if (lower === 'mergebase') return 'mergeBase';

	return revision;
}

/** Field names models reach for instead of ours: `pattern` → `query`, `file` → `path`, `lines: "10-40"` … */
function canonicalFields(args: Record<string, unknown>, action?: string): Record<string, unknown> {
	const out: Record<string, unknown> = { ...args };

	if (action === 'run') canonicalRunFields(out);
	if (action === 'writeFile') canonicalWriteFields(out);

	pick(out, 'query', 'pattern', 'regex', 'text', 'term', 'q', 'keyword', 'symbol');
	pick(out, 'path', 'file', 'filePath', 'file_path', 'filepath', 'filename', 'fileName');
	pick(out, 'prefix', 'dir', 'directory', 'folder', 'scope');
	pick(out, 'startLine', 'start_line', 'start', 'from', 'line', 'offset');
	pick(out, 'endLine', 'end_line', 'end', 'to');
	pick(out, 'hunkIds', 'hunks', 'hunk_ids');
	splitLineRange(out);

	if (out.startLine !== undefined) out.startLine = toInt(out.startLine);
	if (out.endLine !== undefined) out.endLine = toInt(out.endLine);
	if (typeof out.hunkIds === 'string') out.hunkIds = [out.hunkIds];
	if (typeof out.revision === 'string') out.revision = canonicalRevision(out.revision);

	return out;
}

/** `{"type": "readDiff", "args": {…}}`, `{"name": "read_file", "arguments": "{…}"}` and OpenAI-style `function`. */
function namedAction(item: Record<string, unknown>, named: ActionName): RetrievalAction {
	const fn = item.function && typeof item.function === 'object' ? (item.function as Record<string, unknown>) : null;

	const rawArgs = [item.arguments, item.args, item.input, item.parameters, item.params, fn?.arguments].find(
		(value) => value !== undefined
	);

	const args = typeof rawArgs === 'string' ? safeJson(rawArgs) : rawArgs;
	const rest = { ...item };

	for (const key of ENVELOPE_KEYS) delete rest[key];

	return {
		...canonicalFields({ ...rest, ...(args && typeof args === 'object' ? (args as object) : {}) }, named),
		action: named
	} as RetrievalAction;
}

/** `{"readDiff": {…}}`, or `{"run": "ls"}` with the command as a bare string. */
function keyedAction(args: unknown, key: ActionName): RetrievalAction {
	const fields =
		args && typeof args === 'object'
			? (args as Record<string, unknown>)
			: typeof args === 'string' && key === 'run'
				? { command: args }
				: {};

	return { ...canonicalFields(fields, key), action: key } as RetrievalAction;
}

/**
 * Local models phrase the same request many ways. Fold them all into
 * `{"action": "readDiff", …}`; unknown shapes pass through and get a helpful error.
 */
function canonicalAction(item: Record<string, unknown>): RetrievalAction {
	const fn = item.function && typeof item.function === 'object' ? (item.function as Record<string, unknown>) : null;

	const named =
		actionName(item.action) ??
		actionName(item.name) ??
		actionName(item.tool) ??
		actionName(item.type) ??
		actionName(fn?.name);

	if (named) return namedAction(item, named);

	const keys = Object.keys(item);
	const key = keys.length === 1 ? actionName(keys[0]) : null;

	if (key) return keyedAction(item[keys[0]], key);

	return item as unknown as RetrievalAction;
}

function isAction(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

	return actionName((canonicalAction(value as Record<string, unknown>) as { action?: unknown }).action) !== null;
}

function canonicalObjects(list: unknown[]): RetrievalAction[] {
	return list
		.filter((item) => item && typeof item === 'object')
		.map((item) => canonicalAction(item as Record<string, unknown>));
}

/** The retrieval requests in a model's parsed JSON reply, or null when it holds none. */
export function parseActions(parsed: unknown): RetrievalAction[] | null {
	if (!parsed || typeof parsed !== 'object') return null;

	if (Array.isArray(parsed)) {
		const actions = parsed.filter(isAction).map((item) => canonicalAction(item));

		return actions.length ? actions : null;
	}

	const obj = parsed as Record<string, unknown>;

	for (const key of ACTION_LIST_KEYS) {
		const list = obj[key];

		if (Array.isArray(list)) {
			const actions = canonicalObjects(list);

			if (actions.length) return actions;
		} else if (list && typeof list === 'object' && isAction(list)) {
			return [canonicalAction(list)];
		}
	}

	if (isAction(obj)) return [canonicalAction(obj)];

	return null;
}

/** Actions from a raw array (kept even when unrecognised, so they get an error) or a model reply. */
export function normalizeActions(raw: unknown): RetrievalAction[] {
	if (Array.isArray(raw)) return canonicalObjects(raw);

	return parseActions(raw) ?? [];
}
