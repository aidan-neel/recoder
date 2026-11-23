"""Read-only task timing and installed-context coverage, never new model calls."""
from collections import Counter
import json
from pathlib import Path
import re
import sqlite3
import statistics
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, '/home/ubuntu/eval-work/scripts')
from iteration3_summary import timestamp

API = re.compile(r'\b(api|method|signature|parameters?|arguments?|exports?|imports?|dependency|package|module|accept\w*|exist\w*)\b', re.I)
MARKER = 'BEGIN INSTALLED DEPENDENCY DATA\n'


def export_timestamp(value):
    return timestamp(re.sub(r'(\.\d{6})\d+(?=Z|[+-])', r'\1', value))


def attachment(message):
    if MARKER not in message:
        return None
    block = message.split(MARKER, 1)[1].split('\nEND INSTALLED DEPENDENCY DATA', 1)[0]
    match = re.match(r'Lookup wall: (\d+)ms\n(.*)', block, re.S)
    if not match:
        return dict(state='unavailable', detail=block)
    data = json.loads(match[2])
    return dict(state='installed' if data['matches'] else 'no installed evidence', wallMs=int(match[1]), data=data)


def matching_task(tasks, message, at):
    finding = re.search(r'\nFinding (c\d+) .*? at ([^\n]+)', message)
    title = re.search(r'\nTitle: ([^\n]+)', message)
    if not finding or not title:
        return None
    options = [t for t in tasks if t['id'] == 'verify:'+finding[1] and t['label'] == 'Verify: '+title[1]
               and timestamp(t['startedAt'])-2000 <= at <= timestamp(t['startedAt'])+t['elapsedMs']+2000]
    assert len(options) <= 1, (finding[1], title[1])
    return options[0] if options else None


def external_claim(heuristic, decision):
    if decision is None:
        return heuristic
    assert heuristic and isinstance(decision['external'], bool)
    assert isinstance(decision['evidence'], str) and decision['evidence'].strip()
    return decision['external']


def analyze(directory, modules):
    state = json.loads((directory/'state.json').read_text())
    audit_path = directory/'dependency-claim-audit.json'
    audit = json.loads(audit_path.read_text()) if audit_path.exists() else {}
    connection = sqlite3.connect('file:/home/ubuntu/eval-work/server-data/recoder.db?mode=ro', uri=True)
    reviews = []
    for arm in state['arms']:
        report = json.loads(next((directory/(arm['arm']+'-attempt'+str(arm['attempt'])+'-reports')).glob('*.json')).read_text())
        for pr in report['prs']:
            for run in pr['runs']:
                progress = json.loads(connection.execute('select value from review_progress where id=?', (run['reviewId'],)).fetchone()[0])
                tasks = [t for t in progress['tasks'].values() if t.get('kind') == 'verification' and t.get('startedAt') and t.get('elapsedMs') is not None]
                reviews.append(dict(sample=arm['arm'], pr=pr['id'], reviewId=run['reviewId'], run=run, tasks=tasks))
    connection.close()
    all_tasks = [dict(t, sample=r['sample'], pr=r['pr'], reviewId=r['reviewId']) for r in reviews for t in r['tasks']]
    observed = {}
    unreadable = []
    for path in (directory/'raw-exports').glob('*.json'):
        try:
            export = json.loads(path.read_text())
        except (json.JSONDecodeError, UnicodeDecodeError):
            unreadable.append(str(path)); continue
        for step in export.get('steps', []):
            message = step.get('message', '')
            if step.get('source') != 'user' or not isinstance(message, str) or not message.startswith('You verify'):
                continue
            task = matching_task(all_tasks, message, export_timestamp(step['timestamp']))
            if not task:
                continue
            key = (task['reviewId'], task['id'], export['session_id'])
            value = dict(sample=task['sample'], pr=task['pr'], reviewId=task['reviewId'], task=task['id'],
                         session=export['session_id'], raw=str(path), attachment=attachment(message),
                         claim=message.split('\nTitle:', 1)[-1].split('\nEvidence the reviewer cited', 1)[0][:10000])
            if key not in observed or len(message) > observed[key].get('promptLength', 0):
                observed[key] = dict(value, promptLength=len(message))
    rows = []
    for review in reviews:
        pool = review['run'].get('pool', [])
        for task in review['tasks']:
            candidates = [c for c in pool if 'Verify: '+str(c.get('title', '')) == task['label'] and c['file'] in task.get('files', [])]
            texts = [str(c.get('title', ''))+'\n'+c['message'] for c in candidates]
            exports = [v for v in observed.values() if v['reviewId'] == review['reviewId'] and v['task'] == task['id']]
            if not texts:
                texts = [e['claim'] for e in exports]
            text = '\n'.join(texts)
            is_api = bool(API.search(text))
            named = [name for name in modules.get(review['pr'], []) if re.search(r'(?<![\w.-])'+re.escape(name)+r'(?![\w.-])', text, re.I)]
            s3 = review['pr'] == 'clean-p-limit-context' and bool(re.search(r'@aws-sdk/client-s3|\bS3Client\b|\bgetObject\b', text))
            if not is_api and not any(e['attachment'] for e in exports):
                continue
            key = review['reviewId']+':'+task['id']
            heuristic = bool(is_api and named)
            rows.append(dict(sample=review['sample'], pr=review['pr'], reviewId=review['reviewId'], task=task,
                             apiWord=is_api, externalHeuristic=heuristic,
                             externalClaim=external_claim(heuristic, audit.get(key)), claimAudit=audit.get(key), namedDependencies=named,
                             s3=s3, installedEvidence='no installed evidence' if s3 else None,
                             candidateMatches=len(candidates), candidates=candidates, exports=exports))
    assert set(audit) <= {r['reviewId']+':'+r['task']['id'] for r in rows}, 'stale claim audit'
    totals = []
    for arm in state['arms']:
        group = [r for r in rows if r['sample'] == arm['arm']]
        external = [r for r in group if r['externalClaim']]
        attached = [e for r in group for e in r['exports'] if e['attachment']]
        walls = [e['attachment']['wallMs'] for e in attached if 'wallMs' in e['attachment']]
        totals.append(dict(sample=arm['arm'], apiWordTasks=sum(r['apiWord'] for r in group), externalClaimTasks=len(external),
                           externalClaimWallMs=sum(r['task']['elapsedMs'] for r in external),
                           externalMeanMs=statistics.mean(r['task']['elapsedMs'] for r in external) if external else None,
                           attachedSessions=len(attached), attachmentStates=dict(Counter(e['attachment']['state'] for e in attached)),
                           lookupWallMs=sum(walls), lookupMeanMs=statistics.mean(walls) if walls else None))
    output = directory/'dependency-timing'
    output.mkdir(exist_ok=True)
    (output/'evidence.json').write_text(json.dumps(dict(rows=rows, summaries=totals, unreadable=unreadable,
        policy='Task elapsedMs to terminal status, not proof of successful resolution; includes queue/prefetch. External-name/API-word heuristic requires manual audit; claimAudit preserves each override. No discovery absence is timed as zero. Installed-context state does not imply correctness.'), indent=2)+'\n')
    print(json.dumps(totals, indent=2))
    return rows, totals


if __name__ == '__main__':
    analyze(Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text()))
