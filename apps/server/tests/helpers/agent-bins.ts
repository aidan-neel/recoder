/**
 * The env vars that pin an agent CLI's binary. Tests blank every one so a spawned CLI resolves to a fake — or
 * nothing — and never the developer's real install.
 */
export const AGENT_BIN_PINS = [
	'RECODER_OPENCODE_BIN',
	'RECODER_CLAUDE_BIN',
	'RECODER_DEVIN_BIN',
	'RECODER_GROK_BIN',
	'RECODER_CURSOR_BIN',
	'RECODER_CODEX_BIN',
	'RECODER_PI_BIN',
	'RECODER_ANTIGRAVITY_BIN'
] as const;
