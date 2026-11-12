import { expect, test } from 'bun:test';
import { runCorrectnessProcess } from './ha-correctness-process';

const url = process.env.TEST_DATABASE_URL;

test.skipIf(!url)(
	'API and owner updates commit when the API obtains the record lock first',
	async () => {
		if (!url) return;

		const output = await runCorrectnessProcess(
			url,
			`
import assert from 'node:assert/strict';
import {initializeStorage,coordinator,postgres,storageTransaction} from './apps/server/src/storage/backend.ts';
import {db,closeStore} from './apps/server/src/store.ts';
import {testReview} from './apps/server/tests/helpers/review.ts';
import {withLease} from './apps/server/src/review/runtime/ownership.ts';
await initializeStorage();
try {
 const id='locked-review';
 await db.reviews.set(testReview({id,summary:'0'}));
 await coordinator.enqueue(id);
 const lease=await coordinator.claim('owner');
 const start=Promise.withResolvers();
 const owner=withLease(lease,async()=>{
  await start.promise;
  return db.reviews.update(id,review=>({...review,summary:String(Number(review.summary)+1)}));
 });
 await storageTransaction(async transaction=>{
  await transaction\`SELECT pg_advisory_xact_lock(hashtextextended(\${JSON.stringify(['reviews',id])},0))\`;
  start.resolve();
  const deadline=Date.now()+2000;
  let blocked=false;
  while(Date.now()<deadline){
   const rows=await postgres\`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND pid<>pg_backend_pid()\`;
   if(rows.length){blocked=true;break;}
   await Bun.sleep(5);
  }
  assert.equal(blocked,true,'owner did not wait on the held record lock');
  await db.reviews.update(id,review=>({...review,summary:String(Number(review.summary)+1)}));
 });
 await owner;
 assert.equal((await db.reviews.get(id)).summary,'2');
 console.log('both updates committed');
} finally {await closeStore();}
`
		);

		expect(output).toContain('both updates committed');
	},
	15_000
);
