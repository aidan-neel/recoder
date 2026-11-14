import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_BIN_PINS } from './helpers/agent-bins';

/** Point storage and the secret key file at temp dirs before any module opens the database or reads credentials. */
function isolateStorage(): void {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-test-suite-'));
	process.env.RECODER_WORKDIR = mkdtempSync(join(tmpdir(), 'recoder-test-work-'));
	writeFileSync(join(process.env.RECODER_DATA_DIR, 'tokens.json'), '{}', { mode: 0o600 });
	process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'recoder-test-config-'));
	delete process.env.RECODER_SECRET_KEY;
	delete process.env.GH_TOKEN;
	delete process.env.GITLAB_TOKEN;
	delete process.env.RECODER_DATABASE_URL;
	delete process.env.RECODER_INSTANCE_ID;
}

/**
 * Never start the developer's real OpenCode, Claude Code, Devin or custom command (or touch their logins); agent
 * tests bring a fake one.
 */
function keepRealAgentsOut(): void {
	for (const pin of AGENT_BIN_PINS) process.env[pin] = '';
	delete process.env.RECODER_CUSTOM_AGENT;
}

/** Tests simulate provider failures and expect them to surface at once; llm-retry.test.ts opts back in. */
function failFast(): void {
	process.env.RECODER_LLM_RETRIES ??= '0';
}

isolateStorage();
keepRealAgentsOut();
failFast();
