#!/usr/bin/env python3
"""Compatibility wrapper delegating to fox.py"""
import os
import sys
from pathlib import Path

FOX_SCRIPT = Path(__file__).parent / "fox.py"
if FOX_SCRIPT.exists():
    os.execv(sys.executable, [sys.executable, str(FOX_SCRIPT)] + sys.argv[1:])
else:
    print("fox.py not found", file=sys.stderr)
    sys.exit(1)
