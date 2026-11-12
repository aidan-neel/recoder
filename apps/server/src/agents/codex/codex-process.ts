import type { ReasoningEffort } from '@recoder/shared';
import { cliEnv } from '../cli-process';
import type { ToolLease } from '../tools/mcp-host';

type Env = Record<string, string | undefined>;

/**
 * Variables the CLI must not inherit from the server: the server's own settings and keys, `CODEX_*` overrides of
 * what Recoder sets (all but `CODEX_HOME`, where the CLI keeps its own sign-in), `OPENAI_*` keys and endpoints that
 * would bill another account, and any token or secret. The CLI keeps the rest: PATH, HOME, locale, temp and XDG
 * dirs, proxies.
 */
const STRIPPED = [
	/^RECODER_/,
	/^CODEX_(?!HOME$)/,
	/^OPENAI_/,
	/^ANTHROPIC_/,
	/^GH_TOKEN$/,
	/_TOKEN$/,
	/_API_KEY$/,
	/SECRET/,
	/PASSWORD/
];

export function codexEnv(env: Env): Record<string, string> {
	return cliEnv(env, STRIPPED);
}

/**
 * Print mode with JSONL events, outside a git repository, with no `$CODEX_HOME/config.toml` (so none of its MCP
 * servers, hooks, profiles or model settings) and no `.rules` files. `--strict-config` makes a config field this CLI
 * version does not know fail the call instead of being ignored. The user's global `$CODEX_HOME/AGENTS.md` is still
 * sent to the model on every call: codex-cli 0.167.0 has no flag or config key that leaves it out.
 */
const PRINT_FLAGS = ['--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '--strict-config'];

/**
 * Feature flags that give the model a tool of the CLI's own or load something of the user's: the shell and exec
 * tools, image viewing and generation, subagents, apps, plugins, hooks, memories, the browser and computer tools,
 * goals, tool and skill discovery, sleep, the login-shell snapshot, and dependency installs. Each name is one
 * `codex features list` prints. `multi_agent` alone leaves the sub-agent tools on: the catalog each call names
 * ({@link CodexCall.catalogFile}) takes them away.
 */
const DISABLED_FEATURES = [
	'shell_tool',
	'unified_exec',
	'view_image',
	'image_generation',
	'multi_agent',
	'apps',
	'plugins',
	'hooks',
	'memories',
	'browser_use',
	'browser_use_external',
	'computer_use',
	'in_app_browser',
	'goals',
	'tool_suggest',
	'skill_search',
	'skill_mcp_dependency_install',
	'sleep_tool',
	'shell_snapshot',
	'workspace_dependencies'
];

/**
 * Config set for every call. Commands the model proposes run nowhere (read-only sandbox, never asked for
 * approval), web search is off, no project `AGENTS.md` is read (the global one in `$CODEX_HOME` still is), nothing is
 * written to the prompt history, the instruction blocks about the environment, permissions, apps, collaboration modes
 * and skills are left out, and no update check runs.
 */
const CALL_CONFIG: Record<string, string | number | boolean> = {
	sandbox_mode: 'read-only',
	approval_policy: 'never',
	web_search: 'disabled',
	project_doc_max_bytes: 0,
	'history.persistence': 'none',
	include_environment_context: false,
	include_permissions_instructions: false,
	include_apps_instructions: false,
	include_collaboration_mode_instructions: false,
	'skills.include_instructions': false,
	check_for_update_on_startup: false
};

/** The longest one Recoder tool call may take before the CLI gives up on it: a sandboxed `run` can take minutes. */
const TOOL_TIMEOUT_SEC = 900;

/**
 * What one `codex exec` call runs with: the model, its effort, the system prompt file, the model catalog, and
 * Recoder's MCP server.
 */
export interface CodexCall {
	model: string;
	reasoningEffort: ReasoningEffort | undefined;
	systemFile: string;
	/** The CLI's own catalog with no model offered sub-agents (`catalogWithoutSubagents`), in place of the one it reads. */
	catalogFile: string;
	lease: ToolLease | null;
}

/** One `-c key=value` override. The value is TOML: a JSON string is a valid TOML basic string. */
function override(key: string, value: string | number | boolean): string[] {
	return ['-c', `${key}=${typeof value === 'string' ? JSON.stringify(value) : String(value)}`];
}

/**
 * Recoder's MCP server for a run, and nothing else: the user's own servers are in the config file the call does not
 * load. Its tools need no approval, since the gate behind the server decides what each call may do.
 */
function serverArgs(lease: ToolLease | null): string[] {
	if (!lease) return [];

	const key = `mcp_servers.${lease.name}`;

	return [
		...override(`${key}.url`, lease.url),
		...override(`${key}.default_tools_approval_mode`, 'approve'),
		...override(`${key}.tool_timeout_sec`, TOOL_TIMEOUT_SEC)
	];
}

/** The flags every `codex exec` call takes, new or resumed: print mode, the call config, the model and Recoder's server. */
export function callArgs(call: CodexCall): string[] {
	const config = Object.entries(CALL_CONFIG).flatMap(([key, value]) => override(key, value));
	const features = DISABLED_FEATURES.flatMap((feature) => ['--disable', feature]);
	const effort = call.reasoningEffort ? override('model_reasoning_effort', call.reasoningEffort) : [];

	return [
		...PRINT_FLAGS,
		...features,
		...config,
		...override('model_instructions_file', call.systemFile),
		...override('model_catalog_json', call.catalogFile),
		...serverArgs(call.lease),
		'-m',
		call.model,
		...effort
	];
}
