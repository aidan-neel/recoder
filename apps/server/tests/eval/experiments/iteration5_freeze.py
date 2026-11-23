"""Freeze completed non-dev cases and publish four real upstream negative controls."""
import datetime
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path('/home/ubuntu/eval-work')
SOURCE = ROOT/'datasets/synth-rebuilt-v1'
TARGET = ROOT/'datasets/iteration5-heldout-v1'
CONTROLS = [
    ('chi-urlparam','chi','ae6be7469132cf471ca099d8c7bda4010c4ff7b2', ['go','test','./...'],
     'URLParam delegates to the already-identical nil-check and lookup in URLParamFromCtx. No behavior changes.'),
    ('chi-request-size','chi','c64ed7d6635f33a8b2feaff7dcfa55677023ac7d', ['go','test','./...'],
     'Adds table tests for existing RequestSize boundary behavior. No production-code changes; errors.As and status checks match the middleware contract.'),
    ('p-limit-context','p-limit','ce9d71cf1391edf2897cbb9e00b8bc4f091df8b1', ['npx','ava'],
     'Adds a shared-context helper test and documentation. No executable library changes; forwarding context uses the existing additional-arguments API.'),
    ('tenacity-classvar','tenacity','d6690dc06a0beebef9d91018d31fe42db11c2640', ['python','-m','pytest','-q'],
     'Annotates BaseAction and RetryAction class constants with ClassVar and enables the matching mypy check. Assignment values and methods are unchanged.')]


def git(repo, *args):
    return subprocess.check_output(['git','-C',str(repo),*args],text=True).strip()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def freeze():
    assert not TARGET.exists(), 'refuse to change a frozen dataset'
    manifest=json.loads((SOURCE/'manifest.json').read_text())
    dev=set(json.loads((SOURCE/'sets/dev-v0.json').read_text())['tasks'])
    labels={p.stem:json.loads(p.read_text()) for p in (SOURCE/'labels').glob('*.json')}
    eligible={k:v for k,v in labels.items() if k not in dev and k in manifest['cases'] and v['verified']
              and manifest['cases'][k].get('generation_models',{}).get('implementation','').startswith('swe-2-')
              and manifest['cases'][k].get('generation_models',{}).get('injection','').startswith('swe-2-')}
    assert eligible
    TARGET.mkdir(mode=0o700)
    for part in ['labels','sets','provenance']:(TARGET/part).mkdir()
    control_root=ROOT/'forges/iteration5-controls';control_root.mkdir(exist_ok=True)
    now=datetime.datetime.now(datetime.timezone.utc).isoformat()
    provenance={};cases={k:manifest['cases'][k] for k in eligible}
    for ident,repo,head,command,note in CONTROLS:
        ident='clean-'+ident;upstream=ROOT/'upstreams'/repo;forge=control_root/ident
        assert not forge.exists()
        subprocess.run(['git','clone','--no-hardlinks','--no-checkout',str(upstream),str(forge)],check=True,capture_output=True)
        base=git(forge,'rev-parse',head+'^');git(forge,'branch','benchmark-base',base);git(forge,'switch','-c','upstream-change',head)
        git(forge,'update-ref','refs/pull/1/head',head)
        title=git(forge,'show','-s','--format=%s',head)
        metadata=dict(defaultBranch='benchmark-base',issues=[],pulls=[dict(number=1,title=title,
            body=git(forge,'show','-s','--format=%B',head),author=git(forge,'show','-s','--format=%an',head),createdAt=now,
            state='open',headRef='upstream-change',baseRef='benchmark-base',baseSha=base)])
        (forge/'.git/recoder-forge.json').write_text(json.dumps(metadata,indent=2)+'\n')
        if repo=='p-limit':
            with (TARGET/'provenance'/f'{ident}-install.log').open('w') as log:
                subprocess.run(['npm','install','--ignore-scripts','--no-audit','--no-fund'],cwd=forge,stdout=log,stderr=subprocess.STDOUT,check=True)
        checks=[]
        for revision in [base,head]:
            git(forge,'switch','--detach',revision)
            log=TARGET/'provenance'/f'{ident}-{revision[:12]}-checks.log'
            with log.open('w') as stream:
                result=subprocess.run(command,cwd=forge,stdout=stream,stderr=subprocess.STDOUT)
            checks.append(dict(revision=revision,command=command,exitCode=result.returncode,log=str(log),sha256=digest(log.read_bytes())))
            assert result.returncode==0, f'{ident} check failed: {log}'
        git(forge,'switch','upstream-change')
        patch=subprocess.check_output(['git','-C',str(forge),'diff','--binary',base,head])
        patchfile=TARGET/'provenance'/f'{ident}.patch';patchfile.write_bytes(patch)
        provenance[ident]=dict(kind='real-upstream-commit',repository=repo,origin=git(upstream,'remote','get-url','origin'),
            baseSha=base,headSha=head,tree=git(forge,'rev-parse',head+'^{tree}'),title=title,manualAudit=note,checks=checks,patchSha256=digest(patch),patch=str(patchfile))
        eligible[ident]=dict(id=ident,codebase=repo,repo=forge.as_uri(),pull=1,headSha=head,verified=True,holdout=repo in ('chi','tenacity'),defects=[])
        cases[ident]=dict(baseSha=base,headSha=head,control=True,defects={},provenance=provenance[ident])
    for ident,label in eligible.items():
        source=SOURCE/'labels'/(ident+'.json')
        (TARGET/'labels'/(ident+'.json')).write_bytes(source.read_bytes() if source.exists() else (json.dumps(label,indent=2)+'\n').encode())
        if ident not in provenance:
            provenance[ident]=dict(kind='published-SWE-2-synthetic',source=str(source),sourceLabelSha256=digest(source.read_bytes()),
                generationModels=cases[ident]['generation_models'],audit=cases[ident]['audit'],
                generalization='repository-heldout' if label.get('holdout') else 'new-PR-same-repository')
    tasks=sorted(eligible)
    (TARGET/'manifest.json').write_text(json.dumps(dict(version='iteration5-heldout-v1',createdAt=now,upstreams=manifest['upstreams'],cases=cases,provenance=provenance),indent=2)+'\n')
    (TARGET/'adjudications.json').write_text('{}\n')
    (TARGET/'sets/heldout-v1.json').write_text(json.dumps(dict(name='heldout-v1',tasks=tasks,sources=[str(SOURCE)],selectedAt=now,
        rule='All completed, verified, manifest-published SWE-2 cases outside dev-v0 at selection; plus four audited real-upstream harmless changes. Repository-disjoint cases reported separately.'),indent=2)+'\n')
    files=[p for p in TARGET.rglob('*') if p.is_file()]
    hashes={str(p.relative_to(TARGET)):digest(p.read_bytes()) for p in files}
    (TARGET/'SHA256SUMS.json').write_text(json.dumps(hashes,indent=2,sort_keys=True)+'\n')
    for p in files+[TARGET/'SHA256SUMS.json']:p.chmod(0o444)
    print(json.dumps(dict(dataset=str(TARGET),tasks=tasks,prs=len(tasks),controls=len(CONTROLS),defects=sum(len(l['defects']) for l in eligible.values()),sha256=digest((TARGET/'SHA256SUMS.json').read_bytes())),indent=2))


if __name__=='__main__':freeze()
