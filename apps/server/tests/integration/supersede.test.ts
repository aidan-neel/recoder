import { expect, test } from 'bun:test';
import { runCorrectnessProcess } from './ha-correctness-process';

const url = process.env.TEST_DATABASE_URL;

test.skipIf(!url)(
	'superseding a remote automatic review preserves its cancellation reason across takeover',
	async () => {
		if (!url) return;

		const output = await runCorrectnessProcess(
			url,
			`
import assert from 'node:assert/strict';
import {initializeStorage,coordinator,postgres,storageTransaction} from './apps/server/src/storage/backend.ts';
import {db,closeStore} from './apps/server/src/store.ts';
import {testReview} from './apps/server/tests/helpers/review.ts';
import {supersedeAutomaticReviews} from './apps/server/src/review/session/supersede.ts';
import {withLease} from './apps/server/src/review/runtime/ownership.ts';
import {executeReviewActor} from './apps/server/src/review/runtime/actor.ts';
await initializeStorage();
try {
 await db.reviews.set(testReview({id:'automatic',repoId:'repo',prNumber:7,status:'running',trigger:'webhook'}));
 await db.reviews.set(testReview({id:'manual',repoId:'repo',prNumber:7,status:'running'}));
 await coordinator.enqueue('automatic');
 const original=await coordinator.claim('remote');
 await supersedeAutomaticReviews('repo',7);
 assert.equal(await coordinator.state(original),'cancelled');
 const [entry]=await coordinator.readCommands(original);
 await coordinator.acknowledge(original,entry.command.id);
 await postgres\`UPDATE review_actor_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE review_id='automatic'\`;
 const successor=await coordinator.claim('successor');
 assert.equal(await coordinator.readCancellationReason(successor),'Superseded by a newer automatic review.');
 await withLease(successor,()=>executeReviewActor(successor,AbortSignal.timeout(2000)));
 assert.equal((await db.reviews.get('automatic')).summary,'Superseded by a newer automatic review.');
 assert.equal((await db.reviews.get('automatic')).status,'failed');
 assert.equal((await db.reviews.get('manual')).status,'running');
 assert.equal((await postgres\`SELECT * FROM review_actor_leases WHERE review_id='manual'\`).length,0);
 await db.reviews.update('automatic',review=>({...review,status:'running'}));
 await assert.rejects(storageTransaction(async()=>{
   await supersedeAutomaticReviews('repo',7);
   throw new Error('rollback');
 }),/rollback/);
 assert.equal((await coordinator.readCommands(successor)).length,0);
 console.log('remote cancellation recovered');
} finally {await closeStore();}
`
		);

		expect(output).toContain('remote cancellation recovered');
	},
	15_000
);
