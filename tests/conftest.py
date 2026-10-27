import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


@pytest.fixture
def write_spec(tmp_path):
    """Write a spec dict to a temporary YAML file and return its path."""
    def _write(data, name="spec.yaml"):
        p = tmp_path / name
        p.write_text(yaml.safe_dump(data, sort_keys=False))
        return p
    return _write


def two_cards(transition=None):
    """A footage-free spec: a 1 s black card, then a 2 s white card."""
    second = {"color": "#FFFFFF", "dur": 2.0}
    if transition:
        second["transition"] = transition
    return {
        "version": 1,
        "name": "test",
        "output": {"aspect": "9:16", "fps": 30},
        "timeline": [
            {"section": "a", "text": "none", "clips": [{"color": "#000000", "dur": 1.0}]},
            {"section": "b", "text": "none", "clips": [second]},
        ],
    }
