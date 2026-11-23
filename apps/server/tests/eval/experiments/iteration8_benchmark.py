"""Fresh F/I/F/I on frozen heldout-v1, with the same discovery budgets."""
import os
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, '/home/ubuntu/eval-work/scripts')
import verifier_ab
from iteration5_benchmark import verify_hashes


if __name__ == '__main__':
    assert os.environ.get('VERIFIER_AB_START_PAUSED') == '1'
    assert not verifier_ab.PAUSE.exists(), 'another benchmark owns generation pause'
    dataset = Path('/home/ubuntu/eval-work/datasets/iteration5-heldout-v1')
    verify_hashes(dataset)
    subprocess.run(['bun', '-e', "import { execUnavailableReason } from './apps/server/src/sandbox/exec-sandbox.ts'; const r=await execUnavailableReason(); if(r){console.error(r);process.exit(1)} console.log('Sandbox preflight: ready')"], cwd=verifier_ab.REPO, check=True)
    off = dict(RECODER_DEPENDENCY_GROUNDING='0', RECODER_PRECISION_FIXES='0', RECODER_DISCOVERY_TRANSITIONS='0')
    candidate = dict(off, RECODER_DISCOVERY_TRANSITIONS='1')
    verifier_ab.FLAGS.extend(off)
    sequence = [(arm+'-s'+str(n), off if arm == 'F' else candidate) for n in (1, 2) for arm in ('F', 'I')]
    try:
        verifier_ab.main(plan=sequence, prefix='iteration8-discovery', dataset=dataset,
                         set_name='heldout-v1', immutable_dataset=True, release_generation=False)
    finally:
        verify_hashes(dataset)
