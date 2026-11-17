import type { Repo, RepoChatMessage, RepoTreeEntry } from '@recoder/shared';
import type { ToolOutcome } from '../agents/contract';
import { git } from '../evidence/git';
import { sliceLines } from '../evidence/text';
import { RepoFilesError } from '../repo-files/errors';
import { listDirectory, readRepoFileAt } from '../repo-files/listing';
import { cleanRepoPath } from '../repo-files/paths';
import { findSkills, type LoadedSkill } from '../skills/discovery';
import { reviewFromChat } from './chat-review';
import { repoAtDefaultBranch } from './repo-context';

/** How many tool calls one reply may make. The next call is refused and the model is told to answer. */
export const MAX_CHAT_TOOL_CALLS = 24;

/** How long one agent reply may run before it is stopped. */
export const CHAT_RUN_TIMEOUT_MS = 5 * 60 * 1000;

/** Lines one `read_file` call returns. */
const MAX_READ_LINES = 200;

/** Matches one `search` call returns. */
const MAX_SEARCH_MATCHES = 30;

/** Entries one `list_files` call returns. */
const MAX_LIST_ENTRIES = 200;

/** The longest literal a search accepts. */
const MAX_QUERY_CHARS = 200;

/** Numbered file text is cut here, then the model can ask for a later range. */
const MAX_READ_CHARS = 24_000;

/** A review brief is the chat message, cut here so a tool argument cannot carry the whole history. */
const MAX_FOCUS_CHARS = 4000;

const OUTSIDE = 'That path is outside the repository.';

const NO_COPY = 'This repository has no git copy on this server yet.';

/**
 * What a chat tool may use: the repository, the reply's abort, and where a started review is shown. `claimReview`
 * hands out the reply's one review: true for the first call, false after, even while that first one is starting.
 */
export interface ChatToolContext {
	repo: Repo;
	signal: AbortSignal;
	startedBy?: string;
	claimReview(): boolean;
	showReview(result: Pick<RepoChatMessage, 'text' | 'review' | 'failure'>): void;
}

/** One chat tool: its model-facing definition and the function that runs it. */
interface ChatTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	run(args: Record<string, unknown>, ctx: ChatToolContext): Promise<ToolOutcome>;
}

/** A field that was absent, present, or the wrong type. */
interface Taken<T> {
	invalid: boolean;
	value?: T;
}

const str = { type: 'string' };
const int = { type: 'integer' };

function schema(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
	return { type: 'object', properties, required };
}

/** The tools a repository chat agent may call. The system prompt and the MCP lease are built from this list. */
export const CHAT_TOOLS: readonly ChatTool[] = [
	{
		name: 'read_file',
		description: 'Read up to 200 lines of a file on the default branch, with line numbers.',
		inputSchema: schema({ path: str, startLine: int, endLine: int }, ['path']),
		run: readFile
	},
	{
		name: 'search',
		description: 'Search the default branch for a literal string, at most 30 matches.',
		inputSchema: schema({ query: str, prefix: { type: 'string', description: 'Only search under this directory.' } }, [
			'query'
		]),
		run: searchRepository
	},
	{
		name: 'list_files',
		description: 'List one page of files, optionally under a directory prefix.',
		inputSchema: schema({ prefix: str }, []),
		run: listFiles
	},
	{
		name: 'load_skill',
		description: "Read one of the repository's skills (its SKILL.md) on the default branch by name.",
		inputSchema: schema({ name: str }, ['name']),
		run: loadSkill
	},
	{
		name: 'start_review',
		description:
			'Start a review of one pull request, only when the person asks for a review and gave its number. Never guess a number. Once per reply.',
		inputSchema: schema({ pull: int, focus: { type: 'string', description: 'What the review should focus on.' } }, [
			'pull'
		]),
		run: startReview
	}
];

/** The tool definitions a lease lists: name, description and input schema, without the handlers. */
export function chatToolDefinitions(): { name: string; description: string; inputSchema: Record<string, unknown> }[] {
	return CHAT_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

/** The refusal a reply gives once it has used its tool calls, telling the model to stop and answer. */
export function cappedToolCall(): ToolOutcome {
	return {
		text: `The limit of ${MAX_CHAT_TOOL_CALLS} tool calls is reached. Answer now with what you have.`,
		isError: true
	};
}

/** The arguments object of a tool call, or null when the call did not pass an object. */
export function toolArguments(args: unknown): Record<string, unknown> | null {
	if (!args || typeof args !== 'object' || Array.isArray(args)) return null;

	return Object.fromEntries(Object.entries(args));
}

/** Runs the named chat tool. An unknown name, bad arguments, or a refused path is an error result, not a throw. */
export async function runChatTool(name: string, args: unknown, ctx: ChatToolContext): Promise<ToolOutcome> {
	const tool = CHAT_TOOLS.find((item) => item.name === name);

	if (!tool) return refused(`There is no tool named ${name}.`);

	const record = toolArguments(args);

	if (!record) return refused('The arguments must be an object.');

	try {
		return await tool.run(record, ctx);
	} catch (error) {
		if (error instanceof RepoFilesError) return refused(error.message);

		throw error;
	}
}

async function readFile(args: Record<string, unknown>, ctx: ChatToolContext): Promise<ToolOutcome> {
	const path = repositoryPath(args, 'path');

	if (typeof path !== 'string') return path;

	const window = lineWindow(args);

	if (!('start' in window)) return window;

	const tree = await repoAtDefaultBranch(ctx.repo);

	if (!tree) return refused(NO_COPY);

	const file = await readRepoFileAt(tree.root, tree.sha, path, ctx.signal);

	if (file.binary || file.text === undefined) return refused('That file is binary and is not shown.');
	if (file.text === '') return { text: 'The file is empty.', isError: false };

	const sliced = sliceLines(file.text, window.start, window.end, 'head', path, MAX_READ_CHARS);

	if (!sliced.ok) return refused(sliced.error ?? 'The file could not be read.');

	const continued = typeof sliced.continuation === 'string' && sliced.continuation !== '';
	const more = sliced.truncated || file.truncated || continued;

	return {
		text: more ? `${sliced.content}\n…[truncated; ask for a later line range]` : sliced.content,
		isError: false
	};
}

async function searchRepository(args: Record<string, unknown>, ctx: ChatToolContext): Promise<ToolOutcome> {
	const query = literalQuery(args);

	if (typeof query !== 'string') return query;

	const prefix = directoryPrefix(args);

	if (typeof prefix !== 'string') return prefix;

	const tree = await repoAtDefaultBranch(ctx.repo);

	if (!tree) return refused(NO_COPY);

	const grepped = await git(
		tree.root,
		['grep', '-n', '-I', '-F', '--full-name', '-e', query, tree.sha, ...(prefix ? ['--', prefix] : [])],
		ctx.signal
	);

	if (grepped.code !== 0 && grepped.code !== 1) return refused('Search failed.');

	const matches = grepped.stdout
		.split('\n')
		.map((line) => line.trimEnd())
		.filter(Boolean)
		.map((line) => (line.startsWith(`${tree.sha}:`) ? line.slice(tree.sha.length + 1) : line));

	if (matches.length === 0) return { text: 'No matches.', isError: false };

	const shown = matches.slice(0, MAX_SEARCH_MATCHES).map((line) => line.slice(0, 500));
	const rest = matches.length - shown.length;
	const more = rest > 0 ? `\n${rest} more matches. Narrow the query or the prefix.` : '';

	return { text: `${shown.join('\n')}${more}`, isError: false };
}

async function listFiles(args: Record<string, unknown>, ctx: ChatToolContext): Promise<ToolOutcome> {
	const prefix = directoryPrefix(args);

	if (typeof prefix !== 'string') return prefix;

	const tree = await repoAtDefaultBranch(ctx.repo);

	if (!tree) return refused(NO_COPY);

	const entries = await listDirectory(tree.root, tree.sha, prefix, ctx.signal);

	if (entries.length === 0) return { text: 'No files under this directory.', isError: false };

	const shown = entries.slice(0, MAX_LIST_ENTRIES).map(formatEntry);
	const more = entries.length > shown.length ? '\nThere are more entries. Pass a narrower prefix.' : '';

	return { text: `${shown.join('\n')}${more}`, isError: false };
}

async function loadSkill(args: Record<string, unknown>, ctx: ChatToolContext): Promise<ToolOutcome> {
	const taken = takeString(args, 'name');

	if (taken.invalid || !taken.value) return refused('name must be the name of a skill.');

	const tree = await repoAtDefaultBranch(ctx.repo);

	if (!tree) return refused(NO_COPY);

	const { skills } = await findSkills([{ root: tree.root, sha: tree.sha }], [taken.value], ctx.signal);
	const [skill] = skills;

	if (!skill) return refused(`This repository has no skill named "${taken.value}".`);

	return { text: skillText(skill), isError: false };
}

/** The skill's `SKILL.md`, with a note when it was cut. */
function skillText(skill: LoadedSkill): string {
	return skill.truncated ? `${skill.text}\n…[truncated]` : skill.text;
}

async function startReview(args: Record<string, unknown>, ctx: ChatToolContext): Promise<ToolOutcome> {
	const pull = takeInteger(args, 'pull');

	if (pull.invalid || pull.value === undefined || pull.value <= 0)
		return refused('pull must be a pull request number.');

	const focus = takeString(args, 'focus');

	if (focus.invalid) return refused('focus must be a string.');

	if (!ctx.claimReview()) return refused('This reply already started a review. Answer the person instead.');

	const brief = focus.value?.slice(0, MAX_FOCUS_CHARS);
	const instructions = brief && brief.trim() ? brief : undefined;
	const result = await reviewFromChat(ctx.repo, pull.value, instructions, ctx.startedBy);

	ctx.showReview(result);

	if (result.failure) return refused(result.failure.reason);

	return { text: result.text, isError: false };
}

/** A repository-relative path, or a refusal when it is missing, the wrong type, or escapes the tree. */
function repositoryPath(args: Record<string, unknown>, key: string): string | ToolOutcome {
	const taken = takeString(args, key);

	if (taken.invalid) return refused(`${key} must be a string.`);
	if (!taken.value) return refused(`${key} is required.`);

	const clean = cleanRepoPath(taken.value);

	if (clean === null) return refused(OUTSIDE);
	if (clean === '') return refused(`${key} is required.`);

	return clean;
}

/** A directory prefix: absent means the whole tree. A path that escapes is a refusal. */
function directoryPrefix(args: Record<string, unknown>): string | ToolOutcome {
	const taken = takeString(args, 'prefix');

	if (taken.invalid) return refused('prefix must be a string.');
	if (!taken.value) return '';

	const clean = cleanRepoPath(taken.value);

	if (clean === null) return refused(OUTSIDE);

	return clean;
}

function literalQuery(args: Record<string, unknown>): string | ToolOutcome {
	const taken = takeString(args, 'query');

	if (taken.invalid) return refused('query must be a string.');

	const query = taken.value?.trim() ?? '';

	if (!query) return refused('query is required.');
	if (query.length > MAX_QUERY_CHARS) return refused(`query must be at most ${MAX_QUERY_CHARS} characters.`);
	if (query.includes('\n') || query.includes('\0')) return refused('query must be a single line.');

	return query;
}

/** The line window a read asks for, clamped to {@link MAX_READ_LINES}, or a refusal. */
function lineWindow(args: Record<string, unknown>): { start: number; end: number } | ToolOutcome {
	const start = takeInteger(args, 'startLine');
	const end = takeInteger(args, 'endLine');

	if (start.invalid) return refused('startLine must be an integer.');
	if (end.invalid) return refused('endLine must be an integer.');

	const first = start.value ?? 1;

	if (first < 1) return refused('startLine must be at least 1.');

	const last = end.value ?? first + MAX_READ_LINES - 1;

	if (last < first) return refused('endLine is before startLine.');

	return { start: first, end: Math.min(last, first + MAX_READ_LINES - 1) };
}

function formatEntry(entry: RepoTreeEntry): string {
	if (entry.kind === 'symlink') return `${entry.path} (symlink, not followed)`;
	if (entry.kind === 'submodule') return `${entry.path} (submodule)`;
	if (entry.kind === 'dir') return `${entry.path}/`;

	return entry.path;
}

function takeString(record: Record<string, unknown>, key: string): Taken<string> {
	if (!Object.hasOwn(record, key) || record[key] === undefined) return { invalid: false };

	const value = record[key];

	if (typeof value !== 'string') return { invalid: true };

	return { invalid: false, value };
}

function takeInteger(record: Record<string, unknown>, key: string): Taken<number> {
	if (!Object.hasOwn(record, key) || record[key] === undefined) return { invalid: false };

	const value = record[key];

	if (typeof value !== 'number' || !Number.isInteger(value)) return { invalid: true };

	return { invalid: false, value };
}

function refused(text: string): ToolOutcome {
	return { text, isError: true };
}
