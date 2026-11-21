"""Attribute the four completed comparison samples without launching reviews."""
import csv
import json
from pathlib import Path
import re
import sqlite3
import sys
sys.path.insert(0,'/home/ubuntu/eval-work/scripts')
from iteration3_summary import timestamp


def union_ms(intervals):
    merged=[]
    for start,end in sorted(intervals):
        assert end>=start
        if merged and start<=merged[-1][1]:merged[-1][1]=max(end,merged[-1][1])
        else:merged.append([start,end])
    return sum(end-start for start,end in merged)


def task_intervals(tasks,kind):
    result=[]
    for task in tasks:
        if task.get('kind')!=kind or not task.get('startedAt'):continue
        start=timestamp(task['startedAt'])
        elapsed=task.get('elapsedMs')
        if elapsed is None:
            if not task.get('updatedAt'):continue
            elapsed=timestamp(task['updatedAt'])-start
        result.append((start,start+elapsed))
    return result


def analyze(previous,continuation):
    connection=sqlite3.connect('file:/home/ubuntu/eval-work/server-data/recoder.db?mode=ro',uri=True)
    calls=[json.loads(value) for value, in connection.execute('select value from model_calls')]
    rows=[];snapshots=[];totals=[]
    for directory,names in ((previous,['F-s1','G-s1','F-s2']),(continuation,['Gprime-s1'])):
        for name in names:
            report=json.loads(next((directory/(name+'-attempt1-reports')).glob('*.json')).read_text())
            runs=[(pr['id'],r) for pr in report['prs'] for r in pr['runs']]
            stored={r['reviewId']:json.loads(connection.execute('select value from reviews where id=?',(r['reviewId'],)).fetchone()[0]) for _,r in runs}
            runs.sort(key=lambda pair:stored[pair[1]['reviewId']]['createdAt'])
            logs='\n'.join((directory/(name+'-attempt1-'+kind+'.log')).read_text() for kind in ['server','benchmark'])
            waits=[float(wait) for wait in re.findall(r'\[devin\] Request throttled; retry \d+/3 in ([\d.]+)s',logs)]
            sample=[]
            for index,(pr,run) in enumerate(runs):
                rid=run['reviewId'];review=stored[rid]
                progress=json.loads(connection.execute('select value from review_progress where id=?',(rid,)).fetchone()[0])
                metrics=json.loads(connection.execute('select value from review_metrics where id=?',(rid,)).fetchone()[0])
                tasks=list(progress['tasks'].values())
                owned=[c for c in calls if c.get('ownerId')==rid]
                stop=stored[runs[index+1][1]['reviewId']]['createdAt'] if index+1<len(runs) else report['finishedAt']
                judged=[c for c in calls if c.get('ownerId') is None and c['model']=='swe-2-medium' and review['createdAt']<=c['at']<stop]
                discovery=task_intervals(tasks,'assignment');verification=task_intervals(tasks,'verification')
                semantic=[(timestamp(c['at']),timestamp(c['at'])+c['durationMs']) for c in owned if c.get('stage')=='other']
                assert all(not discovery+verification or start>=max(end for _,end in discovery+verification)-100 for start,_ in semantic)
                d=union_ms(discovery);v=union_ms(verification);dv=union_ms(discovery+verification)
                consolidation=union_ms(discovery+verification+semantic)-dv
                other=run['durationMs']-dv-consolidation
                assert other>=-1000,(name,pr,other)
                sessions=run.get('reviewer',{}).get('verifierSessions',[])
                failed=[t for t in tasks if t['status']=='error']
                abandoned=[t for t in tasks if t['status'] in ['skipped','cancelled']]
                row=dict(sample=name,pr=pr,reviewId=rid,reviewMs=run['durationMs'],discoveryMs=round(d),verificationMs=round(v),
                         verificationOnlyMs=round(dv-d),consolidationMs=round(consolidation),otherReviewMs=round(other),
                         judgeMs=union_ms([(timestamp(c['at']),timestamp(c['at'])+c['durationMs']) for c in judged]),judgeCalls=len(judged),
                         verifierSessions=len(sessions),verifierOps=sum(s['ops'] for s in sessions),
                         exhaustedSessions=sum(s.get('exhausted',False) for s in sessions),
                         assignmentRetries=sum(t['id'].startswith('assignment:retry-') for t in tasks),
                         failedAssignments=sum(t.get('kind')=='assignment' for t in failed),
                         skippedTasks=len(abandoned),providerRetries=0 if not waits else None,
                         providerWaitMs=0 if not waits else None,
                         queueWaitMs=sum(m.get('queueDelay',{}).get('totalMs',0) for m in metrics['runs']),
                         failedCalls=sum(c.get('outcome')!='ok' for c in owned),
                         finalOutcome=run['outcome'],findingCandidates=len(run.get('pool',[])),
                         remainingUnsettled=sum(t['status'] not in ['done','partial','error','skipped','cancelled'] for t in tasks),
                         reviewerCallMs=sum(c['durationMs'] for c in owned if c.get('stage')=='reviewer'),
                         verifierCallMs=sum(c['durationMs'] for c in owned if c.get('stage')=='verifier'))
                sample.append(row);rows.append(row)
                snapshots.append(dict(sample=name,pr=pr,reviewId=rid,reviewTimes={k:review.get(k) for k in ['createdAt','startedAt','updatedAt']},
                                      tasks=tasks,metricRuns=metrics['runs'],calls=[{k:c.get(k) for k in ['id','at','durationMs','stage','kind','model','outcome','ownerId']} for c in owned+judged],
                                      taskErrors=failed,skippedTasks=abandoned))
            aggregate={key:sum(row[key] for row in sample) for key in sample[0] if (key.endswith('Ms') and key!='providerWaitMs') or key in ['verifierSessions','verifierOps','exhaustedSessions','assignmentRetries','failedAssignments','skippedTasks','failedCalls','remainingUnsettled','judgeCalls']}
            aggregate.update(sample=name,reportWallMs=timestamp(report['finishedAt'])-timestamp(report['startedAt']),providerRetries=len(waits),providerWaitMs=sum(waits)*1000)
            aggregate['harnessOtherMs']=aggregate['reportWallMs']-aggregate['reviewMs']-aggregate['judgeMs']
            totals.append(aggregate)
    connection.close()
    output=continuation/'latency';output.mkdir(exist_ok=True)
    (output/'evidence.json').write_text(json.dumps(snapshots,indent=2)+'\n')
    (output/'summary.json').write_text(json.dumps(dict(samples=totals,prs=rows),indent=2)+'\n')
    with (output/'per-pr.csv').open('w') as stream:
        writer=csv.DictWriter(stream,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    lines=['## G1 latency decomposition','',
           'No additional benchmarks. Source: completed reports, stored progress/tasks and model-call timestamps; filtered read-only SQLite snapshots in `latency/evidence.json`. All four samples have 15 passed reviews. Minutes below use interval unions, not sums of concurrent calls. Discovery and verification overlap: V-only excludes discovery-active time. C is the semantic call wall span; deterministic consolidation is not separately timed and remains in Other. Judge calls have no owner ID: attribution uses the exclusive sequential inter-review windows and SWE-2 Medium model, supported by benchmark.ts awaiting scoreRun before starting the next PR. Queue waits and summed model-call times overlap and are diagnostics, not additive wall savings.','',
           '| Sample | Review min | D active | V active (overlaps D) | V-only | C | Other review | Judge | Harness other | Full wall | Sessions / ops | Format retries / failed assignments | Provider retries / wait | Exhausted |',
           '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
    for s in totals:
        fields=[s[k]/60000 for k in ['reviewMs','discoveryMs','verificationMs','verificationOnlyMs','consolidationMs','otherReviewMs','judgeMs','harnessOtherMs','reportWallMs']]
        lines.append('| '+s['sample']+' | '+' | '.join(f'{n:.2f}' for n in fields)+f" | {s['verifierSessions']} / {s['verifierOps']} | {s['assignmentRetries']} / {s['failedAssignments']} | {s['providerRetries']} / {s['providerWaitMs']/1000:.1f}s | {s['exhaustedSessions']} |")
    for s in totals:
        lines+=['',f"### {s['sample']} per PR (seconds)",'',
                '| PR | Review | D active | V active | V-only | C | Other | Judge | Sessions / ops | Format retries / failed |',
                '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
        for r in rows:
            if r['sample']!=s['sample']:continue
            fields=[r[k]/1000 for k in ['reviewMs','discoveryMs','verificationMs','verificationOnlyMs','consolidationMs','otherReviewMs','judgeMs']]
            lines.append('| '+r['pr']+' | '+' | '.join(f'{n:.1f}' for n in fields)+f" | {r['verifierSessions']} / {r['verifierOps']} | {r['assignmentRetries']} / {r['failedAssignments']} |")
    (output/'analysis.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps(totals,indent=2));print('Latency artifacts:',output)


if __name__=='__main__':analyze(Path(sys.argv[1]),Path(sys.argv[2]))
