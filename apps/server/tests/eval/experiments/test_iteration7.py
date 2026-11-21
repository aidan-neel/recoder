from copy import deepcopy
from pathlib import Path
import subprocess
import sys
import unittest
from iteration7_summary import combined_state, promotion
from iteration7_timing import attachment, export_timestamp, external_claim, matching_task


def states():
    shared = dict(dataset='frozen', tasks=['control'], label_hashes={'control': 'a'}, set_name='heldout-v1', source_commit='code')
    def arm(name):
        flags = {'RECODER_PRECISION_FIXES': '1' if name.startswith('Hplus-') else '0'}
        if name.startswith('H'):
            flags['RECODER_DEPENDENCY_GROUNDING'] = '1'
        return dict(arm=name, status='completed', ledger_exit_code=0, flags=flags)
    old = dict(shared, work='old', arms=[arm(n) for n in ['F-s1', 'G-s1', 'F-s2', 'Gprime-s1', 'F-s3', 'Gprime-s2']])
    current = dict(shared, generation_paused=True, generation_held_for_report=True, finished_at='finished',
                   arms=[arm(n) for n in ['H-s1', 'Hplus-s1', 'H-s2', 'Hplus-s2']])
    return old, current


class Iteration7Tests(unittest.TestCase):
    def test_native_export_nanoseconds_preserve_millisecond_time_and_timezone(self):
        for value in ('1970-01-01T00:00:01.123456789Z', '1970-01-01T01:00:01.123456789+01:00'):
            self.assertAlmostEqual(export_timestamp(value), 1123.456, places=3)

    def test_timing_cli_import_does_not_require_other_tests_to_load_its_dependencies_first(self):
        result = subprocess.run([sys.executable, '-B', '-c', 'import iteration7_timing'], cwd=Path(__file__).parent, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_external_claim_audits_distinguish_package_names_from_ordinary_verbs(self):
        self.assertTrue(external_claim(True, None))
        self.assertFalse(external_claim(False, None))
        self.assertFalse(external_claim(True, {'external': False, 'evidence': 'delay is a verb about this queue, not the imported delay API'}))
        self.assertTrue(external_claim(True, {'external': True, 'evidence': 'explicit missing dependency API assertion'}))
        for decision in ({'external': 'false', 'evidence': 'reason'}, {'external': False, 'evidence': ''}):
            with self.subTest(decision=decision), self.assertRaises(AssertionError):
                external_claim(True, decision)

    def test_missing_installed_evidence_is_distinct_from_an_absent_attachment(self):
        self.assertIsNone(attachment('baseline verifier prompt'))
        value = attachment('BEGIN INSTALLED DEPENDENCY DATA\nLookup wall: 13ms\n{"matches":[],"unavailable":[{"name":"dep"}]}\nEND INSTALLED DEPENDENCY DATA')
        self.assertEqual(value['state'], 'no installed evidence')
        self.assertEqual(value['wallMs'], 13)
        self.assertEqual(attachment('BEGIN INSTALLED DEPENDENCY DATA\nlookup failed')['state'], 'unavailable')

    def test_export_task_join_requires_candidate_title_and_time_window_not_only_a_reused_c_number(self):
        task = dict(id='verify:c1', label='Verify: Claim', startedAt='1970-01-01T00:00:01Z', elapsedMs=100)
        message = 'You verify\nFinding c1 (warning, reviewer) at a.ts:1\nTitle: Claim\n'
        self.assertIs(matching_task([task], message, 1050), task)
        self.assertIsNone(matching_task([task], message, 10000))
        self.assertIsNone(matching_task([task], message.replace('Claim', 'Other'), 1050))
        with self.assertRaises(AssertionError): matching_task([task, task], message, 1050)

    def test_historical_baseline_excludes_rejected_and_detector_samples(self):
        old, current = states()
        result = combined_state(old, current)
        self.assertEqual([a['arm'] for a in result['arms']], ['F-s1', 'F-s2', 'F-s3', 'H-s1', 'Hplus-s1', 'H-s2', 'Hplus-s2'])
        self.assertEqual(len(old['arms']), 6)
        self.assertTrue(result['baseline_reused'])

    def test_changed_frozen_inputs_incomplete_or_misconfigured_samples_fail_closed(self):
        for mutation in ('hash', 'order', 'missing', 'ledger', 'grounding', 'finished', 'held'):
            old, current = deepcopy(states())
            if mutation == 'hash': current['label_hashes'] = {}
            if mutation == 'order': current['arms'].reverse()
            if mutation == 'missing': old['arms'].pop(4)
            if mutation == 'ledger': current['arms'][0]['ledger_exit_code'] = 1
            if mutation == 'grounding': current['arms'][0]['flags'].pop('RECODER_DEPENDENCY_GROUNDING')
            if mutation == 'finished': current.pop('finished_at')
            if mutation == 'held': current['generation_held_for_report'] = False
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError):
                combined_state(old, current)

    def test_promotion_allows_equal_false_counts_but_never_recall_or_publication_losses(self):
        def sample(arm):
            return dict(arm=arm, recall={'published': 51}, controls={'classes': {'false': 3}}, by_defect={'d': dict(verified=True, published=True)})
        samples = [sample(a) for a in ['F', 'F', 'F', 'H', 'H']]
        self.assertTrue(promotion(samples, 'H')['promote'])
        samples[-1]['recall']['published'] = 50
        self.assertFalse(promotion(samples, 'H')['promote'])
        samples[-1]['recall']['published'] = 51
        samples[-1]['controls']['classes']['false'] = 4
        self.assertFalse(promotion(samples, 'H')['promote'])
        samples[-1]['controls']['classes']['false'] = 3
        samples[-1]['by_defect']['d']['published'] = False
        self.assertEqual(promotion(samples, 'H')['candidate_verified_unpublished'], [0, 1])
        self.assertFalse(promotion(samples, 'H')['promote'])


if __name__ == '__main__': unittest.main()
