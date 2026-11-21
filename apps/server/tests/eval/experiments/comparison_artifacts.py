"""Shared immutable export merging and exact-arithmetic promotion measurements."""
import shutil
import json


def merge_exports(source, destination):
    destination.mkdir(exist_ok=True)
    for export in source.glob('*.json'):
        target = destination/export.name
        if target.exists():
            assert target.read_bytes() == export.read_bytes(), export.name
        else:
            shutil.copy2(export, target)


def prepare_comparison(sources, state, directory):
    directory.mkdir(exist_ok=True)
    selected = {a['arm'] for a in state['arms']}
    for source in sources:
        original = json.loads((source/'state.json').read_text())
        for arm in original['arms']:
            if arm['arm'] in selected:
                tag = arm['arm']+'-attempt'+str(arm['attempt'])+'-reports'
                shutil.copytree(source/tag, directory/tag, dirs_exist_ok=True)
        merge_exports(source/'raw-exports', directory/'raw-exports')
    state['work'] = str(directory)
    (directory/'state.json').write_text(json.dumps(state, indent=2)+'\n')
    return directory


def promotion_decision(samples, candidate_arm, improve=False):
    baseline = [s for s in samples if s['arm'] == 'F']
    candidate = [s for s in samples if s['arm'] == candidate_arm]
    assert len(baseline) == 3 and len(candidate) == 2
    published = lambda group: sum(s['recall']['published'] for s in group)
    false = lambda group: sum(s['controls']['classes'].get('false', 0) for s in group)
    losses = [sum(d['verified'] and not d['published'] for d in s['by_defect'].values()) for s in candidate]
    candidate_false = false(candidate)*len(baseline)
    baseline_false = false(baseline)*len(candidate)
    recall = published(candidate)*len(baseline) >= published(baseline)*len(candidate)
    noise = candidate_false < baseline_false if improve else candidate_false <= baseline_false
    return dict(promote=recall and noise and not any(losses), recall_no_worse=recall,
                **{'control_false_improved' if improve else 'control_false_no_worse': noise},
                candidate_verified_unpublished=losses)
