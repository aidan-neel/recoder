import json
from pathlib import Path
import tempfile
import unittest
from iteration8_summary import discovery_cost, promotion


def samples():
    return [dict(arm=arm, recall={'published': score}, controls={'classes': {'false': 3}},
                 by_defect={'d': dict(verified=True, published=True)}, latency_ms={'0.95': 1000})
            for arm, score in [('F', 50), ('I', 51), ('F', 52), ('I', 52)]]


def write_reports(root):
    row = dict(stage='reviewer', calls=2, unknownCalls=1, input=100, cached=40, output=20)
    arms = [dict(arm=a+'-s'+str(n), attempt=1) for n in (1, 2) for a in ('F', 'I')]
    (root/'state.json').write_text(json.dumps(dict(arms=arms)))
    for arm in arms:
        folder = root/(arm['arm']+'-attempt1-reports')
        folder.mkdir()
        reviewer = dict(row, input=110) if arm['arm'].startswith('I') else row
        tokens = [reviewer, dict(row, stage='verifier', input=999999), dict(row, stage='subagent', input=50)]
        (folder/'report.json').write_text(json.dumps(dict(prs=[dict(runs=[dict(reviewer={'tokens': tokens})])])))
    return root/'F-s1-attempt1-reports/report.json'


class DiscoveryComparisonTests(unittest.TestCase):
    def test_equal_recall_is_not_a_discovery_gain(self):
        data = samples()
        self.assertTrue(promotion(data)['promote'])
        data[1]['recall']['published'] = 50
        self.assertFalse(promotion(data)['recall_above'])
        self.assertFalse(promotion(data)['promote'])

    def test_latency_accepts_the_fifteen_percent_boundary_but_not_more(self):
        data = samples()
        for sample in data:
            if sample['arm'] == 'I': sample['latency_ms']['0.95'] = 1150
        self.assertTrue(promotion(data)['promote'])
        data[-1]['latency_ms']['0.95'] = 1151
        self.assertFalse(promotion(data)['p95_within_15_percent'])
        self.assertFalse(promotion(data)['promote'])

    def test_noise_and_any_verified_publication_loss_independently_veto_promotion(self):
        for failure in ('false', 'unpublished'):
            data = samples()
            if failure == 'false': data[1]['controls']['classes']['false'] += 1
            else: data[1]['by_defect']['d']['published'] = False
            with self.subTest(failure=failure): self.assertFalse(promotion(data)['promote'])

    def test_incomplete_baselines_are_not_silently_compared_as_means(self):
        with self.assertRaises(AssertionError): promotion(samples()[1:])

    def test_cost_separates_discovery_from_verification_and_preserves_unknowns(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_reports(root)
            result = discovery_cost(root)
            self.assertEqual(result['means']['F'], dict(input=150, cached=80, output=40, calls=4, unknownCalls=2))
            self.assertEqual(result['means']['I']['input'], 160)
            self.assertEqual(result['delta']['input']['absolute'], 10)
            self.assertAlmostEqual(result['delta']['input']['percent'], 100/15)

    def test_missing_discovery_metrics_are_not_reported_as_zero_cost(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = write_reports(root)
            for tokens in ([], [{'stage': 'reviewer'}]):
                path.write_text(json.dumps(dict(prs=[dict(runs=[dict(reviewer={'tokens': tokens})])])))
                with self.subTest(tokens=tokens), self.assertRaises(AssertionError): discovery_cost(root)


if __name__ == '__main__': unittest.main()
