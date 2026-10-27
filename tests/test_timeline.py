"""The timeline planner turns a spec into an exact frame plan."""
from conftest import ROOT, two_cards
from toolkit import spec, timeline


def plan_for(write_spec, data):
    return timeline.build(spec.load(write_spec(data)))


def test_cuts_add_up_to_whole_frames(write_spec):
    plan = plan_for(write_spec, two_cards())
    assert plan["fps"] == 30
    assert plan["total"] == 90          # 1 s + 2 s at 30 fps


def test_crossfade_overlaps_the_two_clips(write_spec):
    plan = plan_for(write_spec, two_cards({"type": "crossfade", "dur": 0.5}))
    assert plan["total"] == 75          # 90 frames minus the 15-frame overlap
    a, b = plan["sections"]
    assert (a["start"], b["start"], b["end"]) == (0, 15, 75)


def test_output_size_follows_the_aspect(write_spec):
    data = two_cards()
    data["output"]["aspect"] = "4:5"
    plan = plan_for(write_spec, data)
    assert (plan["W"], plan["H"]) == (1080, 1350)


def test_demo_plan_is_stable():
    plan = timeline.build(spec.load(ROOT / "examples" / "demo.yaml"))
    assert (plan["W"], plan["H"], plan["fps"]) == (1080, 1920, 30)
    assert plan["total"] == 219
    assert [s["name"] for s in plan["sections"]] == ["hook", "count", "end"]
