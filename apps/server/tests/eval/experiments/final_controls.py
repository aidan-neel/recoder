"""Occurrence-level conservative control adjudication from saved reviews, without models."""
import argparse
from collections import Counter
import json
from pathlib import Path
import subprocess
from urllib.parse import unquote, urlsplit


def decision(ident, finding):
    category = finding['category']; message = finding['message']; title = finding['title']
    if ident == 'clean-chi-request-size' and category == 'dead-code' and 'TestRequestSize' in title:
        return 'Go discovers func TestRequestSize(t *testing.T) in a _test.go file; absence of ordinary call sites is not unused code.'
    if ident == 'clean-tenacity-classvar' and category == 'dead-code' and '`NAME`' in title:
        return 'Both BaseAction.NAME and RetryAction.NAME exist at the base. This PR changes ClassVar annotations, not the existence/export of NAME.'
    if ident == 'clean-chi-request-size' and 'likely short-circuits on `ContentLength > limit`' in message:
        return 'middleware/request_size.go wraps r.Body with http.MaxBytesReader and unconditionally invokes h.ServeHTTP. It has no ContentLength branch; the claimed early rejection/dead errors.As path is false.'
    return None


def audit(directories, destination, frozen):
    manifest = json.loads((frozen/'manifest.json').read_text())
    controls = {i for i, p in manifest['provenance'].items() if p['membership']['control']}
    receipts = {}
    for ident in ('clean-chi-request-size', 'clean-tenacity-classvar'):
        label = json.loads((frozen/'labels'/(ident+'.json')).read_text())
        repo = Path(unquote(urlsplit(label['repo']).path)); case = manifest['cases'][ident]
        files = ['middleware/request_size.go', 'middleware/request_size_test.go'] if 'chi' in ident else ['tenacity/__init__.py']
        receipts[ident] = dict(baseSha=case['baseSha'], headSha=case['headSha'], sources={
            stage: {f: subprocess.check_output(['git', '-C', str(repo), 'show', sha+':'+f], text=True) for f in files}
            for stage, sha in (('base', case['baseSha']), ('head', case['headSha']))
        } if 'chi' not in ident else dict(head={f: subprocess.check_output(['git', '-C', str(repo), 'show', case['headSha']+':'+f], text=True) for f in files}))
    rows = []; overlay = {}; seen = set()
    for directory in directories:
        state = json.loads((directory/'state.json').read_text())
        assert state.get('finished_at')
        for arm in state['arms']:
            assert arm['status'] == 'completed' and arm['ledger_exit_code'] == 0
            reports = list((directory/(arm['arm']+'-attempt'+str(arm['attempt'])+'-reports')).glob('*.json'))
            assert len(reports) == 1
            report = json.loads(reports[0].read_text())
            assert {p['id'] for p in report['prs'] if not p['defects']} == controls
            for pr in report['prs']:
                if pr['id'] not in controls: continue
                for run in pr['runs']:
                    assert run['reviewId'] not in seen; seen.add(run['reviewId'])
                    findings = []
                    for index, finding in enumerate(run['findings']):
                        key = run['reviewId']+':'+str(index); evidence = decision(pr['id'], finding)
                        if evidence:
                            assert run['labeled']['classes'][index] == 'unresolved'
                            overlay[key] = dict(label='false', evidence=evidence)
                        findings.append(dict(index=index, finding=finding, label='false' if evidence else 'unresolved',
                            evidence=evidence or 'Not independently established false. Conditional coverage/design, API-contract and duplication advice remains unresolved; clean-control membership alone is not refutation.'))
                    rows.append(dict(sample=arm['arm'], case=pr['id'], reviewId=run['reviewId'],
                                     headSha=manifest['cases'][pr['id']]['headSha'], findings=findings))
    destination.mkdir(exist_ok=True)
    (destination/'adjudication-overlay.json').write_text(json.dumps(overlay, indent=2)+'\n')
    counts = Counter(f['label'] for r in rows for f in r['findings'])
    (destination/'control-audit.json').write_text(json.dumps(dict(rows=rows, receipts=receipts, counts=dict(counts)), indent=2)+'\n')
    print(f'Final control audit PASS: {len(rows)} control reviews; {sum(counts.values())} findings; '+str(dict(counts)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directories', type=Path, nargs='+')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--frozen', type=Path, default=Path('/home/ubuntu/eval-work/datasets/final-v1'))
    args = parser.parse_args(); audit(args.directories, args.output, args.frozen)
