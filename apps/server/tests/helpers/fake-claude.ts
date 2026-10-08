import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeBin } from './fake-bin';

/**
 * A fake `claude` CLI. `--version` and `auth status --json` answer at once (`FAKE_CLAUDE_SIGNED_IN=1` signs it
 * in). Print mode reads the prompt from stdin, writes its arguments, working directory, prompt and system prompt
 * file to `FAKE_CLAUDE_LOG` and its environment to `<log>.env`, saves an empty transcript for `--session-id` where
 * the CLI keeps sessions (under `CLAUDE_CONFIG_DIR`), then prints the canned `stream-json` lines for
 * `FAKE_CLAUDE_MODE`: a reply (default), `auth`, `limit`, `crash` (stderr only), `garbage` (unparsable output,
 * exit 0), `hang`, or `spawn` (starts a `sleep` grandchild, writes `<own pid> <grandchild pid>` to `<log>.pids`
 * and waits for it).
 */
const SCRIPT = `#!/bin/sh
if [ "$1" = "--version" ]; then echo "2.1.281 (Claude Code)"; exit 0; fi

if [ "$1" = "auth" ]; then
	if [ "$FAKE_CLAUDE_SIGNED_IN" = "1" ]; then echo '{"loggedIn":true,"authMethod":"claude.ai"}'; exit 0; fi
	echo '{"loggedIn":false,"authMethod":"none"}'
	exit 1
fi

prompt=$(cat)
system=""
session=""
previous=""
for arg in "$@"; do
	if [ "$previous" = "--system-prompt-file" ]; then system=$(cat "$arg"); fi
	if [ "$previous" = "--session-id" ]; then session="$arg"; fi
	previous="$arg"
done

if [ -n "$session" ] && [ -n "$CLAUDE_CONFIG_DIR" ]; then
	folder="$CLAUDE_CONFIG_DIR/projects/$(pwd | sed 's/[^a-zA-Z0-9]/-/g')"
	mkdir -p "$folder"
	: > "$folder/$session.jsonl"
fi

if [ -n "$FAKE_CLAUDE_LOG" ]; then
	{ printf 'args:'; printf ' [%s]' "$@"; printf '\\ncwd: %s\\nprompt: %s\\nsystem: %s\\n' "$(pwd)" "$prompt" "$system"; } > "$FAKE_CLAUDE_LOG"
	env > "$FAKE_CLAUDE_LOG.env"
fi

echo '{"type":"system","subtype":"init","tools":[],"mcp_servers":[],"apiKeySource":"none"}'

case "$FAKE_CLAUDE_MODE" in
auth)
	cat <<'JSON'
{"type":"assistant","error":"authentication_failed","is_api_error_message":true,"message":{"content":[{"type":"text","text":"Failed to authenticate: OAuth session expired and could not be refreshed"}]}}
{"type":"result","subtype":"success","is_error":true,"result":"Failed to authenticate: OAuth session expired and could not be refreshed","api_error_status":null,"usage":{"input_tokens":0,"output_tokens":0}}
JSON
	exit 1
	;;
limit)
	cat <<'JSON'
{"type":"assistant","error":"rate_limit","is_api_error_message":true,"message":{"content":[{"type":"text","text":"You've hit your limit · resets 3pm (UTC)"}]}}
{"type":"result","subtype":"success","is_error":true,"result":"You've hit your limit · resets 3pm (UTC)","api_error_status":429}
JSON
	exit 1
	;;
crash)
	echo "error: unknown option '--bogus'" >&2
	exit 1
	;;
garbage)
	echo 'Welcome to Claude Code!'
	;;
hang)
	exec sleep 30
	;;
spawn)
	sleep 30 &
	echo "$$ $!" > "$FAKE_CLAUDE_LOG.pids"
	wait
	;;
*)
	cat <<'JSON'
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Hmm."}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hi "}}}
{"type":"assistant","message":{"content":[{"type":"text","text":"Hi there"}]}}
{"type":"result","subtype":"success","is_error":false,"result":"Hi there","api_error_status":null,"total_cost_usd":0.001,"usage":{"input_tokens":10,"output_tokens":7,"cache_creation_input_tokens":20,"cache_read_input_tokens":100,"output_tokens_details":{"thinking_tokens":3}}}
JSON
	;;
esac
`;

/** The fake on PATH, plus the given `FAKE_CLAUDE_*` settings, as the environment an adapter runs with. */
export async function fakeClaude(settings: Record<string, string> = {}): Promise<Record<string, string>> {
	const { env } = await fakeBin('claude', SCRIPT);

	return { ...env, ...settings };
}

/** A fresh path for the fake's `FAKE_CLAUDE_LOG`. */
export async function fakeClaudeLog(): Promise<string> {
	return join(await mkdtemp(join(tmpdir(), 'fake-claude-log-')), 'call.txt');
}

/** The pids a `spawn` run wrote (the fake's own and its `sleep` grandchild's), once it has written them. */
export async function spawnedPids(log: string): Promise<number[]> {
	for (let i = 0; i < 400 && !existsSync(`${log}.pids`); i++) await Bun.sleep(25);

	return (await readFile(`${log}.pids`, 'utf8')).trim().split(' ').map(Number);
}

/** Whether `pid` is still a live process; a zombie waiting to be reaped counts as gone. */
function alive(pid: number): boolean {
	const stat = Bun.spawnSync(['ps', '-o', 'stat=', '-p', String(pid)])
		.stdout.toString()
		.trim();

	return stat !== '' && !stat.startsWith('Z');
}

/** Whether every one of `pids` has ended within two seconds. */
export async function allGone(pids: number[]): Promise<boolean> {
	for (let i = 0; i < 80 && pids.some(alive); i++) await Bun.sleep(25);

	return !pids.some(alive);
}
