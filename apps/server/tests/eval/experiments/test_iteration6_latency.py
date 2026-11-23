import unittest
from iteration6_latency import task_intervals,union_ms


class LatencyTests(unittest.TestCase):
    def test_parallel_stage_spans_are_not_double_counted(self):
        self.assertEqual(union_ms([(0,10),(2,3),(9,20),(30,40)]),30)
        self.assertEqual(union_ms([]),0)
        with self.assertRaises(AssertionError):union_ms([(5,4)])

    def test_tasks_without_starts_are_not_invented_and_elapsed_beats_late_updates(self):
        start='2026-11-21T00:00:00Z'
        tasks=[dict(kind='assignment',startedAt=start,elapsedMs=10,updatedAt='2026-11-21T00:01:00Z'),dict(kind='assignment',updatedAt=start),dict(kind='verification',startedAt=start,elapsedMs=100)]
        self.assertEqual(union_ms(task_intervals(tasks,'assignment')),10)
        self.assertEqual(task_intervals(tasks,'other'),[])


if __name__=='__main__':unittest.main()
