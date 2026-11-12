import { subprocessOutput } from '../helpers/subprocess-output';
import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

test('a completed review with an unfinished publication publishes without running models again', async () => {
	const script = `
import {mock} from 'bun:test';
import assert from 'node:assert/strict';
mock.module('./apps/server/src/commands/recover-completion.ts',()=>({recoverCompletion:async()=>{}}));
let published=0;
let pipelines=0;
const review={id:'review',status:'passed',pullComment:{state:'posting'}};
mock.module('./apps/server/src/storage/backend.ts',()=>({coordinator:{state:async()=> 'active',readCommands:async()=>[],acknowledge:async()=>{}},settingsOperation:async work=>work()}));
mock.module('./apps/server/src/store.ts',()=>({db:{reviews:{get:async()=>review}},reviewProgress:{get:async()=>({paused:false})},settlePipelineStreams:async()=>null}));
mock.module('./apps/server/src/commands/pipeline.ts',()=>({runReviewPipeline:async()=>{pipelines++;},touch:async()=>{}}));
mock.module('./apps/server/src/review/chat/chat-replies.ts',()=>({cancelReviewChats:()=>{},stopReviewChat:()=>{},recordChatMessage:()=>{},waitReviewChat:async()=>{}}));
mock.module('./apps/server/src/review/chat/review-chat.ts',()=>({startReviewChat:async()=>{}}));
mock.module('./apps/server/src/review/chat/draft-session.ts',()=>({prepareDraftSession:async()=>{}}));
mock.module('./apps/server/src/review/session/events.ts',()=>({emitReviewEvent:()=>{},flushReviewEvents:async()=>{},settleReviewTasks:async()=>{}}));
mock.module('./apps/server/src/review/session/review-control.ts',()=>({getReviewControl:()=>undefined}));
mock.module('./apps/server/src/forge/publish/pull-comment.ts',()=>({publishPullComment:async()=>{published++;review.pullComment.state='posted';}}));
const {executeReviewActor}=await import('./apps/server/src/review/runtime/actor.ts');
await executeReviewActor({reviewId:'review',ownerId:'replica',epoch:'2',expiresAt:new Date()},AbortSignal.timeout(2000));
assert.equal(published,1);
assert.equal(pipelines,0);
console.log('publication recovered');
`;

	const child = Bun.spawn([process.execPath, '-e', script], {
		cwd: resolve(import.meta.dir, '../../../..'),
		stdout: 'pipe',
		stderr: 'pipe'
	});

	const stdout = await subprocessOutput(child);

	expect(stdout).toContain('publication recovered');
}, 5000);
