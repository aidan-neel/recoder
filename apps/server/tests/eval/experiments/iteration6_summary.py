"""Compare F1-F3, detector-only Gprime1/Gprime2, and the rejected semantic G1."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from iteration5_summary import summary
from comparison_artifacts import prepare_comparison, promotion_decision


def combined_state(previous, continuation):
    assert previous.get('stopped_after') == 'F-s2' and previous.get('skipped_samples') == ['G-s2']
    assert not previous.get('generation_released')
    assert continuation.get('finished_at') and (continuation.get('generation_released') or continuation.get('generation_held_for_report'))
    assert all(state.get('generation_paused') for state in (previous, continuation))
    for key in ('dataset', 'tasks', 'label_hashes', 'set_name'):
        assert previous[key] == continuation[key], key
    assert [a['arm'] for a in previous['arms']] == ['F-s1', 'G-s1', 'F-s2']
    assert [a['arm'] for a in continuation['arms']] == ['Gprime-s1', 'F-s3', 'Gprime-s2']
    arms=[]
    for state in (previous, continuation):
        for arm in state['arms']:
            assert arm['status'] == 'completed' and arm['ledger_exit_code'] == 0
            assert arm['flags'] == {'RECODER_PRECISION_FIXES': '0' if arm['arm'].startswith('F-') else '1'}
            arms.append(dict(arm, source_commit=state['source_commit']))
    return dict(continuation, arms=arms, prior_artifacts=previous['work'], prior_source_commit=previous['source_commit'], continuous_generation_pause=True)


def prepare(previous, continuation):
    states=[json.loads((p/'state.json').read_text()) for p in (previous,continuation)]
    state=combined_state(*states)
    return prepare_comparison((previous, continuation), state, continuation/'combined')


def promotion(samples):
    return promotion_decision(samples, 'Gprime', improve=True)


if __name__ == '__main__':
    directory=prepare(Path(sys.argv[1]),Path(sys.argv[2]))
    summary(directory, arms=('F', 'Gprime', 'G'),
            titles=('F baseline (n=3)', 'G′ detectors only (n=2)', 'G1 rejected semantic rule (n=1)'), iteration=6,
            sample_counts={'F':3,'Gprime':2,'G':1},
            policy='Order F1/G1/F2/G′1/F3/G′2; old G2 skipped. G1 is a negative result, not part of G′. G′ changes only framework/base-aware unused-export detection; F proof safeguards remain unchanged.')
    result=promotion(json.loads((directory/'iteration6-summary.json').read_text())['samples'])
    (directory/'promotion.json').write_text(json.dumps(result,indent=2)+'\n')
    print('Promotion criteria:',json.dumps(result,sort_keys=True))
