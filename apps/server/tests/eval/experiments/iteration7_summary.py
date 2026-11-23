"""Reused flag-off F1-F3 plus the alternating, completed H/Hplus samples."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from iteration5_summary import summary
from comparison_artifacts import prepare_comparison, promotion_decision


def combined_state(previous, current):
    assert current.get('finished_at') and current.get('generation_held_for_report')
    assert current.get('generation_paused')
    for key in ('dataset', 'tasks', 'label_hashes', 'set_name'):
        assert previous[key] == current[key], key
    baseline = [a for a in previous['arms'] if a['arm'].startswith('F-')]
    assert [a['arm'] for a in baseline] == ['F-s1', 'F-s2', 'F-s3']
    assert [a['arm'] for a in current['arms']] == ['H-s1', 'Hplus-s1', 'H-s2', 'Hplus-s2']
    arms = []
    for state, samples in ((previous, baseline), (current, current['arms'])):
        for arm in samples:
            assert arm['status'] == 'completed' and arm['ledger_exit_code'] == 0
            precision = '1' if arm['arm'].startswith('Hplus-') else '0'
            flags = {'RECODER_PRECISION_FIXES': precision}
            if not arm['arm'].startswith('F-'):
                flags['RECODER_DEPENDENCY_GROUNDING'] = '1'
            assert arm['flags'] == flags
            arms.append(dict(arm, source_commit=arm.get('source_commit', state['source_commit'])))
    return dict(current, arms=arms, baseline_reused=True, baseline_artifacts=previous['work'],
                baseline_reuse_basis='Flag-off verifier payload/path, proof rules and budgets unchanged; no lookup runs under F.')


def prepare(previous, current):
    states = [json.loads((p/'state.json').read_text()) for p in (previous, current)]
    state = combined_state(*states)
    return prepare_comparison((previous, current), state, current/'combined')


def promotion(samples, arm):
    assert arm in ('H', 'Hplus')
    return promotion_decision(samples, arm)


if __name__ == '__main__':
    directory = prepare(Path(sys.argv[1]), Path(sys.argv[2]))
    summary(directory, arms=('F', 'H', 'Hplus'), titles=('F reused (n=3)', 'H grounding (n=2)', 'H+ grounding + detectors (n=2)'),
            iteration=7, sample_counts={'F': 3, 'H': 2, 'Hplus': 2},
            policy='F1-F3 reused unchanged flag-off; new order H1/H+1/H2/H+2. Historical F was not contemporaneously interleaved. Grounding changes neither proof nor tool-operation budgets.')
    samples = json.loads((directory/'iteration7-summary.json').read_text())['samples']
    result = {arm: promotion(samples, arm) for arm in ('H', 'Hplus')}
    (directory/'promotion.json').write_text(json.dumps(result, indent=2)+'\n')
    print('Promotion criteria:', json.dumps(result, sort_keys=True))
