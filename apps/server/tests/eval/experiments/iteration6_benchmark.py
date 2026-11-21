"""Approved detector-only continuation: Gprime1/F3/Gprime2, without releasing the pause."""
import json
import os
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, '/home/ubuntu/eval-work/scripts')
import verifier_ab
from iteration5_benchmark import verify_hashes


if __name__ == '__main__':
    assert os.environ.get('VERIFIER_AB_START_PAUSED') == '1', 'generation must be paused'
    previous = Path(sys.argv[1])
    state = json.loads((previous/'state.json').read_text())
    assert state.get('stopped_after') == 'F-s2' and state.get('skipped_samples') == ['G-s2']
    assert not state.get('generation_released') and str(previous) in verifier_ab.PAUSE.read_text()
    assert [(a['arm'], a['status'], a.get('ledger_exit_code')) for a in state['arms']] == [('F-s1','completed',0),('G-s1','completed',0),('F-s2','completed',0)]
    dataset = Path('/home/ubuntu/eval-work/datasets/iteration5-heldout-v1')
    verify_hashes(dataset)
    subprocess.run(['bun', '-e', "import { execUnavailableReason } from './apps/server/src/sandbox/exec-sandbox.ts'; const r=await execUnavailableReason(); if(r){console.error(r);process.exit(1)} console.log('Sandbox preflight: ready')"], cwd=verifier_ab.REPO, check=True)
    f = {'RECODER_PRECISION_FIXES': '0'}
    g = {'RECODER_PRECISION_FIXES': '1'}
    verifier_ab.FLAGS.append('RECODER_PRECISION_FIXES')
    try:
        verifier_ab.main(plan=[('Gprime-s1', g), ('F-s3', f), ('Gprime-s2', g)], prefix='iteration6-detectors', dataset=dataset, set_name='heldout-v1', immutable_dataset=True, release_generation=False)
    finally:
        verify_hashes(dataset)
