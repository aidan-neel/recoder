"""Run the approved fixed six-PR verifier experiment; preserve failures and every report."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
from smoke_baseline import api, PICKS

ROOT = Path('/home/ubuntu/eval-work')
REPO = Path('/home/ubuntu/repos/recoder')
DATA = ROOT/'datasets/synth-rebuilt-v1'
PAUSE = ROOT/'generation/benchmark.pause'
FLAGS = ['RECODER_VERIFIER_OP_BUDGET','RECODER_VERIFIER_COMPACT','RECODER_DEVIN_MCP_ONLY','RECODER_VERIFIER_SESSION_FIXES']


def generation_active():
    for p in Path('/proc').iterdir():
        if p.name.isdigit():
            try:
                argv = (p/'cmdline').read_bytes().split(b'\0')
                if len(argv)>1 and argv[1] == str(ROOT/'scripts/model_call.py').encode():
                    return True
            except (FileNotFoundError,ProcessLookupError,PermissionError):
                pass
    return False


def stop_isolated_server():
    listeners = subprocess.check_output(['ss','-ltnpH','sport = :3201'],text=True)
    pids = {int(pid) for pid in re.findall(r'pid=(\d+)',listeners)}
    if not pids:
        return
    if len(pids) != 1:
        raise RuntimeError('ambiguous listener ownership on port 3201')
    pid = pids.pop()
    process = Path('/proc')/str(pid)
    argv = (process/'cmdline').read_bytes().split(b'\0')
    expected = ('RECODER_DATA_DIR='+str(ROOT/'server-data')).encode()
    if expected not in (process/'environ').read_bytes().split(b'\0') or len(argv)<2 or argv[1] != b'src/index.ts':
        raise RuntimeError('port 3201 is not the expected isolated Recoder server')
    os.kill(pid,signal.SIGTERM)
    until = time.monotonic()+30
    while process.exists() and time.monotonic()<until:
        time.sleep(.2)
    if process.exists():
        raise RuntimeError('isolated server did not terminate; refusing to start another listener')


def main(plan=None, prefix='verifier-ab', dataset=None, set_name='dev-v0', immutable_dataset=False):
    data = Path(dataset) if dataset is not None else DATA
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    work = ROOT/'metrics'/(prefix+'-'+stamp)
    work.mkdir(mode=0o700)
    env = dict(os.environ,HOST='127.0.0.1',PORT='3201',RECODER_DATA_DIR=str(ROOT/'server-data'),RECODER_WORKDIR=str(ROOT/'server-work'))
    env['RECODER_DEVIN_EXPORT_DIR'] = str(work/'raw-exports')
    for flag in FLAGS + ['RECODER_SKIP_UNUSED_EXPORTS']:
        env.pop(flag,None)
    tasks = json.loads((data/'sets'/(set_name+'.json')).read_text())['tasks']
    frozen = {task:hashlib.sha256((data/'labels'/(task+'.json')).read_bytes()).hexdigest() for task in tasks}
    paused = os.environ.get('VERIFIER_AB_START_PAUSED') == '1'
    assert not PAUSE.exists() or paused, 'another benchmark owns the generation pause'
    if paused:
        PAUSE.write_text('Verifier benchmark '+str(work)+'\n')
        while generation_active():
            time.sleep(1)
    original = {k:api('/api/settings/models').get(k) for k in PICKS}
    state = dict(started_at=stamp,work=str(work),tasks=tasks,label_hashes=frozen,arms=[],generation_paused=paused,
                 source_commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip(),budget=8 if plan is None else None,baseline_cache=False,dataset=str(data),set_name=set_name)
    child = None
    def save():
        temp = work/'state.new'
        temp.write_text(json.dumps(state,indent=2)+'\n')
        temp.replace(work/'state.json')
    def start(flags,label):
        nonlocal child
        if child is not None:
            child.terminate()
            try:
                child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                child.kill();child.wait()
        else:
            stop_isolated_server()
        log = (work/(label+'-server.log')).open('w')
        child = subprocess.Popen(['/home/ubuntu/.bun/bin/bun','src/index.ts'],cwd=REPO/'apps/server',env=dict(env,**flags),stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        log.close()
        state['server_pid']=child.pid;state['server_flags']=flags;save()
        until=time.monotonic()+90
        while time.monotonic()<until:
            if child.poll() is not None:
                raise RuntimeError('isolated server exited; see '+label+'-server.log')
            try:
                api('/api/repos');break
            except Exception:
                time.sleep(.3)
        else:
            raise RuntimeError('isolated server readiness deadline')
        picks={k:'devin:swe-2-flash-medium' for k in PICKS}
        result=api('/api/settings/models',picks,method='PATCH')
        assert all(result.get(k)==v for k,v in picks.items())
        registered={r['url'] for r in api('/api/repos')}
        for task in tasks:
            label_json=json.loads((data/'labels'/(task+'.json')).read_text())
            if label_json['repo'] not in registered:
                api('/api/repos',dict(name=label_json['codebase'],url=label_json['repo'],provider='local'),method='POST')
                registered.add(label_json['repo'])
    save()
    print('Artifacts:',work,flush=True)
    try:
        for name,flags in (plan if plan is not None else [('A',{}),('B',{'RECODER_VERIFIER_OP_BUDGET':'8'}),('C',{'RECODER_VERIFIER_OP_BUDGET':'8','RECODER_VERIFIER_COMPACT':'1'})]):
            for attempt in range(1,3):
                label=f'dev-v0-{name}-op8-compact{int(name=="C")}' if name!='A' else 'dev-v0-A-baseline'
                if plan is not None:
                    label=f'{prefix}-{name}'
                tag=f'{name}-attempt{attempt}'
                arm_data = work/(tag+'-dataset') if immutable_dataset else data
                if immutable_dataset:
                    shutil.copytree(data, arm_data)
                    (arm_data/'adjudications.json').chmod(0o600)
                start(flags,tag)
                assert all(hashlib.sha256((data/'labels'/(t+'.json')).read_bytes()).hexdigest()==frozen[t] for t in tasks)
                before=set((ROOT/'server-data/evals').glob('*.json'))
                record=dict(arm=name,attempt=attempt,label=label,flags=flags,status='running',generation_paused=state['generation_paused'],dataset=str(arm_data))
                state['arms'].append(record);save()
                print('Starting',tag,flags,'generation paused:',state['generation_paused'],flush=True)
                command=['/home/ubuntu/.bun/bin/bun','run','--filter','@recoder/server','eval:benchmark','--','--dataset',str(arm_data),'--set',set_name,'--base','http://127.0.0.1:3201','--runs','1','--concurrency','1','--timeout','45','--judge','devin:swe-2-medium','--no-baseline-cache']
                output=work/(tag+'-benchmark.log')
                with output.open('w') as log:
                    result=subprocess.run(command,cwd=REPO,env=env,stdout=log,stderr=subprocess.STDOUT)
                reports=sorted(set((ROOT/'server-data/evals').glob('*.json'))-before)
                isolated=work/(tag+'-reports');isolated.mkdir()
                parsed=[]
                for path in reports:
                    shutil.copy2(path,isolated/path.name)
                    parsed.append(json.loads(path.read_text()))
                runs=[run for report in parsed for pr in report.get('prs',[]) for run in pr.get('runs',[])]
                verifier_sessions=sum(len(run.get('reviewer',{}).get('verifierSessions',[])) for run in runs)
                good=result.returncode==0 and len(runs)==len(tasks) and all(run.get('outcome') in ('passed','completed') for run in runs)
                if plan is not None and not verifier_sessions:
                    good=False
                text=output.read_text()+'\n'+json.dumps(parsed)
                throttled=not good and bool(re.search(r'rate.?limit|too many requests|\b429\b',text,re.I))
                record.update(status='completed' if good else 'failed',exit_code=result.returncode,reports=[str(p) for p in reports],outcomes=[r.get('outcome') for r in runs],rate_limit_failure=throttled)
                config_label=label if good else label+'-failed-overlap' if not state['generation_paused'] else label+'-failed-paused'
                ingest=subprocess.run([sys.executable,str(ROOT/'scripts/ledger.py'),'--reports',str(isolated),'--config-label',config_label,'--notes',f'Fixed {set_name}; dataset={data}; all picks Flash Medium; judge SWE-2 Medium; flags={json.dumps(flags,sort_keys=True)}; generation paused={state["generation_paused"]}; attempt={attempt}.'],capture_output=True,text=True,env=env)
                (work/(tag+'-ledger.log')).write_text(ingest.stdout+ingest.stderr)
                record['ledger_exit_code']=ingest.returncode;save()
                print('Finished',tag,'good:',good,'outcomes:',record['outcomes'],'ledger:',ingest.returncode,flush=True)
                if ingest.returncode:
                    raise RuntimeError('ledger ingestion failed; see '+tag+'-ledger.log')
                if good:
                    break
                if not throttled:
                    raise RuntimeError('incomplete or sandbox-invalid benchmark sample; no further arms')
                if state['generation_paused'] or attempt==2:
                    raise RuntimeError('rate limit persisted with generation paused; no further benchmark retries')
                PAUSE.write_text('Verifier dev-v0 benchmark; '+str(work)+'\n')
                state['generation_paused']=True;save()
                print('Rate limiting broke the overlap arm; waiting for the active generation call to finish before retrying.',flush=True)
                while generation_active():
                    time.sleep(1)
        state['finished_at']=datetime.datetime.now(datetime.timezone.utc).isoformat();save()
    finally:
        if state['generation_paused']:
            PAUSE.unlink(missing_ok=True)
            state['generation_released']=True
        if child is not None:
            start({},'restored-baseline')
            api('/api/settings/models',original,method='PATCH')
            state['restored_picks']=True
        save()
        print('Final state:',work/'state.json',flush=True)


if __name__=='__main__':
    main()
