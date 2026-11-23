from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from iteration6_summary import combined_state, prepare, promotion


def states():
    shared=dict(dataset='frozen', tasks=['control','synthetic'], label_hashes={'control':'a','synthetic':'b'}, set_name='heldout-v1', generation_paused=True)
    def arm(name):
        return dict(arm=name,status='completed',ledger_exit_code=0,flags={'RECODER_PRECISION_FIXES':'0' if name.startswith('F-') else '1'})
    previous=dict(shared,work='original',source_commit='original-commit',arms=[arm(n) for n in ('F-s1','G-s1','F-s2')],stopped_after='F-s2',skipped_samples=['G-s2'],generation_released=False)
    continuation=dict(shared,work='continuation',source_commit='detector-commit',arms=[arm(n) for n in ('Gprime-s1','F-s3','Gprime-s2')],generation_released=True,finished_at='finished')
    return previous,continuation


class Iteration6Tests(unittest.TestCase):
    def test_raw_export_collisions_must_be_identical_and_both_sources_are_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            paths=[Path(temporary)/name for name in ('previous','continuation')]
            for path,state in zip(paths,states()):
                path.mkdir();(path/'raw-exports').mkdir()
                (path/'raw-exports'/'shared.json').write_text('same')
                (path/'raw-exports'/(path.name+'.json')).write_text(path.name)
                for arm in state['arms']:
                    arm['attempt']=1
                    (path/(arm['arm']+'-attempt1-reports')).mkdir()
                (path/'state.json').write_text(json.dumps(state))
            combined=prepare(*paths)
            self.assertEqual({p.name for p in (combined/'raw-exports').iterdir()},{'shared.json','previous.json','continuation.json'})
            (paths[1]/'raw-exports'/'shared.json').write_text('different')
            with self.assertRaises(AssertionError):prepare(*paths)

    def test_finished_samples_can_be_reported_without_releasing_generation(self):
        previous,continuation=states()
        continuation['generation_released']=False
        with self.assertRaises(AssertionError):combined_state(previous,continuation)
        continuation['generation_held_for_report']=True
        self.assertTrue(combined_state(previous,continuation)['generation_held_for_report'])

    def test_promotion_includes_f3_and_excludes_the_rejected_semantic_sample(self):
        def sample(arm,published,false):
            return dict(arm=arm,recall={'published':published},controls={'classes':{'false':false}},by_defect={'d':dict(verified=True,published=True)})
        samples=[sample('F',49,3),sample('G',59,0),sample('F',49,3),sample('Gprime',50,0),sample('F',55,3),sample('Gprime',50,0)]
        self.assertFalse(promotion(samples)['promote'])
        samples[4]['recall']['published']=52
        self.assertTrue(promotion(samples)['promote'])
        samples[3]['by_defect']['d']['published']=False
        self.assertEqual(promotion(samples)['candidate_verified_unpublished'],[1,0])
        self.assertFalse(promotion(samples)['promote'])

    def test_promotion_needs_both_complete_arms_and_strict_control_improvement(self):
        with self.assertRaises(AssertionError):promotion([])
        samples=[dict(arm=arm,recall={'published':50},controls={'classes':{}},by_defect={}) for arm in ['F','F','F','Gprime','Gprime']]
        self.assertFalse(promotion(samples)['control_false_improved'])
        self.assertFalse(promotion(samples)['promote'])

    def test_approved_order_preserves_the_rejected_sample_and_source_provenance(self):
        previous,continuation=states()
        result=combined_state(previous,continuation)
        self.assertEqual([a['arm'] for a in result['arms']],['F-s1','G-s1','F-s2','Gprime-s1','F-s3','Gprime-s2'])
        self.assertEqual([a['source_commit'] for a in result['arms']],['original-commit']*3+['detector-commit']*3)
        self.assertEqual(len(previous['arms']),3)
        self.assertTrue(result['continuous_generation_pause'])

    def test_missing_failed_or_duplicate_samples_cannot_enter_the_comparison(self):
        for mutation in ('missing','failed','duplicate','ledger','old-g2'):
            previous,continuation=deepcopy(states())
            if mutation=='missing':continuation['arms'].pop()
            if mutation=='failed':continuation['arms'][0]['status']='failed'
            if mutation=='duplicate':continuation['arms'][2]=continuation['arms'][0]
            if mutation=='ledger':previous['arms'][2]['ledger_exit_code']=1
            if mutation=='old-g2':previous['arms'].append(dict(previous['arms'][1],arm='G-s2'))
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError):combined_state(previous,continuation)

    def test_different_inputs_flags_or_a_released_pause_reject_the_continuation(self):
        for mutation in ('hash','flags','pause','unfinished'):
            previous,continuation=deepcopy(states())
            if mutation=='hash':continuation['label_hashes']={'control':'changed'}
            if mutation=='flags':continuation['arms'][0]['flags']={'RECODER_PRECISION_FIXES':'0'}
            if mutation=='pause':previous['generation_released']=True
            if mutation=='unfinished':continuation.pop('finished_at')
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError):combined_state(previous,continuation)


if __name__=='__main__':unittest.main()
