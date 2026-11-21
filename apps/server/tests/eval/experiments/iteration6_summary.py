"""Reuse the held-out reporting and accounting contract for F versus G."""
from pathlib import Path
import sys
from iteration5_summary import summary


if __name__ == '__main__':
    summary(Path(sys.argv[1]), arms=('F', 'G'), titles=('F previous defaults', 'G precision candidate'), iteration=6,
            policy='G adds framework/base-aware unused-export checks and bounded proof-preserving semantic publication deduplication.')
