import { expect, test } from 'bun:test';
import { SQL } from 'bun';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testUrl = process.env.RECODER_POSTGRES_TEST_URL;
const root = resolve(import.meta.dir, '../../../..');

const admission = `
import assert from 'node:assert/strict';
import {initializeStorage,settingsOperation,coordinator,postgres} from './apps/server/src/storage/backend.ts';
import {db,reviewProgress} from './apps/server/src/store.ts';
import {createReviewSession,startReviewSession} from './apps/server/src/commands/pipeline.ts';
import {saveReviewSettings} from './apps/server/src/review/session/review-settings.ts';
import {requestReviewControl,requestChat} from './apps/server/src/review/runtime/requests.ts';
import {ORCHESTRATOR_ID} from './packages/shared/src/index.ts';
await initializeStorage();
await settingsOperation(async()=> {
 saveReviewSettings({baseUrl:'http://127.0.0.1:9/v1',apiKey:'test',models:[{id:'model',label:'model',model:'model'}],orchestratorModelId:'model'});
});
await settingsOperation(async()=> {
 const now = new Date().toISOString();
 await db.repos.set({id:'repo',name:'fixture',url:'https://example.invalid/repo',provider:'github',defaultBranch:'main',createdAt:now,updatedAt:now});
 const draft=await createReviewSession({repoId:'repo',prNumber:1});
 const starts=await Promise.allSettled([startReviewSession(draft.id),startReviewSession(draft.id)]);
 assert.equal(starts.filter(result=>result.status==='fulfilled').length,1);
 assert.equal((await db.reviews.get(draft.id)).status,'queued');
 const commands=await postgres\`SELECT command FROM review_actor_commands WHERE review_id=\${draft.id}\`;
 assert.equal(commands.length,1);
 assert.equal(commands[0].command.kind,'start');
 assert.equal(await db.repos.get('repo')!==undefined,true);
 const chats=await Promise.allSettled([requestChat(draft.id,ORCHESTRATOR_ID,'Explain the change.'),requestChat(draft.id,ORCHESTRATOR_ID,'Explain it again.')]);
 assert.equal(chats.filter(result=>result.status==='fulfilled').length,1);
 assert.equal((await reviewProgress.get(draft.id)).messages.filter(message=>message.from==='user').length,1);
 await requestReviewControl(draft.id,'pause');
 const lease=await coordinator.claim('replica-b');
 assert.equal(await coordinator.state(lease),'paused');
 await requestReviewControl(draft.id,'cancel');
 assert.equal(await coordinator.state(lease),'cancelled');
 console.log('admission checks passed');
});
await postgres.close();
`;

test.skipIf(!testUrl)(
	'shared admission serializes starts and chats and persists controls without a local executor',
	async () => {
		if (!testUrl) return;

		const directory = await mkdtemp(join(tmpdir(), 'recoder-runtime-admission-'));
		const name = `recoder_admission_${crypto.randomUUID().replaceAll('-', '')}`;
		const admin = new SQL(testUrl);
		const url = new URL(testUrl);

		url.pathname = `/${name}`;

		try {
			await admin.unsafe(`CREATE DATABASE ${name}`);

			const child = Bun.spawn([process.execPath, '-e', admission], {
				cwd: root,
				stdout: 'pipe',
				stderr: 'pipe',
				env: {
					...process.env,
					HOME: directory,
					RECODER_DATA_DIR: join(directory, 'data'),
					RECODER_WORKDIR: join(directory, 'work'),
					RECODER_DATABASE_URL: url.href,
					RECODER_OPENCODE_BIN: '',
					RECODER_CLAUDE_BIN: '',
					GH_TOKEN: '',
					GITLAB_TOKEN: ''
				}
			});

			const result = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text()
			]);

			if (result[0] !== 0) throw new Error(result.slice(1).join('\n'));
			expect(result[1]).toContain('admission checks passed');
		} finally {
			await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
			await admin.close();
			await rm(directory, { recursive: true, force: true });
		}
	},
	15_000
);
