import unittest

from final_controls import decision


class ControlAdjudicationTests(unittest.TestCase):
    def test_framework_false_alarm_requires_the_matching_control_and_category(self):
        finding = dict(title='`TestRequestSize` is exported but never used', category='dead-code', message='')
        self.assertIsNotNone(decision('clean-chi-request-size', finding))
        self.assertIsNone(decision('chi-6', finding))
        self.assertIsNone(decision('clean-chi-request-size', dict(finding, category='tests')))

    def test_empty_and_conditional_advice_are_not_automatically_false(self):
        self.assertIsNone(decision('chi-6', dict(title='', category='', message='')))
        self.assertIsNone(decision('clean-chi-request-size', dict(title='Coverage gap', category='tests', message='If the handler rejects early, add coverage')))

    def test_preexisting_name_is_only_adjudicated_on_the_annotation_control(self):
        finding = dict(title='`NAME` is exported but never used', category='dead-code', message='')
        self.assertIsNotNone(decision('clean-tenacity-classvar', finding))
        self.assertIsNone(decision('tenacity-6', finding))


if __name__ == '__main__': unittest.main()
