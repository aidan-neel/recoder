/** CLI-local tools have no access to the review checkout; only the leased MCP server does. */
const LOCAL_TOOLS = [
	'read',
	'write',
	'edit',
	'apply_patch',
	'notebook_read',
	'notebook_edit',
	'grep',
	'glob',
	'find_file_by_name',
	'exec',
	'get_output',
	'write_to_process',
	'kill_shell',
	'webfetch',
	'web_search',
	'ask_user_question',
	'todo_write',
	'exit_plan_mode',
	'skill',
	'run_subagent',
	'read_subagent',
	'request_scope'
];

const EQUIVALENTS: Record<string, string> = {
	read: 'read_file',
	write: 'write_file',
	edit: 'write_file',
	apply_patch: 'write_file',
	grep: 'search',
	glob: 'list_files',
	find_file_by_name: 'list_files',
	exec: 'run',
	get_output: 'run',
	write_to_process: 'run',
	kill_shell: 'run'
};

/** The real config switch hides definitions; hooks still fail closed if a stale session calls one. */
export function mcpOnlyTools(server: string, tools: readonly string[]) {
	return {
		disabled_tools: LOCAL_TOOLS,
		subagents_enabled: false,
		hooks: {
			PreToolUse: LOCAL_TOOLS.map((name) => {
				const equivalent = EQUIVALENTS[name];

				const route =
					equivalent && tools.includes(equivalent)
						? `Call mcp_call_tool with server_name=${server}, tool_name=${equivalent}; use mcp_list_tools for its schema.`
						: `Use mcp_list_tools with server_name=${server} for the available Recoder tools.`;

				const output = JSON.stringify({
					decision: 'block',
					reason: `Builtin ${name} is unavailable. ${route} Continue verification; this refusal is not a verdict.`
				});

				return {
					matcher: `^${name}$`,
					hooks: [{ type: 'command', command: `echo '${output.replaceAll("'", "'\\''")}'`, timeout: 5 }]
				};
			})
		}
	};
}
