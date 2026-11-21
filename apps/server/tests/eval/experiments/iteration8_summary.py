"""Fresh discovery comparison, strict recall gain, control and latency gates."""
import json
from pathlib import Path
import statistics
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from comparison_artifacts import promotion_decision
from iteration5_summary import summary


def promotion(samples):
    result = promotion_decision(samples, 'I', baseline_samples=2)
    groups = {arm: [s for s in samples if s['arm'] == arm] for arm in ('F', 'I')}
    result['recall_above'] = sum(s['recall']['published'] for s in groups['I']) > sum(s['recall']['published'] for s in groups['F'])
    result.pop('recall_no_worse')
    p95 = {a: statistics.mean(s['latency_ms']['0.95'] for s in group) for a, group in groups.items()}
    result['p95_within_15_percent'] = p95['I'] * 100 <= p95['F'] * 115
    result['p95_mean_ms'] = p95
    result['promote'] = result['promote'] and result['recall_above'] and result['p95_within_15_percent']
    return result


def discovery_cost(directory):
    samples = []
    for arm in json.loads((directory/'state.json').read_text())['arms']:
        report = json.loads(next((directory/(arm['arm']+'-attempt'+str(arm['attempt'])+'-reports')).glob('*.json')).read_text())
        rows = [t for pr in report['prs'] for run in pr['runs'] for t in run['reviewer']['tokens'] if t['stage'] in ('reviewer', 'subagent')]
        fields = ('input', 'cached', 'output', 'calls', 'unknownCalls')
        assert rows and all(set(fields) <= r.keys() for r in rows), 'missing discovery accounting'
        samples.append(dict(sample=arm['arm'], totals={k: sum(r[k] for r in rows) for k in fields}))
    means = {a: {k: statistics.mean(s['totals'][k] for s in samples if s['sample'].startswith(a+'-')) for k in samples[0]['totals']} for a in ('F', 'I')}
    delta = {k: dict(absolute=means['I'][k]-means['F'][k], percent=(means['I'][k]/means['F'][k]-1)*100 if means['F'][k] else None) for k in means['F']}
    return dict(samples=samples, means=means, delta=delta,
                policy='Reviewer + subagent only. Tokens include complete-usage failed calls; unknown calls excluded in full. Calls counts all calls; cached is within input. Known deltas are not total-cost proof.')


if __name__ == '__main__':
    directory = Path(sys.argv[1])
    state = json.loads((directory/'state.json').read_text())
    assert [a['arm'] for a in state['arms']] == [a+'-s'+str(n) for n in (1, 2) for a in ('F', 'I')]
    for arm in state['arms']:
        assert arm['flags'] == dict(RECODER_DEPENDENCY_GROUNDING='0', RECODER_PRECISION_FIXES='0', RECODER_DISCOVERY_TRANSITIONS=str(int(arm['arm'].startswith('I-'))))
    summary(directory, arms=('F', 'I'), titles=('F fresh (n=2)', 'I transitions (n=2)'), iteration=8,
            policy='Fresh F1/I1/F2/I2. Same discovery budgets; four procedure steps reallocated. Promotion requires strictly higher mean published recall, no worse control false findings, zero verified publication losses, mean p95 no more than 1.15 times fresh F.')
    samples = json.loads((directory/'iteration8-summary.json').read_text())['samples']
    for name, value in (('promotion', promotion(samples)), ('discovery-cost', discovery_cost(directory))):
        (directory/(name+'.json')).write_text(json.dumps(value, indent=2)+'\n')
        print(name, json.dumps(value, sort_keys=True))
