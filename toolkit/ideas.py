"""Video ideas backlog: workspace/ideas/ideas.jsonl (one idea per line, the source of truth) and
workspace/ideas/IDEAS.md (the board, regenerated after every change). The user can ask Claude to add, groom, pick or update ideas at any time.

    ./vtk ideas                          board summary (by status)
    ./vtk ideas show <id>                one idea in full
    ./vtk ideas add "title" [--hook ..] [--format ..] [--proof ..] [--from idea.yaml]
    ./vtk ideas set <id> status=posted planned=2026-09-25 links.tiktok=https://... metrics.views=12000
    ./vtk ideas export --out ideas.sql   Postgres import (same style as ./vtk kb export)
"""
import json
import time

import yaml

from .paths import IDEAS

DIR = IDEAS
STORE = DIR / "ideas.jsonl"
BOARD = DIR / "IDEAS.md"
STATUSES = ["idea", "groomed", "recording", "editing", "ready", "posted", "dropped"]
FIELDS = ["title", "hook", "format", "template", "theme", "audience", "pain", "proof", "feeling", "beats", "narration",
          "recordings", "caption", "cta", "status", "planned", "posted", "links", "metrics", "spec", "notes", "source"]


def load():
    if not STORE.exists():
        return []
    return [json.loads(x) for x in STORE.read_text().splitlines() if x.strip()]


def save(ideas):
    DIR.mkdir(exist_ok=True)
    ideas = sorted(ideas, key=lambda i: i["id"])
    STORE.write_text("".join(json.dumps(i, ensure_ascii=False, separators=(",", ":"), default=str) + "\n" for i in ideas))
    write_board(ideas)


def _now():
    return time.strftime("%Y-%m-%d")


def add(title, **fields):
    ideas = load()
    idea = {"id": (max((i["id"] for i in ideas), default=0) + 1), "title": title, "status": "idea", "created": _now(),
            "updated": _now()}
    idea.update({k: v for k, v in fields.items() if v not in (None, "", [], {})})
    if idea["status"] not in STATUSES:
        raise ValueError(f"status must be one of {STATUSES}")
    ideas.append(idea)
    save(ideas)
    return idea


def get(iid):
    for i in load():
        if i["id"] == int(iid):
            return i
    return None


def _coerce(v):
    import datetime as _dt
    try:
        out = yaml.safe_load(v)
    except Exception:
        return v
    if isinstance(out, (_dt.date, _dt.datetime)):
        return v                       # keep dates as the text the user typed (2026-09-28)
    return out


def set_fields(iid, pairs):
    """pairs: ['status=posted', 'metrics.views=12000', 'links.tiktok=https://...']"""
    ideas = load()
    idea = next((i for i in ideas if i["id"] == int(iid)), None)
    if idea is None:
        raise KeyError(f"no idea #{iid}")
    for p in pairs:
        k, _, v = p.partition("=")
        val = _coerce(v)
        if k == "status" and val not in STATUSES:
            raise ValueError(f"status must be one of {STATUSES}")
        d = idea
        parts = k.split(".")
        for part in parts[:-1]:
            d = d.setdefault(part, {})
        d[parts[-1]] = val
    idea["updated"] = _now()
    save(ideas)
    return idea


def remove(iid):
    ideas = load()
    keep = [i for i in ideas if i["id"] != int(iid)]
    if len(keep) == len(ideas):
        return False
    save(keep)
    return True


def write_board(ideas=None):
    ideas = load() if ideas is None else ideas
    L = ["# Video ideas board", "",
         "Generated from `workspace/ideas/ideas.jsonl`. Don't edit by hand: ask Claude (or `./vtk ideas add / set`).",
         "Pick one in any session: *\"let's do idea #3\"*. Claude reads the idea, your brand's notes",
         "(`workspace/brand/<name>/`) and `trends/PLAYBOOK.md`, grooms it with you, then builds it.", "",
         "| # | status | planned | title | format | proof |", "|---|---|---|---|---|---|"]
    for i in sorted(ideas, key=lambda i: (i.get("status") in ("posted", "dropped"), i.get("planned") or "9999", i["id"])):
        L.append(f"| {i['id']} | {i.get('status', '')} | {i.get('planned') or ''} | {i['title']} | {i.get('format') or ''} | {i.get('proof') or ''} |")
    L.append("")
    for i in ideas:
        L += [f"## #{i['id']} {i['title']}", ""]
        meta = [f"**status:** {i.get('status')}"]
        for k in ("planned", "posted", "format", "template", "theme", "audience"):
            if i.get(k):
                meta.append(f"**{k}:** {i[k]}")
        L += [" · ".join(meta), ""]
        for k, label in (("hook", "Hook"), ("pain", "Pain"), ("proof", "Proof"), ("feeling", "Feeling"), ("cta", "CTA")):
            if i.get(k):
                L.append(f"- **{label}:** {i[k]}")
        if i.get("beats"):
            L += ["", "| time | on screen | voice / sound |", "|---|---|---|"]
            for b in i["beats"]:
                L.append(f"| {b.get('t', '')} | {b.get('show', '')} | {b.get('say', '')} |")
        if i.get("narration"):
            L += ["", f"**Narration:** {i['narration']}"]
        if i.get("recordings"):
            L += ["", "**Record:** " + " · ".join(i["recordings"])]
        if i.get("caption"):
            L += ["", f"**Post copy:** {i['caption']}"]
        if i.get("links") or i.get("metrics"):
            L += ["", f"**Links:** {i.get('links') or '-'} · **Metrics:** {i.get('metrics') or '-'}"]
        if i.get("spec"):
            L += ["", f"**Spec:** `{i['spec']}`"]
        if i.get("notes"):
            L += ["", f"_{i['notes']}_"]
        L.append("")
    BOARD.write_text("\n".join(L))


def summary():
    ideas = load()
    if not ideas:
        return "no ideas yet (./vtk ideas add \"title\" --hook ...)"
    from collections import Counter
    c = Counter(i.get("status") for i in ideas)
    L = [f"{len(ideas)} ideas: " + ", ".join(f"{c[s]} {s}" for s in STATUSES if c[s]), ""]
    for i in sorted(ideas, key=lambda i: (i.get("planned") or "9999", i["id"])):
        L.append(f"#{i['id']:<3} {i.get('status', ''):9s} {i.get('planned') or '':10s}  {i['title'][:60]:60s}  {i.get('format') or ''}")
    return "\n".join(L)


def export_sql():
    L = ["CREATE TABLE IF NOT EXISTS video_ideas (id int PRIMARY KEY, title text, status text, planned date, posted date,",
         "  format text, proof text, views bigint, idea jsonb NOT NULL);"]

    def q(v):
        return "NULL" if v in (None, "") else "'" + str(v).replace("'", "''") + "'"
    for i in load():
        views = (i.get("metrics") or {}).get("views")
        L.append(f"INSERT INTO video_ideas VALUES ({i['id']}, {q(i['title'])}, {q(i.get('status'))}, {q(i.get('planned'))}, "
                 f"{q(i.get('posted'))}, {q(i.get('format'))}, {q(i.get('proof'))}, {views if isinstance(views, int) else 'NULL'}, "
                 f"{q(json.dumps(i, ensure_ascii=False))}::jsonb) ON CONFLICT (id) DO UPDATE SET idea = EXCLUDED.idea, "
                 f"status = EXCLUDED.status, views = EXCLUDED.views;")
    return "\n".join(L) + "\n"
