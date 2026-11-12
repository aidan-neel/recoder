import { expect, test } from 'bun:test';
import { runCorrectnessProcess } from './ha-correctness-process';

const url = process.env.RECODER_POSTGRES_TEST_URL;

test.skipIf(!url)(
	'an acknowledged chat stop survives executor death before its reply is saved',
	async () => {
		if (!url) return;

		const output = await runCorrectnessProcess(
			url,
			`
import assert from 'node:assert/strict';
import {HaProcesses,eventually} from './apps/server/tests/integration/ha-processes.ts';
import {localForgeFixture} from './apps/server/tests/helpers/local-forge.ts';
import {ORCHESTRATOR_ID} from './packages/shared/src/index.ts';
import {fileURLToPath} from 'node:url';
import {rm} from 'node:fs/promises';
let requests=0;
const gate=Promise.withResolvers();
const model=Bun.serve({port:0,hostname:'127.0.0.1',idleTimeout:0,async fetch(request){
 if(request.method==='GET')return Response.json({data:[{id:'chat-model'}]});
 await request.json();
 if(++requests===1)await gate.promise;
 return new Response('data: '+JSON.stringify({choices:[{delta:{content:'Shared reply.'}}]})+'\\n\\ndata: [DONE]\\n\\n',{headers:{'content-type':'text/event-stream'}});
}});
const processes=new HaProcesses(process.env.RECODER_DATABASE_URL);
let fixture;
let release=()=>{};
let locked;
try{
 await processes.initialize();
 const a=await processes.start('replica-a');
 fixture=await localForgeFixture();
 const repo=await a.json('/api/repos',{method:'POST',body:JSON.stringify({name:'fixture',url:fixture.repo.url,provider:'local',defaultBranch:'main'})});
 const draft=await a.json('/api/reviews',{method:'POST',body:JSON.stringify({repoId:repo.id,prNumber:7,start:false})});
 await processes.database\`UPDATE recoder_records SET value=jsonb_set(value,'{status}','"passed"') WHERE collection='reviews' AND id=\${draft.id}\`;
 await a.json('/api/settings/models',{method:'PUT',body:JSON.stringify({baseUrl:'http://127.0.0.1:'+model.port+'/v1',apiKey:'test',models:[{id:'chat-model',label:'chat',model:'chat-model'}],orchestratorModelId:'chat-model',specialistModelId:'chat-model'})});
 const b=await processes.start('replica-b');
 const message=await a.json('/api/reviews/'+draft.id+'/chat',{method:'POST',body:JSON.stringify({assignmentId:ORCHESTRATOR_ID,text:'Explain this.'})});
 const readMessages=async()=>{
  const rows=await processes.database\`SELECT value FROM recoder_records WHERE collection='review_progress' AND id=\${draft.id}\`;
  return rows[0]?.value.messages??[];
 };
 await eventually(async()=>requests===1&&(await readMessages()).some(item=>item.id==='reply_'+message.id&&item.status==='streaming'),'No initial chat');
 await processes.database\`UPDATE recoder_records SET value=jsonb_set(value,'{reasoning}',jsonb_build_array(jsonb_build_object('id',\${'reason_reply_'+message.id}::text,'text','Partial reasoning','status','streaming','model','chat-model','role','orchestrator','at','2026-01-01T00:00:00Z'))) WHERE collection='review_progress' AND id=\${draft.id}\`;
 const [row]=await processes.database\`SELECT owner_id FROM review_actor_leases WHERE review_id=\${draft.id}\`;
 const owner=row.owner_id==='replica-a'?a:b;
 const peer=owner===a?b:a;
 const entered=Promise.withResolvers();
 const unlock=Promise.withResolvers();
 release=unlock.resolve;
 locked=processes.database.begin(async transaction=>{
  await transaction\`SELECT id FROM recoder_records WHERE collection='review_progress' AND id=\${draft.id} FOR UPDATE\`;
  entered.resolve();
  await unlock.promise;
 });
 await entered.promise;
 await peer.json('/api/reviews/'+draft.id+'/chat/stop',{method:'POST',body:JSON.stringify({assignmentId:ORCHESTRATOR_ID})});
 await eventually(async()=>{
  const rows=await processes.database\`SELECT command_id FROM review_actor_commands WHERE review_id=\${draft.id} AND command->>'kind'='stop-chat' AND acknowledged_at IS NOT NULL\`;
  return rows.length===1;
 },'Stop was not acknowledged');
 await owner.kill();
 unlock.resolve();
 await locked;
 await eventually(async()=>(await readMessages()).some(item=>item.id==='reply_'+message.id&&item.status==='error'&&item.text.endsWith('Reply stopped.')),'Stopped reply did not recover');
 await eventually(async()=>{
  const rows=await processes.database\`SELECT command_id FROM review_actor_commands WHERE review_id=\${draft.id} AND acknowledged_at IS NULL\`;
  return rows.length===0;
 },'Stopped chat was not acknowledged');
 assert.equal(requests,1,'A stopped model request was repeated after takeover');
 const [progress]=await processes.database\`SELECT value FROM recoder_records WHERE collection='review_progress' AND id=\${draft.id}\`;
 assert.equal(progress.value.reasoning[0].status,'error');
 const next=await peer.json('/api/reviews/'+draft.id+'/chat',{method:'POST',body:JSON.stringify({assignmentId:ORCHESTRATOR_ID,text:'A new message.'})});
 await eventually(async()=>(await readMessages()).some(item=>item.id==='reply_'+next.id&&item.status==='done'),'A new message was incorrectly stopped');
 assert.equal(requests,2);
 console.log('stopped reply stayed stopped');
}finally{
 release();
 if(locked)await locked.catch(()=>{});
 gate.resolve();
 await model.stop(true);
 await processes.close();
 if(fixture)await rm(fileURLToPath(fixture.repo.url),{recursive:true,force:true});
}
`
		);

		expect(output).toContain('stopped reply stayed stopped');
	},
	15_000
);
