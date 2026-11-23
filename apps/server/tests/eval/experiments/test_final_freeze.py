import unittest
import json

from final_freeze import membership, apply_omissions


class FinalMembershipTests(unittest.TestCase):
    def test_primary_repair_does_not_mutate_continuity_labels_or_evidence(self):
        original = json.dumps(dict(headSha='abc', defects=[dict(id='d1')])).encode()
        labels = dict(case=original); cases = dict(case=dict(defects={'d1':dict(accepted=True)}))
        record = dict(case='case', defect='d2', headSha='abc', confirmed=True,
                      label=dict(id='d2',provenance='audit-omission-confirmed'), output='reproduced',anchorReason='new behavior')
        primary, evidence = apply_omissions(labels,cases,[record])
        self.assertEqual(labels['case'],original)
        self.assertEqual(set(cases['case']['defects']),{'d1'})
        self.assertEqual(len(json.loads(primary['case'])['defects']),2)
        self.assertEqual(evidence['case']['defects']['d2']['method'],'test')
        self.assertEqual(apply_omissions(labels,cases,[])[0],labels)
        self.assertEqual(apply_omissions(labels,cases,[dict(confirmed=False)])[0],labels)
        with self.assertRaises(AssertionError): apply_omissions(labels,cases,[dict(record,headSha='wrong')])

    def test_historical_flash_is_not_mislabeled_by_its_high_implementation(self):
        result = membership('old', dict(defects=[{}], holdout=True),
                            dict(generation_models=dict(implementation='swe-2-high', injection='swe-2-flash-high')), set(), {'old'})
        self.assertEqual((result['evaluation'], result['generator'], result['repository']), ('held-out', 'Flash-injected', 'repo-disjoint'))

    def test_generated_clean_and_upstream_controls_are_distinguished(self):
        clean = membership('new', dict(defects=[]), dict(generation_models=dict(implementation='swe-2-high', injection=None)), set(), set())
        upstream = membership('old', dict(defects=[]), {}, set(), {'old'})
        self.assertEqual((clean['evaluation'], clean['generator'], clean['control']), ('new', 'SWE-2-High', True))
        self.assertEqual(upstream['generator'], 'upstream-control')

    def test_overlapping_frozen_membership_and_unknown_models_fail_closed(self):
        with self.assertRaises(AssertionError): membership('same', dict(defects=[]), {}, {'same'}, {'same'})
        with self.assertRaises(AssertionError): membership('new', dict(defects=[]), dict(generation_models=dict(implementation='unknown')), set(), set())


if __name__ == '__main__': unittest.main()
