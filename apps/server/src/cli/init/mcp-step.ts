import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { describeError, errorCode } from '../exit.js';
import { failedStep, type InitStep } from './init-step.js';

/** The file a project lists its MCP servers in, which Claude Code and other agents read. */
const MCP_CONFIG_FILE = '.mcp.json';

const SERVER_NAME = 'recoder';

/** How an agent starts the server: the `recoder` on its PATH, serving MCP on standard input and output. */
const SERVER_ENTRY = { command: 'recoder', args: ['mcp'] };

const JSON_INDENT = 2;

/** The file is written by people and other tools, so it is parsed as outside input; fields beside the servers are kept. */
const mcpConfigSchema = z.looseObject({ mcpServers: z.record(z.string(), z.unknown()).optional() });

const STEP = { id: 'mcp', label: 'MCP server' } as const;

/**
 * Adds the recoder server to the project's `.mcp.json`, keeping every other server and field in it. An entry that is
 * already this one is left; one that differs is replaced only with `force`. A file that is not a JSON object fails
 * the step rather than being overwritten.
 */
export async function registerMcpStep(projectFolder: string, force: boolean): Promise<InitStep> {
	const path = join(projectFolder, MCP_CONFIG_FILE);

	try {
		const config = await readConfig(path);
		const existing = config.mcpServers?.[SERVER_NAME];

		if (isDeepStrictEqual(existing, SERVER_ENTRY)) {
			return { ...STEP, state: 'unchanged', detail: 'already registered', path, fix: null };
		}

		if (existing !== undefined && !force) {
			return {
				...STEP,
				state: 'skipped',
				detail: `${MCP_CONFIG_FILE} has a different recoder server`,
				path,
				fix: 'Run recoder init again with --force to replace it.'
			};
		}

		const next = { ...config, mcpServers: { ...config.mcpServers, [SERVER_NAME]: SERVER_ENTRY } };

		await writeFile(path, `${JSON.stringify(next, null, JSON_INDENT)}\n`);

		return { ...STEP, state: 'done', detail: 'registered', path, fix: null };
	} catch (error) {
		return failedStep({ ...STEP, path }, describeError(error));
	}
}

/** The file's contents; an empty config when there is no file yet. */
async function readConfig(path: string): Promise<z.infer<typeof mcpConfigSchema>> {
	const text = await readFile(path, 'utf8').catch((error: unknown) => {
		if (errorCode(error) === 'ENOENT') return null;

		throw error;
	});

	if (text === null) return {};

	const parsed = mcpConfigSchema.safeParse(parseJson(text));

	if (!parsed.success)
		throw new Error(`${MCP_CONFIG_FILE} is not a JSON object with mcpServers; fix it or add the server by hand`);

	return parsed.data;
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error(`${MCP_CONFIG_FILE} is not valid JSON: ${describeError(error)}`, { cause: error });
	}
}
