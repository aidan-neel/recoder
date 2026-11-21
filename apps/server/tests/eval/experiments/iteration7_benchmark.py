"""H/Hplus on frozen heldout-v1; unchanged flag-off F1-F3 are reused, not rerun."""
import os
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, '/home/ubuntu/eval-work/scripts')
import verifier_ab
from iteration5_benchmark import verify_hashes


if __name__ == '__main__':
    assert os.environ.get('VERIFIER_AB_START_PAUSED') == '1', 'generation must be paused'
    assert not verifier_ab.PAUSE.exists(), 'another benchmark owns the pause'
    dataset = Path('/home/ubuntu/eval-work/datasets/iteration5-heldout-v1')
    verify_hashes(dataset)
    subprocess.run(['bun', '-e', "import { execUnavailableReason } from './apps/server/src/sandbox/exec-sandbox.ts'; const r=await execUnavailableReason(); if(r){console.error(r);process.exit(1)} console.log('Sandbox preflight: ready')"], cwd=verifier_ab.REPO, check=True)
    h = {'RECODER_DEPENDENCY_GROUNDING': '1', 'RECODER_PRECISION_FIXES': '0'}
    plus = dict(h, RECODER_PRECISION_FIXES='1')
    verifier_ab.FLAGS.extend(['RECODER_DEPENDENCY_GROUNDING', 'RECODER_PRECISION_FIXES'])
    try:
        verifier_ab.main(plan=[('H-s1', h), ('Hplus-s1', plus), ('H-s2', h), ('Hplus-s2', plus)], prefix='iteration7-grounding', dataset=dataset, set_name='heldout-v1', immutable_dataset=True, release_generation=False)
    finally:
        verify_hashes(dataset)
