"""Held-out recall, clean-control noise, precision bounds and exact audit inputs."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import statistics
import sys

ROOT=Path('/home/ubuntu/eval-work')
sys.path.insert(0,str(ROOT/'scripts'))
sys.path.insert(0,'/home/ubuntu/repos/recoder/apps/server/tests/eval/experiments')
from iteration3_summary import denied_events,timestamp,fmt
from iteration5_metrics import adjudicated_class, precision_bounds
from verifier_ab_summary import summarize
from ledger import quantile


def summary(directory):
    state=json.loads((directory/'state.json').read_text())
    assert state.get('generation_released') and state.get('finished_at')
    assert len(state['arms'])==4 and all(a['status']=='completed' and a['ledger_exit_code']==0 for a in state['arms'])
    frozen=Path(state['dataset']);manifest=json.loads((frozen/'manifest.json').read_text())
    for file,digest in json.loads((frozen/'SHA256SUMS.json').read_text()).items():
        assert hashlib.sha256((frozen/file).read_bytes()).hexdigest()==digest,file
    overlayfile=directory/'adjudication-overlay.json'
    overlay=json.loads(overlayfile.read_text()) if overlayfile.exists() else {}
    samples=[];controls=[];unmatched=[];misses=[];sessions=[];events=[];observed=set()
    for arm in state['arms']:
        reportfiles=list((directory/(arm['arm']+'-attempt'+str(arm['attempt'])+'-reports')).glob('*.json'));assert len(reportfiles)==1
        report=json.loads(reportfiles[0].read_text());s=summarize(report);classes=[];controlclasses=[];rawclasses=[];controlraw=[]
        unknown=Counter();strata={};controlrows=[];case_durations=[]
        for pr in report['prs']:
            label=json.loads((frozen/'labels'/(pr['id']+'.json')).read_text());control=not label['defects']
            stratum='control' if control else manifest['provenance'][pr['id']]['generalization']
            group=strata.setdefault(stratum,dict(defects=0,found=0,verified=0,published=0))
            group['defects']+=len(label['defects'])
            for run in pr['runs']:
                if not control:case_durations.append(run['durationMs'])
                rowclasses=[];original=run['labeled']['classes'];assert len(original)==len(run['findings'])
                for i,(finding,kind) in enumerate(zip(run['findings'],original)):
                    key=f'{run["reviewId"]}:{i}';observed.add(key);decision=overlay.get(key)
                    final=adjudicated_class(kind,decision)
                    rowclasses.append(final);classes.append(final);rawclasses.append(kind)
                    if control or kind=='unresolved':unmatched.append(dict(key=key,sample=arm['arm'],pr=pr['id'],control=control,originalClass=kind,finalClass=final,finding=finding,adjudication=decision))
                if control:
                    controlclasses+=rowclasses;controlraw+=original
                    record=dict(sample=arm['arm'],pr=pr['id'],reviewId=run['reviewId'],findings=len(rowclasses),classes=dict(Counter(rowclasses)),rawClasses=dict(Counter(original)),durationMs=run['durationMs'])
                    controls.append(record);controlrows.append(record)
                for row in run['reviewer']['tokens']:unknown[row['stage']]+=row['unknownCalls']
                for session in run['reviewer'].get('verifierSessions',[]):sessions.append(dict(sample=arm['arm'],pr=pr['id'],reviewId=run['reviewId'],**session))
                for defect,evidence in run.get('stages',{}).items():
                    for stage in ('found','verified','published'):group[stage]+=bool(evidence[stage])
                    if not evidence['found'] or not evidence['verified'] or not evidence['published']:
                        best=(evidence.get('matches',{}).get('verified',{}).get('claim') or evidence.get('matches',{}).get('found',{}).get('claim'))
                        candidate=next((c for c in run.get('pool',[]) if best and c.get('id')==best.get('id')),None)
                        misses.append(dict(sample=arm['arm'],pr=pr['id'],defect=defect,evidence=evidence,candidate=candidate))
        denied,raw_sessions,unreadable=denied_events(directory,timestamp(report['startedAt']),timestamp(report['finishedAt']))
        events.extend(dict(sample=arm['arm'],**e) for e in denied)
        v=s['verifier'];assert v['sessions']>0
        s.update(sample=arm['arm'],arm=arm['arm'][0],source=str(reportfiles[0]),strata=strata,
            findings=dict(Counter(classes)),raw_findings=dict(Counter(rawclasses)),precision=precision_bounds(classes),raw_precision=precision_bounds(rawclasses),
            controls=dict(prs=len(controlrows),classes=dict(Counter(controlclasses)),rawClasses=dict(Counter(controlraw)),findings=len(controlclasses),findings_per_control=len(controlclasses)/len(controlrows),
                precision=precision_bounds(controlclasses),rawPrecision=precision_bounds(controlraw),false_prs=sum(r['classes'].get('false',0)>0 for r in controlrows),
                false_or_unresolved_prs=sum(r['classes'].get('false',0)+r['classes'].get('unresolved',0)>0 for r in controlrows)),
            unknown_calls=sum(unknown.values()),unknown_by_stage=dict(unknown),refusals_per_session=v['refusals']/v['sessions'],
            denied_builtins=sum(e['verifier'] for e in denied),raw_verifier_sessions=len(raw_sessions),unreadable_exports=unreadable,
            case_latency_ms={str(q):quantile(case_durations,q) for q in (.5,.95)})
        samples.append(s)
    assert set(overlay)<=observed,'overlay refers to unobserved findings'
    assert Counter(s['arm'] for s in samples)=={'A':2,'F':2}
    fields={
        'Candidate /59':lambda s:s['recall']['found'],'Verified /59':lambda s:s['recall']['verified'],'Published /59':lambda s:s['recall']['published'],
        'Adjudicated false':lambda s:s['findings'].get('false',0),'Unresolved':lambda s:s['findings'].get('unresolved',0),'Duplicate':lambda s:s['findings'].get('duplicate',0),
        'p50 seconds (all PRs)':lambda s:s['latency_ms']['0.5']/1000,'p95 seconds (all PRs)':lambda s:s['latency_ms']['0.95']/1000,
        'p50 seconds (synthetic only)':lambda s:s['case_latency_ms']['0.5']/1000,'p95 seconds (synthetic only)':lambda s:s['case_latency_ms']['0.95']/1000,
        'Input known subtotal':lambda s:s['tokens'].get('input',0),'Cached known subtotal':lambda s:s['tokens'].get('cached',0),'Output known subtotal':lambda s:s['tokens'].get('output',0),
        'Excluded unknown calls':lambda s:s['unknown_calls'],'Verifier ops':lambda s:s['verifier']['ops'],'MCP gate refusals':lambda s:s['verifier']['refusals'],
        'Verifier sessions':lambda s:s['verifier']['sessions'],'MCP refusals/session':lambda s:s['refusals_per_session'],'Denied builtin events (verifier)':lambda s:s['denied_builtins'],
        'Control false findings':lambda s:s['controls']['classes'].get('false',0),'Control unresolved findings':lambda s:s['controls']['classes'].get('unresolved',0),
        'Findings/control':lambda s:s['controls']['findings_per_control'],'Controls with false findings /4':lambda s:s['controls']['false_prs'],
        'Controls with false OR unresolved /4':lambda s:s['controls']['false_or_unresolved_prs']}
    for stratum,title,total in [('repository-heldout','Repo-disjoint',37),('new-PR-same-repository','Tuned-repo',22)]:
        for stage in ('found','verified','published'):
            fields[f'{title} {stage} /{total}']=lambda s,g=stratum,k=stage:s['strata'][g][k]
    for scope in ('overall','controls'):
        for bound in ('lower','upper'):
            fields[f'{scope.title()} precision {bound} %']=lambda s,g=scope,k=bound:precision_percent(s,g,k)
    fields['Scored not found /59']=lambda s:sum(not d['found'] for d in s['by_defect'].values())
    fields['Found but unverified /59']=lambda s:sum(d['found'] and not d['verified'] for d in s['by_defect'].values())
    fields['Verified but unpublished /59']=lambda s:sum(d['verified'] and not d['published'] for d in s['by_defect'].values())
    aggregates={};lines=['## Results','',f'Artifacts: `{directory}`; experiment commit `{state["source_commit"]}`. Four completed samples, 60 reviews ingested. Cells: mean [min, max] over two samples. Application policy unchanged. Cached input is included in input; tokens exclude judge calls. Unknown-input/output calls are excluded in full, never treated as zero. These are accounting bounds, not confidence intervals.','', '| Metric | A legacy | F defaults |','|---|---:|---:|']
    for name,measure in fields.items():
        values={arm:[measure(s) for s in samples if s['arm']==arm] for arm in 'AF'}
        for arm in 'AF':aggregates.setdefault(arm,{})[name]=None if None in values[arm] else dict(mean=statistics.mean(values[arm]),min=min(values[arm]),max=max(values[arm]))
        render=(lambda a:f'{statistics.mean(a):.3f} [{min(a):.3f}, {max(a):.3f}]') if name=='MCP refusals/session' else fmt
        if name=='Findings/control':render=lambda a:f'{statistics.mean(a):.2f} [{min(a):.2f}, {max(a):.2f}]'
        lines.append('| '+name+' | '+' | '.join('undefined (empty sample)' if None in values[a] else render(values[a]) for a in 'AF')+' |')
    lines += ['','### Precision intervals','','TP = planted + adjudicated additional; U = unresolved; N = all published findings including duplicates. Lower TP/N; upper (TP+U)/N. Empty N is undefined, not 100%. The raw intervals precede any overlay.','', '| Sample | Raw overall | Post-audit overall | Raw controls | Post-audit controls |','|---|---|---|---|---|']
    def interval(x):return f'{100*x["lower"]:.1f}%–{100*x["upper"]:.1f}% (N={x["published"]}, U={x["unresolved"]})' if x else 'undefined (N=0)'
    for s in samples:lines.append('| '+s['sample']+' | '+' | '.join(interval(v) for v in [s['raw_precision'],s['precision'],s['controls']['rawPrecision'],s['controls']['precision']])+' |')
    lines += ['','### Generalization strata','','| Sample | Repository-heldout F/V/P /37 | New PR, tuned repo F/V/P /22 |','|---|---|---|']
    for s in samples:lines.append('| '+s['sample']+' | '+' | '.join('/'.join(str(s['strata'][stratum][stage]) for stage in ('found','verified','published')) for stratum in ('repository-heldout','new-PR-same-repository'))+' |')
    lines += ['','### Every control run','','| Sample | Control | Findings | False | Unresolved | Additional |','|---|---|---:|---:|---:|---:|']
    for r in controls:lines.append(f'| {r["sample"]} | {r["pr"]} | {r["findings"]} | {r["classes"].get("false",0)} | {r["classes"].get("unresolved",0)} | {r["classes"].get("additional",0)} |')
    lines += ['','### Per-defect publication spread','','| Defect | A candidate/verified/published out of 2 | F candidate/verified/published out of 2 |','|---|---|---|']
    for key in sorted(samples[0]['by_defect']):
        cells=['/'.join(str(sum(bool(s['by_defect'][key][stage]) for s in samples if s['arm']==arm)) for stage in ('found','verified','published')) for arm in 'AF'];lines.append('| '+key+' | '+' | '.join(cells)+' |')
    text='\n'.join(lines)+'\n';(directory/'comparison.md').write_text(text)
    for name,value in [('iteration5-summary',dict(state=state,samples=samples,aggregate=aggregates)),('control-findings',[x for x in unmatched if x['control']]),('unmatched-findings',unmatched),('miss-evidence',misses),('verifier-session-refusals',sessions),('denied-tool-events',events)]:
        (directory/(name+'.json')).write_text(json.dumps(value,indent=2)+'\n')
    report=ROOT/'metrics/ITERATION-5.md';report.write_text(report.read_text().split('## Results')[0]+text)
    print('\n'.join(lines[:50]))


def precision_percent(sample,scope,bound):
    precision=sample['precision'] if scope=='overall' else sample['controls']['precision']
    return None if precision is None else 100*precision[bound]


if __name__=='__main__':summary(Path(sys.argv[1]))
