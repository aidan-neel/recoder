"""F1/G1/F2/G2 on the unchanged frozen held-out/control snapshot."""
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
    f = {'RECODER_PRECISION_FIXES': '0'}
    g = {'RECODER_PRECISION_FIXES': '1'}
    verifier_ab.FLAGS.append('RECODER_PRECISION_FIXES')
    try:
        verifier_ab.main(plan=[('F-s1', f), ('G-s1', g), ('F-s2', f), ('G-s2', g)], prefix='iteration6-precision', dataset=dataset, set_name='heldout-v1', immutable_dataset=True)
    finally:
        if verifier_ab.PAUSE.exists() and 'iteration6-precision-' in verifier_ab.PAUSE.read_text():
            verifier_ab.PAUSE.unlink()
        verify_hashes(dataset)
