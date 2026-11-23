"""Sequential final A/F samples; Neon confirmation is a separate subsequent step."""
import os
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, '/home/ubuntu/eval-work/scripts')
import verifier_ab
from iteration5_benchmark import verify_hashes


if __name__ == '__main__':
    assert os.environ.get('VERIFIER_AB_START_PAUSED') == '1'
    dataset=Path('/home/ubuntu/eval-work/datasets/final-v1')
    verify_hashes(dataset)
    subprocess.run(['bun','-e',"import { execUnavailableReason } from './apps/server/src/sandbox/exec-sandbox.ts'; const r=await execUnavailableReason(); if(r){console.error(r);process.exit(1)} console.log('Sandbox preflight: ready')"],cwd=verifier_ab.REPO,check=True)
    off=dict(RECODER_DEPENDENCY_GROUNDING='0',RECODER_PRECISION_FIXES='0',RECODER_DISCOVERY_TRANSITIONS='0')
    verifier_ab.FLAGS.extend(off)
    neon=len(sys.argv)>1 and sys.argv[1]=='neon'
    if neon:
        assert not verifier_ab.generation_active()
        plan=[('Neon-s1',off)]
    else:
        assert not verifier_ab.PAUSE.exists()
        legacy=dict(off,RECODER_DEVIN_MCP_ONLY='0',RECODER_VERIFIER_SESSION_FIXES='0')
        plan=[(arm+'-s'+str(n),legacy if arm=='A' else off) for n in (1,2) for arm in ('A','F')]
    try:
        verifier_ab.main(plan=plan,prefix='final-neon' if neon else 'final-af',dataset=dataset,set_name='final-v1',
                         immutable_dataset=True,release_generation=False,
                         review_model='devin:gemini-4-neon-medium' if neon else 'devin:swe-2-flash-medium')
    finally:
        verify_hashes(dataset)
