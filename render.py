#!/usr/bin/env python3
"""python render.py <spec.yaml> [--preview] [--safezones] [--frames T ...]  (same as ./vtk render)"""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
if Path(sys.prefix).resolve() != VENV.resolve() and (VENV / "bin/python").exists():
    os.execv(str(VENV / "bin/python"), [str(VENV / "bin/python"), __file__, *sys.argv[1:]])
sys.path.insert(0, str(ROOT))
from toolkit.cli import main  # noqa: E402

main(["render", *sys.argv[1:]])
