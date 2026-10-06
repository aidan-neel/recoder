import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Point storage at temp dirs before any module opens the database or reads credentials. */
function isolateStorage(): void {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-test-suite-'));
	process.env.RECODER_WORKDIR = mkdtempSync(join(tmpdir(), 'recoder-test-work-'));
	writeFileSync(join(process.env.RECODER_DATA_DIR, 'tokens.json'), '{}', { mode: 0o600 });
	delete process.env.GH_TOKEN;
	delete process.env.GITLAB_TOKEN;
}

/** Never start the developer's real OpenCode or Claude Code (or touch their logins); agent tests bring a fake one. */
function keepRealAgentsOut(): void {
	process.env.RECODER_OPENCODE_BIN = '';
	process.env.RECODER_CLAUDE_BIN = '';
}

/** Tests simulate provider failures and expect them to surface at once; llm-retry.test.ts opts back in. */
function failFast(): void {
	process.env.RECODER_LLM_RETRIES ??= '0';
}

isolateStorage();
keepRealAgentsOut();
failFast();
