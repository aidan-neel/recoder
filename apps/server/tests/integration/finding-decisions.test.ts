import { expect, test } from 'bun:test';
import { runCorrectnessProcess } from './ha-correctness-process';

const url = process.env.TEST_DATABASE_URL;

/** The JSON result the program printed last, after the request log lines the app writes to stdout. */
function resultOf(output: string): unknown {
	return JSON.parse(output.trim().split('\n').at(-1) ?? '');
}

/** Saves reviews of `repo-1` with four open findings of one topic, and decides them through the API. */
const setup = `
const {initializeStorage,closeStorage,settingsOperation}=await import('./apps/server/src/storage/backend.ts');
const {db,reviewDiffs}=await import('./apps/server/src/store.ts');
const {app}=await import('./apps/server/src/app.ts');
const {testReview}=await import('./apps/server/tests/helpers/review.ts');
const {DIFF}=await import('./apps/server/tests/review/pipeline/harness-fixtures.ts');
const {topicTallies}=await import('./apps/server/src/review/guidelines/learned/votes.ts');
await initializeStorage();
const ids=['a','b','c','d'];
const topic={id:'category:correctness',label:'Correctness'};
const finding=id=>({id,title:'Drops the old value',file:'src/a.ts',line:1,severity:'warning',message:'[correctness] The old value is lost',category:'correctness',fingerprint:'print-'+id,topic});
const saveReview=async(id,findingIds)=>{await db.reviews.set(testReview({id,repoId:'repo-1',findings:findingIds.map(finding)}));await reviewDiffs.set(id,DIFF);};
const decide=(reviewId,findingId,method)=>app.request('/api/reviews/'+reviewId+'/findings/'+findingId+'/decision',{method,headers:{'content-type':'application/json'},body:method==='PUT'?JSON.stringify({state:'accepted'}):undefined});
const useful=async()=>(await settingsOperation(()=>topicTallies('repo-1').get(topic.id)))?.useful??0;
`;

test.skipIf(!url)('concurrent decisions on one review are each saved and counted once', async () => {
	if (!url) return;

	const output = await runCorrectnessProcess(
		url,
		setup +
			`
await saveReview('decided',ids);
const answers=await Promise.all(ids.map(id=>decide('decided',id,'PUT')));
const review=await db.reviews.get('decided');
console.log(JSON.stringify({statuses:answers.map(answer=>answer.status),decided:review.findings.filter(entry=>entry.decision).length,useful:await useful()}));
await closeStorage();
`
	);

	expect(resultOf(output)).toEqual({ statuses: [200, 200, 200, 200], decided: 4, useful: 4 });
});

test.skipIf(!url)('concurrent reopenings on one review each remove the decision and its vote', async () => {
	if (!url) return;

	const output = await runCorrectnessProcess(
		url,
		setup +
			`
await saveReview('reopened',ids);
for (const id of ids) await decide('reopened',id,'PUT');
const answers=await Promise.all(ids.map(id=>decide('reopened',id,'DELETE')));
const review=await db.reviews.get('reopened');
console.log(JSON.stringify({statuses:answers.map(answer=>answer.status),decided:review.findings.filter(entry=>entry.decision).length,useful:await useful()}));
await closeStorage();
`
	);

	expect(resultOf(output)).toEqual({ statuses: [200, 200, 200, 200], decided: 0, useful: 0 });
});

test.skipIf(!url)('a decision refused by a settings conflict on another review leaves nothing saved', async () => {
	if (!url) return;

	const output = await runCorrectnessProcess(
		url,
		setup +
			`
for (const id of ids) await saveReview('review-'+id,[id]);
const answers=await Promise.all(ids.map(id=>decide('review-'+id,id,'PUT')));
const saved=await Promise.all(ids.map(async id=>Boolean((await db.reviews.get('review-'+id)).findings[0].decision)));
const accepted=answers.map(answer=>answer.status===200);
console.log(JSON.stringify({statuses:answers.map(answer=>answer.status).filter(status=>status!==200&&status!==409),savedOnlyWhenAccepted:saved.every((decided,index)=>decided===accepted[index]),useful:(await useful())===accepted.filter(Boolean).length}));
await closeStorage();
`
	);

	expect(resultOf(output)).toEqual({ statuses: [], savedOnlyWhenAccepted: true, useful: true });
});
