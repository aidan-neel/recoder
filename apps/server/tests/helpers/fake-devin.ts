import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeBin } from './fake-bin';

/**
 * A fake `devin` CLI. `--version`, `auth status` (`FAKE_DEVIN_SIGNED_IN=1` signs it in) and `models list` answer at
 * once. `rm <id> --force` appends the id to `<log>.rm`. Print mode writes its arguments, prompt file, working
 * directory, local MCP config, config file and environment to `FAKE_DEVIN_LOG`, writes the export file (whose totals
 * grow on a resumed call), then acts on `FAKE_DEVIN_MODE`: a reply (default), `signedout`, `empty` (exit 0, no
 * text), `refused` (no text until the call resumes a session with `--resume`), `crash` (stderr, exit 1), `limited`
 * (the CLI's rate-limit error, a line and a JSON body, exit 1), `tool` (calls `read_diff` on the MCP server of the
 * local MCP config and answers with what it returned) or `spawn` (starts a `sleep` grandchild, writes `<own pid>
 * <grandchild pid>` to `<log>.pids` and waits for it).
 */
/** What the `tool` mode runs with Bun: one MCP call to the server Recoder put in the local MCP config. */
const TOOL_CALL = [
	"const config = JSON.parse(await Bun.file('.devin/mcp_config.local.json').text());",
	'const [server] = Object.values(config.mcpServers);',
	"const params = { name: 'read_diff', arguments: { path: 'file0.ts' } };",
	"const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params });",
	"const { result } = await (await fetch(server.url, { method: 'POST', body })).json();",
	'console.log(JSON.stringify({ done: true, results: [{ isError: result.isError, text: result.content[0].text }] }));'
].join(' ');

const SCRIPT = `#!/bin/sh
if [ "$1" = "--version" ]; then echo "devin 3000.11.3 (abc123)"; exit 0; fi

if [ "$1" = "auth" ]; then
	if [ "$FAKE_DEVIN_SIGNED_IN" = "1" ]; then echo "Logged in (via Devin)."; exit 0; fi
	echo "Not logged in."
	exit 1
fi

if [ "$1" = "models" ]; then
	cat <<'LIST'
Available models (2 families)

Adaptive (adaptive)
  adaptive                                                                  Adaptive  [$0.5 / 1M Input]

SWE-2 (swe-2)
  aliases: swe
  swe-2-high                                                                SWE-2 High  [262K context, Free]
  gpt-6-sol-medium                                                          GPT-6 Sol Medium Thinking  [1M context, $2 / 1M Input]
LIST
	exit 0
fi

if [ "$1" = "rm" ]; then echo "$2" >> "$FAKE_DEVIN_LOG.rm"; exit 0; fi

export_file=""
prompt_file=""
previous=""
resumed=""
for arg in "$@"; do
	if [ "$previous" = "--export" ]; then export_file="$arg"; fi
	if [ "$previous" = "--prompt-file" ]; then prompt_file="$arg"; fi
	if [ "$arg" = "--resume" ]; then resumed=1; fi
	previous="$arg"
done

{
	printf 'args:'; printf ' [%s]' "$@"
	printf '\\ncwd: %s\\nprompt: %s\\nmcp: %s\\nconfig: %s\\n' "$(pwd)" "$(cat "$prompt_file")" "$(cat .devin/mcp_config.local.json 2>/dev/null)" "$(cat "$XDG_CONFIG_HOME/devin/config.json")"
} > "$FAKE_DEVIN_LOG"
env > "$FAKE_DEVIN_LOG.env"

if [ -n "$resumed" ]; then
	echo '{"session_id":"quiet-owl","final_metrics":{"total_prompt_tokens":1500,"total_completion_tokens":50,"total_cached_tokens":900}}' > "$export_file"
else
	echo '{"session_id":"quiet-owl","final_metrics":{"total_prompt_tokens":1000,"total_completion_tokens":20,"total_cached_tokens":600}}' > "$export_file"
fi

case "$FAKE_DEVIN_MODE" in
signedout) echo "Error: Not logged in. Run devin auth login" >&2; exit 1 ;;
empty) exit 0 ;;
refused) if [ -n "$resumed" ]; then echo "the reply"; fi ;;
crash) echo "boom" >&2; exit 1 ;;
tool) bun -e "$TOOL_CALL" ;;
spawn) sleep 30 & echo "$$ $!" > "$FAKE_DEVIN_LOG.pids"; wait ;;
limited) printf '%s\n' 'Error: Agent error: Reached free model rate limit. Your limit will reset in 3 hours (at Oct 9 00:01 UTC). (trace ID: 21f5): {' '  "cognition.ai/errorKind": "unavailable",' '  "cognition.ai/retryable": true' '}' >&2; exit 1 ;;
*) echo "the reply" ;;
esac
`;

/** A fake `devin` on PATH, with its log files and a user config home holding an org and a model. */
export async function fakeDevin(extra: Record<string, string> = {}): Promise<Record<string, string | undefined>> {
	const { env } = await fakeBin('devin', SCRIPT);
	const dir = await mkdtemp(join(tmpdir(), 'fake-devin-'));
	const config = join(dir, 'config');

	await Bun.write(join(config, 'devin', 'config.json'), JSON.stringify({ version: 1, devin: { org_id: 'org-1' } }));

	return { ...env, HOME: dir, XDG_CONFIG_HOME: config, FAKE_DEVIN_LOG: join(dir, 'log'), TOOL_CALL, ...extra };
}
