"""Time-boxed, model-free reproductions of accepted but unpublished label claims."""
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path('/home/ubuntu/eval-work')
CASES = {
    'p-queue-3': ('d2', 'source/priority-queue.ts', 'group,', 'Group storage is newly introduced; setPriority re-enqueues without forwarding it.', """
import PQueue from './source/index.ts';
const q=new PQueue({autoStart:false}); const p=q.add(async()=>1,{id:'t1',group:'alpha'}).catch(()=>{});
const before=q.sizeBy({group:'alpha'}); q.setPriority('t1',2); const after=q.sizeBy({group:'alpha'});
console.log(JSON.stringify({before,after,expectedAfter:1})); q.clear();
if(before!==1||after!==0)process.exit(2);
"""),
    'python-slugify-3': ('d2', 'slugify/slugify.py', "normalization: NormalizationForm = 'default',", 'New keyword options reach unchanged legacy dispatch without the required rejection.', """
import json
from slugify import slugify
values=[slugify('café',normalization='NFD'),slugify('a b',separator_escape='\\\\')]
print(json.dumps(dict(actual=values,expected='ValueError for each modern-only option with legacy algorithm')))
assert values==['cafe','a-b']
"""),
    'p-limit-4': ('d3', 'index.js', 'cancelledPendingCount++;', 'New cancellation leaves a queued tombstone counted by the unchanged pendingCount getter.', """
import pLimit from './index.js';
const limit=pLimit(1); let release; let signal; const started=new Promise(r=>signal=r);
const active=limit(()=>new Promise(r=>{release=r;signal();})); await started;
const pending=limit.runKeyed('k1',()=>1).catch(()=>{}); const before=limit.pendingCount;
const cancelled=limit.cancelKey('k1'); const after=limit.pendingCount;
console.log(JSON.stringify({before,cancelled,after,expectedAfter:0})); release(); await active; await pending;
if(before!==1||cancelled!==true||after!==1)process.exit(2);
"""),
    'p-queue-4': ('d7', 'source/index.ts', 'this.#dedupe.register', 'New dedupe registration is not released by the unchanged clear waiting-task lifecycle.', """
import PQueue from './source/index.ts';
const q=new PQueue({autoStart:false}); let ran=false;
const first=q.add(async()=>1,{dedupeKey:'k'}).catch(e=>e.name); q.clear();
const hasAfterClear=q.hasDedupeKey('k'); const second=q.add(async()=>{ran=true;return 2;},{dedupeKey:'k'}).catch(e=>e.name);
q.start(); const errA=await first; const errB=await second;
console.log(JSON.stringify({errA,hasAfterClear,ran,errB,expectedKeyAfterClear:false}));
if(errA!=='AbortError'||!hasAfterClear||ran||errB!=='AbortError')process.exit(2);
""")}


def reproduce(root=ROOT):
    manifest=json.loads((root/'datasets/synth-rebuilt-v1/manifest.json').read_text())
    records=[]
    for ident,(did,file,needle,reason,script) in CASES.items():
        case=manifest['cases'][ident]; builder=root/'builders'/ident
        repo=root/'forges'/ident.rsplit('-',1)[0]
        changed=subprocess.check_output(['git','-C',str(repo),'diff','--name-only',case['baseSha'],case['headSha']],text=True).splitlines()
        for path in changed:
            expected=subprocess.check_output(['git','-C',str(repo),'show',case['headSha']+':'+path])
            assert expected==(builder/path).read_bytes(), (ident,path,'builder differs from published source')
        proposals=sorted((root/'private'/ident).glob('defects*.json'))
        proposal=next(d for d in json.loads(proposals[-1].read_text())['defects'] if d['id']==did)
        content=(builder/file).read_text().splitlines()
        anchors=[n for n,line in enumerate(content,1) if needle in line]
        assert anchors, (ident,needle)
        line=anchors[0]
        command=[str(root/'toolchains/python/bin/python'),'-c',script] if ident.startswith('python-') else ['bun','-e',script]
        try:
            result=subprocess.run(command,cwd=builder,text=True,capture_output=True,timeout=30)
            confirmed=result.returncode==0
            output=result.stdout+result.stderr
        except subprocess.TimeoutExpired:
            confirmed=False;output='Reproduction exceeded 30-second time box.'
        label=dict(proposal,originalLocation=dict(file=proposal['file'],line=proposal['line'],endLine=proposal.get('endLine')),
                   file=file,line=line,endLine=line,provenance='audit-omission-confirmed')
        record=dict(case=ident,defect=did,confirmed=confirmed,headSha=case['headSha'],baseSha=case['baseSha'],
                    changedFilesMatchPublished=changed,timeoutSeconds=30,script=script,output=output,
                    anchorReason=reason,label=label)
        records.append(record)
        print(ident,did,'CONFIRMED' if confirmed else 'UNCONFIRMED',output.strip(),flush=True)
    destination=root/'metrics/final-omissions.json'
    destination.write_text(json.dumps(records,indent=2)+'\n')
    return records


if __name__=='__main__': reproduce()
