"""Spec loading and validation: every shipped example and template is valid, and mistakes are reported with
the exact field path."""
import pytest

from conftest import ROOT, two_cards
from toolkit import spec


@pytest.mark.parametrize("path", sorted((ROOT / "examples").glob("*.yaml")), ids=lambda p: p.name)
def test_examples_validate(path):
    spec.load(path)


@pytest.mark.parametrize("path", sorted((ROOT / "templates").glob("*.yaml")), ids=lambda p: p.name)
def test_templates_validate_once_filled(path, tmp_path):
    # the same placeholders `./vtk new --template` fills in
    text = path.read_text()
    for key, value in {"__NAME__": "test", "__DATE__": "2026-01-01", "__BRAND__": "default", "__THEME__": "midnight_plum",
                       "__SOURCES__": "  clip1: clip1.mp4", "__CLIP1__": "clip1", "__CLIP2__": "clip1",
                       "__CLIP3__": "clip1"}.items():
        text = text.replace(key, value)
    filled = tmp_path / path.name
    filled.write_text(text)
    spec.load(filled, check_files=False)


def test_unknown_field_names_its_path_and_suggests_a_fix(write_spec):
    data = two_cards()
    data["timeline"][0]["clips"][0]["sped"] = 2
    with pytest.raises(spec.SpecError) as err:
        spec.load(write_spec(data))
    assert err.value.errors == ["timeline[0](a).clips[0].sped: unknown field (did you mean 'speed'?)"]


def test_yaml_syntax_error_is_a_spec_error(tmp_path):
    bad = tmp_path / "bad.yaml"
    bad.write_text("timeline: [\n")
    with pytest.raises(spec.SpecError, match="YAML syntax error"):
        spec.load(bad)


def test_missing_source_file_is_reported(write_spec):
    data = two_cards()
    data["sources"] = {"rec": "does_not_exist.mov"}
    data["timeline"][0]["clips"] = [{"src": "rec", "dur": 1.0}]
    with pytest.raises(spec.SpecError):
        spec.load(write_spec(data))
