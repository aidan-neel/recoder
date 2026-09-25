import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate storage before any module opens the database or reads credentials.
process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-test-suite-'));
process.env.RECODER_WORKDIR = mkdtempSync(join(tmpdir(), 'recoder-test-work-'));
writeFileSync(join(process.env.RECODER_DATA_DIR, 'tokens.json'), '{}', { mode: 0o600 });
delete process.env.GH_TOKEN;
delete process.env.GITLAB_TOKEN;

// Tests simulate provider failures and expect them to surface at once; llm-retry.test.ts opts back in.
process.env.RECODER_LLM_RETRIES ??= '0';
