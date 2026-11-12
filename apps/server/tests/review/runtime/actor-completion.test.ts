import { subprocessOutput } from '../../helpers/subprocess-output';
import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../../../..');

test('a pipeline that completes during actor synchronization is not started again', async () => {
	const program = `
import {mock} from 'bun:test';
import assert from 'node:assert/strict';
mock.module('./apps/server/src/commands/recover-completion.ts',()=>({recoverCompletion:async()=>{}}));
let status='queued';
let runs=0;
let checks=0;
let finish;
const completed=new Promise(resolve=>finish=resolve);
mock.module('./apps/server/src/storage/backend.ts',()=>({coordinator:{state:async()=>{
 if(++checks===2){status='passed';finish();await Promise.resolve();await Promise.resolve();}
 return 'active';
},readCommands:async()=>[],acknowledge:async()=>{}},settingsOperation:async work=>work()}));
mock.module('./apps/server/src/store.ts',()=>({db:{reviews:{get:async()=>({id:'review',status})}},reviewProgress:{get:async()=>({paused:false})},settlePipelineStreams:async()=>null}));
mock.module('./apps/server/src/commands/pipeline.ts',()=>({runReviewPipeline:async()=>{runs++;status='running';await completed;},touch:async()=>{}}));
mock.module('./apps/server/src/review/chat/chat-replies.ts',()=>({cancelReviewChats:()=>{},stopReviewChat:()=>{},recordChatMessage:()=>{},waitReviewChat:async()=>{}}));
mock.module('./apps/server/src/review/chat/review-chat.ts',()=>({startReviewChat:async()=>{}}));
mock.module('./apps/server/src/review/chat/draft-session.ts',()=>({prepareDraftSession:async()=>{}}));
mock.module('./apps/server/src/review/session/events.ts',()=>({emitReviewEvent:()=>{},commitGatedReviewEvent:async()=>false,flushReviewEvents:async()=>{},settleReviewTasks:async()=>{}}));
mock.module('./apps/server/src/review/session/review-control.ts',()=>({getReviewControl:()=>undefined}));
mock.module('./apps/server/src/forge/publish/pull-comment.ts',()=>({publishPullComment:async()=>{throw new Error('No publication was requested.');}}));
const {executeReviewActor}=await import('./apps/server/src/review/runtime/actor.ts');
await executeReviewActor({reviewId:'review',ownerId:'replica',epoch:'1',expiresAt:new Date()},AbortSignal.timeout(2000));
assert.equal(runs,1);
console.log('one completed run');
`;

	const child = Bun.spawn([process.execPath, '-e', program], { cwd: root, stdout: 'pipe', stderr: 'pipe' });

	const stdout = await subprocessOutput(child);

	expect(stdout).toContain('one completed run');
}, 5000);
