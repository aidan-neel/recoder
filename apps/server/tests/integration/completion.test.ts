import { expect, test } from 'bun:test';
import { runCorrectnessProcess } from './ha-correctness-process';

const url = process.env.TEST_DATABASE_URL;

const setup = `
const {initializeStorage,postgres,coordinator,closeStorage,sharedEvents}=await import('./apps/server/src/storage/backend.ts');
const {db,reviewProgress}=await import('./apps/server/src/store.ts');
const {testReview}=await import('./apps/server/tests/helpers/review.ts');
const {emptyReviewProgress}=await import('./packages/shared/src/index.ts');
const {finalizeReview}=await import('./apps/server/src/commands/finalize-review.ts');
const {recoverCompletion}=await import('./apps/server/src/commands/recover-completion.ts');
await initializeStorage();
await db.reviews.set(testReview({id:'completed',status:'running'}));
await reviewProgress.set(emptyReviewProgress('completed'));
const result={findings:[],unconfirmed:[],summary:'Complete',outcome:'complete',recommendedChecks:[],coverage:{reviewed:0,pending:0,partial:0,excluded:0,total:0},coverageGaps:[],assignments:[]};
`;

test.skipIf(!url)('a completed review publishes terminal progress in the same commit as its result', async () => {
	if (!url) return;

	const output = await runCorrectnessProcess(
		url,
		setup +
			`
await finalizeReview('completed',result);
const review=await db.reviews.get('completed');
const progress=await reviewProgress.get('completed');
const events=await sharedEvents.after('completed',0);
console.log(JSON.stringify({status:review.status,finalize:progress.tasks.finalize.status,terminal:events.some(event=>event.type==='done')}));
await closeStorage();
`
	);

	expect(JSON.parse(output)).toEqual({ status: 'passed', finalize: 'done', terminal: true });
});

test.skipIf(!url)('a terminal event write failure rolls back the completed result and progress', async () => {
	if (!url) return;

	const output = await runCorrectnessProcess(
		url,
		setup +
			`
await postgres.unsafe("CREATE FUNCTION refuse_terminal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event->>'type'='done' THEN RAISE EXCEPTION 'terminal rejected'; END IF; RETURN NEW; END $$");
await postgres.unsafe('CREATE TRIGGER refuse_terminal BEFORE INSERT ON recoder_review_events FOR EACH ROW EXECUTE FUNCTION refuse_terminal()');
let rejected=false;
try { await finalizeReview('completed',result); } catch { rejected=true; }
const review=await db.reviews.get('completed');
const progress=await reviewProgress.get('completed');
console.log(JSON.stringify({rejected,status:review.status,finalize:progress.tasks.finalize??null,events:(await sharedEvents.after('completed',0)).length}));
await closeStorage();
`
	);

	expect(JSON.parse(output)).toEqual({ rejected: true, status: 'running', finalize: null, events: 0 });
});

test.skipIf(!url)('recovery finishes legacy terminal progress once without running models', async () => {
	if (!url) return;

	const output = await runCorrectnessProcess(
		url,
		setup +
			`
await db.reviews.update('completed',review=>({...review,status:'passed'}));
const review=await db.reviews.get('completed');
await recoverCompletion(review);
const first=(await sharedEvents.after('completed',0)).length;
await recoverCompletion(review);
console.log(JSON.stringify({first,second:(await sharedEvents.after('completed',0)).length,finalize:(await reviewProgress.get('completed')).tasks.finalize.status}));
await closeStorage();
`
	);

	const result = JSON.parse(output);

	expect(result.first).toBeGreaterThan(0);
	expect(result.second).toBe(result.first);
	expect(result.finalize).toBe('done');
});
