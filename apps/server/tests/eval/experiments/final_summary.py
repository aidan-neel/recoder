"""Score identical saved reviews against primary and continuity label populations."""
import argparse
from collections import Counter
import copy
import json
from pathlib import Path
import statistics
import sys

sys.path.insert(0, '/home/ubuntu/eval-work/scripts')
from verifier_ab_summary import summarize
from iteration5_benchmark import verify_hashes
from iteration5_metrics import adjudicated_class, precision_bounds
from iteration3_summary import denied_events, timestamp

STAGES=('found','verified','published')


def project(report, labels):
    result=copy.deepcopy(report)
    for pr in result['prs']:
        original={d['id'] for d in pr['defects']}
        selected={d['id'] for d in labels[pr['id']]['defects']}
        assert selected <= original, 'view is not a subset of the judged primary population'
        pr['defects']=labels[pr['id']]['defects']
        for run in pr['runs']:
            assert set(run['stages']) == original, 'incomplete stage judgement'
            assert all(all(type(e[s]) is bool for s in STAGES) for e in run['stages'].values())
            for defect in original-selected:
                index=run['score']['found'].get(defect)
                if index is not None:
                    assert run['labeled']['classes'][index]=='planted'
                    run['labeled']['classes'][index]='additional'
            run['stages']={d:e for d,e in run['stages'].items() if d in selected}
    return result


def sample(report, labels, manifest, arm, overlay):
    projected=project(report,labels)
    classes=[]; controlclasses=[]; controlrows=[]; groups={}; unknown=0
    for pr in projected['prs']:
        control=not pr['defects']
        meta=manifest['provenance'][pr['id']]['membership']
        keys=['all','repository:'+meta['repository'],'evaluation:'+meta['evaluation'],'generator:'+meta['generator']]
        for run in pr['runs']:
            row=[]
            for index,kind in enumerate(run['labeled']['classes']):
                kind=adjudicated_class(kind,overlay.get(run['reviewId']+':'+str(index)))
                row.append(kind)
            run['labeled']['classes']=row
            classes.extend(row)
            if control:
                controlclasses.extend(row)
                controlrows.append(dict(case=pr['id'],reviewId=run['reviewId'],classes=dict(Counter(row)),findings=len(row)))
            for token in run['reviewer']['tokens']:
                assert all(type(token[k]) is int and token[k]>=0 for k in ('input','cached','output','unknownCalls'))
                unknown+=token['unknownCalls']
            for key in keys:
                group=groups.setdefault(key,dict(prs=0,defects=0,found=0,verified=0,published=0,controlFalse=0))
                group['prs']+=1;group['defects']+=len(pr['defects'])
                if control: group['controlFalse']+=row.count('false')
                for evidence in run['stages'].values():
                    for stage in STAGES:group[stage]+=evidence[stage]
    stats=summarize(projected)
    stats.update(sample=arm,arm=arm.split('-')[0],groups=groups,unknown_calls=unknown,
                 precision=precision_bounds(classes),controls=dict(prs=len(controlrows),classes=dict(Counter(controlclasses)),
                 findings=len(controlclasses),false_prs=sum(r['classes'].get('false',0)>0 for r in controlrows),
                 precision=precision_bounds(controlclasses),rows=controlrows))
    return stats


def render(values):
    if None in values:return 'undefined'
    def number(n):return f'{n:,.2f}'.rstrip('0').rstrip('.') if n%1 else f'{int(n):,}'
    mean=number(statistics.mean(values))
    return mean if len(values)==1 else mean+' ['+number(min(values))+', '+number(max(values))+']'


def precision_percent(stats, scope, bound):
    value=stats['precision'] if scope=='overall' else stats['controls']['precision']
    return value[bound]*100 if value is not None else None


def write_summary(directories, destination):
    destination.mkdir(exist_ok=True)
    frozen=Path('/home/ubuntu/eval-work/datasets/final-v1');verify_hashes(frozen)
    manifest=json.loads((frozen/'manifest.json').read_text())
    views={'primary':frozen,'continuity':frozen/'views/continuity'}
    overlayfile=destination/'adjudication-overlay.json'
    overlay=json.loads(overlayfile.read_text()) if overlayfile.exists() else {}
    samples={v:[] for v in views};review_ids=[];sources=[];observed=set()
    for directory in directories:
        state=json.loads((directory/'state.json').read_text())
        assert state.get('finished_at') and all(a['status']=='completed' and a['ledger_exit_code']==0 for a in state['arms'])
        for arm in state['arms']:
            files=list((directory/(arm['arm']+'-attempt'+str(arm['attempt'])+'-reports')).glob('*.json'))
            assert len(files)==1
            report=json.loads(files[0].read_text());sources.append(str(files[0]))
            assert len(report['prs'])==34
            denied,raw,unreadable=denied_events(directory,timestamp(report['startedAt']),timestamp(report['finishedAt']))
            for pr in report['prs']:
                for run in pr['runs']:
                    review_ids.append(run['reviewId'])
                    observed.update(run['reviewId']+':'+str(i) for i in range(len(run['findings'])))
            for view,folder in views.items():
                labels={p.stem:json.loads(p.read_text()) for p in (folder/'labels').glob('*.json')}
                stats=sample(report,labels,manifest,arm['arm'],overlay)
                stats.update(denied_builtins=sum(e['verifier'] for e in denied),raw_verifier_sessions=len(raw),unreadable_exports=unreadable,
                             wall_seconds=(timestamp(report['finishedAt'])-timestamp(report['startedAt']))/1000)
                samples[view].append(stats)
    assert len(review_ids)==len(set(review_ids))
    assert set(overlay)<=observed
    ledger=[json.loads(line) for line in Path('/home/ubuntu/eval-work/metrics/ledger.jsonl').read_text().splitlines()]
    counts=Counter(row.get('review_id') for row in ledger)
    assert all(counts[r]==1 for r in review_ids), 'review not ingested exactly once'
    arms=list(dict.fromkeys(s['arm'] for s in samples['primary']))
    lines=['# Final frozen benchmark','',
           'Identical reviews are judged once against primary labels. Continuity is a deterministic subset projection of those fixed matches, not a second stochastic judging run. Confirmed omission hits are additional true findings under continuity, never false. No derived view is ingested again.',
           '', 'Cells: mean [min, max], with two samples for A/F and one for Neon. Cached input is within input; known token subtotals exclude judging and exclude unknown-usage calls in full. Unresolved findings are not automatically false. These are descriptive results, not confidence intervals.','']
    tables={}
    for view,rows in samples.items():
        total=rows[0]['defects'];assert all(s['defects']==total for s in rows)
        fields={f'Candidate /{total}':lambda s:s['recall']['found'],f'Verified /{total}':lambda s:s['recall']['verified'],
                f'Published /{total}':lambda s:s['recall']['published'],
                'Adjudicated false':lambda s:s['findings'].get('false',0),'Unresolved':lambda s:s['findings'].get('unresolved',0),
                'Duplicate':lambda s:s['findings'].get('duplicate',0),
                'Control false findings':lambda s:s['controls']['classes'].get('false',0),
                'Control unresolved findings':lambda s:s['controls']['classes'].get('unresolved',0),
                'Findings/control':lambda s:s['controls']['findings']/s['controls']['prs'],
                'Controls with false findings /9':lambda s:s['controls']['false_prs'],
                'p50 seconds':lambda s:s['latency_ms']['0.5']/1000,'p95 seconds':lambda s:s['latency_ms']['0.95']/1000,
                'Benchmark wall minutes':lambda s:s['wall_seconds']/60,
                'Known input subtotal':lambda s:s['tokens']['input'],'Known cached subtotal':lambda s:s['tokens']['cached'],
                'Known output subtotal':lambda s:s['tokens']['output'],'Excluded unknown calls':lambda s:s['unknown_calls'],
                'Verifier operations':lambda s:s['verifier']['ops'],'Verifier sessions':lambda s:s['verifier']['sessions'],
                'Failed model calls':lambda s:s['failed_calls'],
                'Exhausted verifier sessions':lambda s:s['verifier']['exhausted'],
                'MCP gate refusals':lambda s:s['verifier']['refusals'],
                'Refusals/session':lambda s:s['verifier']['refusals']/s['verifier']['sessions'],
                'Observed verifier built-in denials':lambda s:s['denied_builtins'],
                f'Scored not found /{total}':lambda s:sum(not d['found'] for d in s['by_defect'].values()),
                f'Found but unverified /{total}':lambda s:sum(d['found'] and not d['verified'] for d in s['by_defect'].values()),
                f'Verified but unpublished /{total}':lambda s:sum(d['verified'] and not d['published'] for d in s['by_defect'].values())}
        fields[f'Published without runtime verification /{total}']=lambda s:sum(d['published'] and not d['verified'] for d in s['by_defect'].values())
        for scope in ('overall','controls'):
            for bound in ('lower','upper'):
                fields[f'{scope} precision {bound} %']=lambda s,scope=scope,bound=bound:precision_percent(s,scope,bound)
        for key,group in rows[0]['groups'].items():
            if key=='all' or not group['defects']:continue
            for stage in STAGES:
                fields[f"{key} {stage} /{group['defects']}"]=lambda s,key=key,stage=stage:s['groups'][key][stage]
        table=['| Metric | '+' | '.join(arms)+' |','|---|'+'---:|'*len(arms)]
        aggregates={}
        for name,measure in fields.items():
            values={arm:[measure(s) for s in rows if s['arm']==arm] for arm in arms}
            aggregates[name]=values
            table.append('| '+name+' | '+' | '.join(render(values[a]) for a in arms)+' |')
        tables[view]=aggregates
        lines+=['## '+view.title()+f' ({total} labels)','']+table+['']
    result=dict(samples=samples,tables=tables,reviewIds=review_ids,sources=sources,ledgerExactlyOnce=True,
                frozenHash=__import__('hashlib').sha256((frozen/'SHA256SUMS.json').read_bytes()).hexdigest())
    (destination/'comparison.json').write_text(json.dumps(result,indent=2)+'\n')
    (destination/'comparison.md').write_text('\n'.join(lines)+'\n')
    print(f'Final scoring PASS: {len(review_ids)} unique ingested reviews; primary and continuity views; '+str(destination))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('directories',type=Path,nargs='+');parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();write_summary(args.directories,args.output)
