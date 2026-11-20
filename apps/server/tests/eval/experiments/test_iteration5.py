import json
from pathlib import Path
import tempfile
import unittest
from iteration5_benchmark import verify_hashes
from iteration5_freeze import digest
from iteration5_metrics import precision_bounds


class Iteration5Tests(unittest.TestCase):
    def test_precision_retains_unknowns_and_penalizes_duplicates(self):
        self.assertEqual(precision_bounds(['planted','additional','duplicate','false','unresolved']),dict(lower=.4,upper=.6,published=5,unresolved=1))
        self.assertEqual(precision_bounds(['false','unresolved'])['upper'],.5)

    def test_empty_precision_is_undefined_not_perfect(self):
        self.assertIsNone(precision_bounds([]))

    def test_invalid_class_is_not_silently_ignored(self):
        with self.assertRaises(AssertionError):precision_bounds(['unknown'])

    def test_frozen_inputs_cannot_change_or_disappear(self):
        with tempfile.TemporaryDirectory() as name:
            p=Path(name);(p/'label.json').write_text('original')
            (p/'SHA256SUMS.json').write_text(json.dumps({'label.json':digest(b'original')}))
            verify_hashes(p)
            (p/'label.json').write_text('edited')
            with self.assertRaises(AssertionError):verify_hashes(p)
            (p/'label.json').unlink()
            with self.assertRaises(FileNotFoundError):verify_hashes(p)


if __name__=='__main__':unittest.main()
