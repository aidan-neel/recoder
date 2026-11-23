import copy
import unittest

from final_summary import project


class ContinuityProjectionTests(unittest.TestCase):
    def fixture(self):
        evidence=dict(found=True,verified=True,published=True)
        return dict(prs=[dict(id='case',defects=[dict(id='d1'),dict(id='d2')],runs=[dict(
            stages=dict(d1=evidence,d2=evidence),score=dict(found=dict(d1=0,d2=1)),
            labeled=dict(classes=['planted','planted']))])])

    def test_confirmed_omission_hits_remain_true_without_changing_original_judgements(self):
        report=self.fixture();before=copy.deepcopy(report)
        projected=project(report,dict(case=dict(defects=[dict(id='d1')])))
        run=projected['prs'][0]['runs'][0]
        self.assertEqual(set(run['stages']),{'d1'})
        self.assertEqual(run['labeled']['classes'],['planted','additional'])
        self.assertEqual(report,before)

    def test_empty_control_population_is_valid(self):
        report=self.fixture();pr=report['prs'][0];pr['defects']=[];pr['runs'][0]['stages']={}
        self.assertEqual(project(report,dict(case=dict(defects=[]))),report)

    def test_unknown_defects_and_incomplete_stage_judgements_fail_closed(self):
        with self.assertRaises(AssertionError):project(self.fixture(),dict(case=dict(defects=[dict(id='missing')])))
        report=self.fixture();del report['prs'][0]['runs'][0]['stages']['d2']
        with self.assertRaises(AssertionError):project(report,dict(case=dict(defects=[dict(id='d1')])))


if __name__=='__main__':unittest.main()
