"""Validate and freeze all thirty published cases plus four upstream controls."""
import datetime
import copy
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, '/home/ubuntu/eval-work/scripts')
from validate_labels import validate
from iteration5_benchmark import verify_hashes

ROOT = Path('/home/ubuntu/eval-work')


def apply_omissions(labels, cases, records):
    primary = dict(labels)
    cases = copy.deepcopy(cases)
    for record in records:
        if not record['confirmed']: continue
        ident = record['case']; label = json.loads(primary[ident]); defect = record['label']
        assert label['headSha'] == record['headSha']
        assert record['defect'] == defect['id'] and defect['provenance'] == 'audit-omission-confirmed'
        assert defect['id'] not in {d['id'] for d in label['defects']}
        label['defects'].append(defect)
        primary[ident] = (json.dumps(label, indent=2)+'\n').encode()
        cases[ident]['defects'][defect['id']] = dict(accepted=True, method='test', evidence=record['output'],
            provenance='audit-omission-confirmed', anchorReason=record['anchorReason'])
    return primary, cases


def membership(ident, label, case, dev, held):
    models = case.get('generation_models')
    if not models:
        generator = 'upstream-control'
    elif models.get('injection') == 'swe-2-flash-high':
        generator = 'Flash-injected'
    else:
        assert models.get('implementation') == 'swe-2-high'
        assert models.get('injection') in ('swe-2-high', None)
        generator = 'SWE-2-High'
    assert not (ident in dev and ident in held)
    return dict(evaluation='dev-v0' if ident in dev else 'held-out' if ident in held else 'new',
                repository='repo-disjoint' if label.get('holdout') else 'tuned-repo',
                generator=generator, control=not label['defects'])


def freeze(root=ROOT):
    source = root/'datasets/synth-rebuilt-v1'
    prior = root/'datasets/iteration5-heldout-v1'
    target = root/'datasets/final-v1'
    assert not target.exists(), 'refuse to modify an existing frozen final dataset'
    assert not (root/'generation/benchmark.pause').exists()
    assert not Path('/proc', (root/'generation/driver.pid').read_text().strip()).exists(), 'generation still running'
    manifest = json.loads((source/'manifest.json').read_text())
    assert len(manifest['cases']) == 30
    assert len(list((source/'labels').glob('*.json'))) == 30
    validate(source)
    verify_hashes(prior)
    previous = json.loads((prior/'manifest.json').read_text())
    dev = set(json.loads((source/'sets/dev-v0.json').read_text())['tasks'])
    held = set(json.loads((prior/'sets/heldout-v1.json').read_text())['tasks'])
    cases = dict(manifest['cases'])
    controls = {i: c for i, c in previous['cases'].items() if i.startswith('clean-')}
    assert len(controls) == 4 and not (cases.keys() & controls.keys())
    cases.update(controls)
    assert len(cases) == 34
    labels = {}; audits = {}; strata = {}
    for ident, case in cases.items():
        folder = prior if ident in controls else source
        label = json.loads((folder/'labels'/(ident+'.json')).read_text())
        assert label['headSha'] == case['headSha'] and label['verified'] is True
        labels[ident] = (folder/'labels'/(ident+'.json')).read_bytes()
        if ident not in controls:
            assert case['generation_models']['audit'] == 'gemini-4-neon-medium'
            audit = json.loads(Path(case['audit']).read_text())
            assert not audit.get('additional_defects') and not audit.get('spec_issues')
            verdicts = {d['id']: d for d in audit['defects']}
            assert all(verdicts[d['id']]['accepted'] is True for d in label['defects'])
            if not label['defects']: assert audit.get('clean') is True and not audit['defects'] and audit['overall']=='accept'
            audits[ident] = audit
            if ident != 'tiny-invariant-1':
                completed = json.loads((root/'generation'/ident/'completed.json').read_text())
                assert completed['headSha'] == label['headSha']
        strata[ident] = membership(ident, label, case, dev, held)
    records = json.loads((root/'metrics/final-omissions.json').read_text())
    expected = {(i,d['id']) for i,a in audits.items() for d in a['defects'] if d.get('accepted')
                and d['id'] not in {x['id'] for x in json.loads(labels[i])['defects']}}
    assert {(r['case'],r['defect']) for r in records} == expected
    continuity_labels = dict(labels); continuity_cases = copy.deepcopy(cases)
    labels, cases = apply_omissions(labels, cases, records)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    target.mkdir(mode=0o700)
    for part in ('labels', 'sets', 'provenance/audits'): (target/part).mkdir(parents=True, exist_ok=True)
    for ident, data in labels.items(): (target/'labels'/(ident+'.json')).write_bytes(data)
    for ident, audit in audits.items():
        (target/'provenance/audits'/(ident+'.json')).write_text(json.dumps(audit, indent=2)+'\n')
    (target/'provenance/omissions.json').write_text(json.dumps(records, indent=2)+'\n')
    provenance = {i: dict(membership=strata[i], generationModels=c.get('generation_models'),
                          generalization='repository-heldout' if strata[i]['repository']=='repo-disjoint' else 'new-PR-same-repository',
                          sourceLabelSha256=hashlib.sha256(labels[i]).hexdigest(),
                          upstreamControl=previous['provenance'][i] if i in controls else None,
                          frozenAudit='provenance/audits/'+i+'.json' if i in audits else None) for i,c in cases.items()}
    sets = {'final-v1': sorted(cases), 'dev-v0': sorted(dev), 'prior-heldout': sorted(held),
            'new': sorted(i for i,s in strata.items() if s['evaluation']=='new'),
            'controls': sorted(i for i,s in strata.items() if s['control'])}
    for name, tasks in sets.items():
        assert tasks
        (target/'sets'/(name+'.json')).write_text(json.dumps(dict(name=name, tasks=tasks,
            sources=[str(source), str(prior)], selectedAt=now,
            rule='Final immutable membership; dev-v0, prior held-out and new are disjoint. Generated controls already count among thirty.'), indent=2)+'\n')
    final = dict(version='final-v1', createdAt=now, upstreams=json.loads((root/'upstreams.json').read_text()),
                 cases=cases, provenance=provenance, sourcePublished=30, upstreamControls=4,
                 labelViews=dict(primary='.', continuity='views/continuity'),
                 unconfirmedOmissions=[r for r in records if not r['confirmed']],
                 priorFrozenHash=hashlib.sha256((prior/'SHA256SUMS.json').read_bytes()).hexdigest())
    (target/'manifest.json').write_text(json.dumps(final, indent=2)+'\n')
    (target/'adjudications.json').write_text('{}\n')
    continuity = target/'views/continuity'
    for part in ('labels','sets'): (continuity/part).mkdir(parents=True, exist_ok=True)
    for ident, data in continuity_labels.items(): (continuity/'labels'/(ident+'.json')).write_bytes(data)
    for path in (target/'sets').glob('*.json'): (continuity/'sets'/path.name).write_bytes(path.read_bytes())
    (continuity/'manifest.json').write_text(json.dumps(dict(final, cases=continuity_cases, view='continuity'), indent=2)+'\n')
    (continuity/'adjudications.json').write_text('{}\n')
    (target/'README.md').write_text('''# Final-v1 frozen corpus

Thirty published generated PRs (including five generated clean controls), plus four
real-upstream clean controls: 34 PRs, nine controls. Root labels are the primary view;
views/continuity/labels contains the original 146 labels byte-for-byte unchanged.
Primary adds only independently reproduced omissions, marked audit-omission-confirmed.
provenance/omissions.json includes 30-second time boxes, exact published heads, source
parity, reproduction programs/output, original locations and changed-behavior anchors.
Unconfirmed omissions, if any, are listed in manifest.json and remain unscored.
Historical frozen datasets were not edited. Membership metadata marks dev-v0,
previously held-out and new cases, repository strata, and generator provenance.
Flash-injected means SWE-2 High implementation with historical Flash High injection;
SWE-2-High includes later High-injected cases and High-implemented generated controls.

## Disclosed generator-gate gap

p-queue-3 and python-slugify-5 have original audit overall:reject summaries despite
accepting all proposed defects and reporting no extra defects/spec issues. The buggy
case publication gate checked per-defect evidence/counts, not the overall summary.
All original audits are preserved, not rewritten. Four accepted proposals were also
excluded by the original label validator; final-only primary labels repair confirmed
omissions at reachable changed behavior, without changing code or historical labels.

Run Recoder eval:benchmark with --dataset <this directory> --set final-v1 for primary,
or --dataset <this directory>/views/continuity --set final-v1 for continuity. Compare
identical saved review outputs under both views; never rerun reviewers merely to
change labels. SHA256SUMS.json freezes both views and all provenance files.
''')
    validate(target)
    validate(continuity)
    files = sorted(p for p in target.rglob('*') if p.is_file())
    hashes = {str(p.relative_to(target)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    inventory = target/'SHA256SUMS.json'; inventory.write_text(json.dumps(hashes, indent=2, sort_keys=True)+'\n')
    for p in files+[inventory]: p.chmod(0o444)
    verify_hashes(target)
    print(json.dumps(dict(dataset=str(target), prs=34, generatedControls=5, upstreamControls=4,
                         defects=sum(len(json.loads(v)['defects']) for v in labels.values()),
                         sha256=hashlib.sha256(inventory.read_bytes()).hexdigest()), indent=2))


if __name__ == '__main__': freeze()
