"""A1/F1/A2/F2 on an immutable held-out/control snapshot."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

sys.path.insert(0,'/home/ubuntu/eval-work/scripts')
import verifier_ab


def verify_hashes(dataset):
    for name,expected in json.loads((dataset/'SHA256SUMS.json').read_text()).items():
        assert hashlib.sha256((dataset/name).read_bytes()).hexdigest()==expected, 'frozen file changed: '+name


if __name__=='__main__':
    assert os.environ.get('VERIFIER_AB_START_PAUSED')=='1', 'generation must be paused for this experiment'
    assert not verifier_ab.PAUSE.exists(), 'another benchmark owns the pause'
    dataset=Path('/home/ubuntu/eval-work/datasets/iteration5-heldout-v1')
    verify_hashes(dataset)
    subprocess.run(['bun','-e',"import { execUnavailableReason } from './apps/server/src/sandbox/exec-sandbox.ts'; const r=await execUnavailableReason(); if(r){console.error(r);process.exit(1)} console.log('Sandbox preflight: ready')"],cwd=verifier_ab.REPO,check=True)
    legacy={'RECODER_DEVIN_MCP_ONLY':'0','RECODER_VERIFIER_SESSION_FIXES':'0'}
    try:
        verifier_ab.main(plan=[('A-s1',legacy),('F-s1',{}),('A-s2',legacy),('F-s2',{})],prefix='iteration5-heldout',dataset=dataset,set_name='heldout-v1',immutable_dataset=True)
    finally:
        if verifier_ab.PAUSE.exists() and 'iteration5-heldout-' in verifier_ab.PAUSE.read_text():
            verifier_ab.PAUSE.unlink()
        verify_hashes(dataset)
