#!/usr/bin/env python3
"""Fetch your Studie+ schedule and print it, so you can check it by eye.

  python skema_fetch.py                    # this week only (one network call)
  python skema_fetch.py --weeks 4          # this week + the next 3 (one call per week)
  python skema_fetch.py --from 2026-11-09  # start at the week containing that date
  python skema_fetch.py --raw              # also save every raw response to raw_<date>.txt
  python skema_fetch.py --short            # cut long notes/homework to 140 characters
  python skema_fetch.py --file resp.txt    # decode a saved response (no network)

Your cookies go in config.json, next to this script. See README_SETUP.md.

Use it from other code:
    cfg  = load_config()
    days = get_week(cfg, monday)            # -> list[Day]; Day = (date, [Lesson, ...])
    for date, lessons in days:
        for lesson in lessons:
            print(lesson.start, lesson.title, lesson.rooms, lesson.classes)
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import NamedTuple

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "https://all.uddataplus.dk/skema/skema/"
URL = BASE + "skemaservice"
DEFAULT_STRONG = "0E790BF304400AEF7F91A082938908F3"
UDATE_TYPE = "dk.uddata.gwt.comm.shared.UDate/2314285719"
SERVICE = "dk.uddata.services.interfaces.SkemaService"

# Booking-type lessons carry two strings: a TYPE (Elevmøde, Eksamen, Forberedelse...) and a TITLE
# (a free text, or the subject for exams). For the types below the TITLE is shown as the subject and
# the TYPE as the remark. For every other type it is the other way around.
EXAM_TYPES = {"Eksamen", "Forberedelse"}


# ================================================================= data model
@dataclass
class Lesson:
    """One entry in the schedule."""
    start: dt.datetime
    end: dt.datetime
    index: int | None = None                         # lesson number 1-6; 0 for non-lesson slots (booking, class day)
    subject: str = ""                                # "Biologi"
    level: str = ""                                  # "A", "B", "C" or ""
    rooms: list[str] = field(default_factory=list)    # ["D2366", "Virtuel C"]
    teachers: list[str] = field(default_factory=list)  # ["msh", "lear", "rbe"]
    classes: list[str] = field(default_factory=list)   # student groups: ["24vfcbiB"]
    note: str = ""
    homework: str = ""
    remark: str = ""
    event_id: int | None = None                       # Studie+'s internal id, useful for debugging

    @property
    def title(self) -> str:
        """Subject with level, e.g. "Biologi B"."""
        return f"{self.subject} {self.level}".strip()


class Day(NamedTuple):
    date: dt.date
    lessons: list[Lesson]


# ================================================================= config / request
def load_config():
    path = os.path.join(HERE, "config.json")
    try:
        cfg = json.load(open(path, encoding="utf-8"))
    except FileNotFoundError:
        sys.exit(f"Missing {path} - see README_SETUP.md")
    except json.JSONDecodeError as e:
        sys.exit(f"config.json is not valid JSON ({e}). Keep the quotes around every value.")
    for key in ("instnr", "utoken"):
        v = str(cfg.get(key, "")).strip()
        if not v or v.startswith("PASTE"):
            sys.exit(f'config.json: "{key}" is not filled in - see README_SETUP.md')
        cfg[key] = v
    return cfg


def build_body(cfg, start, end):
    """RPC body for hentEgnePersSkemaData(UDate from, UDate to).
    A UDate is sent as: 5 | 6 | year-1900 | month(0-based) | day | 0 | 0 | 0"""
    strong = cfg.get("strong_name") or DEFAULT_STRONG

    def ud(d):
        return f"5|6|{d.year - 1900}|{d.month - 1}|{d.day}|0|0|0|"
    return (f"7|0|6|{BASE}|{strong}|{SERVICE}|hentEgnePersSkemaData|{UDATE_TYPE}|UDate:|"
            f"1|2|3|4|2|5|5|{ud(start)}{ud(end)}")


def fetch_week_text(cfg, monday):
    """Raw GWT-RPC response for Monday..Sunday of the given week."""
    sunday = monday + dt.timedelta(days=6)
    headers = {
        "Content-Type": "text/x-gwt-rpc; charset=UTF-8",
        "X-GWT-Module-Base": BASE,
        "Cookie": f"instnr={cfg['instnr']}; utoken={cfg['utoken']}",
    }
    if cfg.get("permutation"):
        headers["X-GWT-Permutation"] = cfg["permutation"]
    req = urllib.request.Request(URL, data=build_body(cfg, monday, sunday).encode(),
                                 headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} from server. 401/403 = cookies expired or wrong; "
                 f"500 = strong name changed (see README_SETUP.md).")


def get_week(cfg, monday, save_raw=False) -> list[Day]:
    """Fetch and decode one week. Returns 7 Day entries (Mon..Sun); days without lessons have []."""
    text = fetch_week_text(cfg, monday)
    if save_raw:
        with open(os.path.join(HERE, f"raw_{monday}.txt"), "w", encoding="utf-8") as f:
            f.write(text)
    return parse_schedule(text, monday)


# ================================================================= decoding
TABLE_RE = re.compile(r',\[("(?:[^"\\]|\\.)*"(?:,"(?:[^"\\]|\\.)*")*)\],\d+,\d+\]\s*$')

# One UDate = minute,hour,day,month(0-based),year-1900,<2 refs>. A lesson holds two in a row (start,end);
# the back-references force the end to share day/month/year with the start.
LESSON_RE = re.compile(
    r"(?<![\d-])(\d+),(\d+),(\d+),(\d+),(1\d\d),(\d+),(\d+),0,"
    r"(\d+),(\d+),\3,\4,\5,\6,\7(?!\d)")


def string_table(text):
    m = TABLE_RE.search(text)
    if not m:
        return []
    try:
        return json.loads("[" + m.group(1) + "]")
    except json.JSONDecodeError:
        return []


def html_to_text(h):
    """Notes are sent as HTML (and a flattened plain version). Rebuild readable text with line breaks."""
    h = re.sub(r"\s+", " ", h)
    h = re.sub(r"(?i)<br\s*/?>|</div>|</p>|</li>|</h\d>", "\n", h)
    h = re.sub(r"<[^>]+>", "", h)
    h = html.unescape(h)
    lines = [re.sub(r"[ \t\u00a0]+", " ", l).strip() for l in h.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def _split_level(name):
    """'Kemi B' -> ('Kemi', 'B')"""
    m = re.fullmatch(r"(.*?)\s+([A-Z])", name.strip())
    return (m.group(1), m.group(2)) if m else (name.strip(), "")


def decode_lessons(text) -> list[Lesson]:
    """Turn a raw response into a flat, time-sorted list of Lesson objects."""
    if not text.startswith("//OK"):
        sys.exit("Server did not return a schedule:\n  " + text[:300])
    table = string_table(text)

    def idx(prefix):  # 1-based index of a class-name string, as used in the data stream
        for i, s_ in enumerate(table, 1):
            if s_.startswith(prefix):
                return i
        return None

    def s(i):  # string by 1-based reference; "" for null/empty
        i = int(i)
        return table[i - 1] if 0 < i <= len(table) else ""

    med = idx("dk.uddata.model.skema.SkemaBegivenhed$MedarbejderISkema")
    lok = idx("dk.uddata.model.skema.SkemaBegivenhed$LokalerISkema")
    akt = idx("dk.uddata.model.skema.SkemaBegivenhed$AktiviteterISkema")
    arr = idx("java.util.ArrayList")
    integer = idx("java.lang.Integer")
    note_cls = idx("dk.uddata.model.skemanoter.SkemaNote2")

    # ---- notes / homework, keyed by event id.  File order of one record:
    #   notePlain, noteHtml, hwPlain, hwHtml, flag, x, y, z, <SkemaNote2>, eventId, <Integer>
    notes = {}
    if note_cls and integer:
        note_re = re.compile(
            rf"(?<![\d-])(\d+),(\d+),(\d+),(\d+),[01],\d+,\d+,\d+,{note_cls},(\d+),{integer}(?!\d)")

        def best(plain, htm):
            return html_to_text(s(htm)) or s(plain).strip()
        for m in note_re.finditer(text):
            n_plain, n_html, h_plain, h_html, eid = m.groups()
            notes[int(eid)] = {"note": best(n_plain, n_html), "homework": best(h_plain, h_html)}

    # ---- patterns inside one lesson's data (file order; the writer's order is the reverse)
    teacher_re = re.compile(rf"(?<![\d-])\d+,(\d+),\d+,{med}(?!\d)") if med else None
    room_re = re.compile(rf"(?<![\d-])\d+,(\d+),\d+,{lok}(?!\d)") if lok else None
    # lesson number + subject:  <count>,<ArrayList>,<lessonNo>,0,<subject>,0,0,0
    core_re = re.compile(rf",\d+,{arr},(\d),0,(\d+),0,0,0,") if arr else None
    # level (A/B/C):  ...,0,0,<id>,<Integer>,<level>,0,
    level_re = re.compile(rf",0,0,\d+,{integer},(\d+),0,") if integer else None
    # remark = string right before the first "group" entry; the token before it is the booking type (0 normally)
    #   group entry:  0,<name>,<HOLD|STAM|OVAK>,<id>,<x>,<AktiviteterISkema>
    remark_re = re.compile(rf",(\d+),0,\d+,\d+,\d+,\d+,{akt},") if akt else None
    remark_old = re.compile(rf",{arr},0,0,0,0,(\d+),0,") if arr else None
    chain_re = re.compile(rf"(?:,0,\d+,\d+,\d+,\d+,{akt})+") if akt else None
    entry_re = re.compile(rf",0,(\d+),\d+,\d+,\d+,{akt}") if akt else None
    id_re = re.compile(rf",\d+,{integer},(\d+),{integer},") if integer else None
    id7_re = re.compile(rf"(?<![\d-])(\d{{7,}}),{integer}(?!\d)") if integer else None

    matches = list(LESSON_RE.finditer(text))
    out, seen = [], set()
    for n, m in enumerate(matches):
        mi, h, d, mo, y = (int(m.group(i)) for i in range(1, 6))
        mi2, h2 = int(m.group(8)), int(m.group(9))
        try:
            start = dt.datetime(1900 + y, mo + 1, d, h, mi)
            end = dt.datetime(1900 + y, mo + 1, d, h2, mi2)
        except ValueError:
            continue
        if not start < end:
            continue
        seg = text[m.end(): matches[n + 1].start() if n + 1 < len(matches) else len(text)]
        im = (id_re.search(seg) if id_re else None) or (id7_re.search(seg) if id7_re else None)
        eid = int(im.group(1)) if im else None
        if (start, end, eid) in seen:
            continue
        seen.add((start, end, eid))

        lesson = Lesson(start=start, end=end, event_id=eid)

        lm = level_re.search(seg) if level_re else None
        if lm and re.fullmatch(r"[A-Z]", s(lm.group(1))):
            lesson.level = s(lm.group(1))

        cm = core_re.search(seg) if core_re else None
        if cm:
            lesson.index, lesson.subject = int(cm.group(1)), s(cm.group(2)).strip()
            region = seg[:cm.end()]
            if teacher_re:
                lesson.teachers = [s(x) for x in teacher_re.findall(region)][::-1]
            if room_re:
                lesson.rooms = [s(x) for x in room_re.findall(region)][::-1]

        rm = remark_re.search(seg, cm.end() if cm else 0) if remark_re else None
        if rm:
            lesson.remark = s(rm.group(1)).strip()
            # student groups ("Class"): the chain of group entries that follows the remark
            gm = chain_re.match(seg, rm.end(1))
            if gm:
                names = [s(x) for x in entry_re.findall(gm.group(0))][::-1]
                lesson.classes = [nm for nm in names if nm and not nm.startswith("*")]   # skip *BOOKING
            if not lesson.subject:
                prev = seg[:rm.start(1) - 1].rsplit(",", 1)[-1]
                btype = s(prev).strip() if prev.isdigit() else ""
                title = lesson.remark
                if btype in EXAM_TYPES:
                    lesson.subject, lesson.remark = title or btype, btype
                    if not lesson.level:
                        lesson.subject, lesson.level = _split_level(lesson.subject)
                elif btype:
                    lesson.subject, lesson.remark = btype, title
        elif remark_old:
            ro = remark_old.search(seg, cm.end() if cm else 0)
            if ro:
                lesson.remark = s(ro.group(1)).strip()

        if eid in notes:
            lesson.homework = notes[eid]["homework"]
            lesson.note = notes[eid]["note"]
        out.append(lesson)
    return sorted(out, key=lambda l: (l.start, l.end))


def parse_schedule(text, monday: dt.date | None = None) -> list[Day]:
    """Decode a response into a list of Day(date, [Lesson]).
    With `monday`: exactly Mon..Sun of that week (empty days included, other weeks ignored).
    Without: only the days that have lessons."""
    lessons = decode_lessons(text)
    by_day: dict[dt.date, list[Lesson]] = {}
    for l in lessons:
        by_day.setdefault(l.start.date(), []).append(l)
    if monday is not None:
        return [Day(monday + dt.timedelta(days=i), by_day.get(monday + dt.timedelta(days=i), []))
                for i in range(7)]
    return [Day(d, by_day[d]) for d in sorted(by_day)]


# ================================================================= output
def clip(text, short):
    if short and len(text) > 140:
        return text[:140].rstrip() + "..."
    return text


def format_lesson(l: Lesson) -> str:
    idx = "?" if l.index is None else l.index
    return (f"{l.start:%H:%M}-{l.end:%H:%M}  L{idx}  {l.title or '?':<18} "
            f"{'-'.join(l.rooms) or '?':<16} {', '.join(l.teachers) or '-':<14} "
            f"{', '.join(l.classes)}").rstrip()


def print_week(monday, days: list[Day], short=False):
    print(f"\n=== Week of {monday:%d %b %Y} (ISO week {monday.isocalendar()[1]}) ===")
    for day, lessons in days:
        if day.weekday() >= 5 and not lessons:
            continue
        print(f"{day:%a %d/%m}", "" if lessons else " - no lessons")
        for l in lessons:
            print("   " + format_lesson(l))
            for label, value in (("Remark", l.remark), ("Homework", l.homework), ("Note", l.note)):
                if value:
                    body = clip(value, short).replace("\n", "\n" + " " * 18)
                    print(f"        {label + ':':<10}{body}".replace(" " * 18 + "\n", "\n"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weeks", type=int, default=1, help="how many weeks to fetch (default 1)")
    ap.add_argument("--from", dest="start", help="YYYY-MM-DD")
    ap.add_argument("--raw", action="store_true")
    ap.add_argument("--short", action="store_true", help="cut long notes/homework to 140 characters")
    ap.add_argument("--file")
    a = ap.parse_args()

    if a.file:
        text = open(a.file, encoding="utf-8").read()
        mondays = sorted({d.date - dt.timedelta(days=d.date.weekday()) for d in parse_schedule(text)})
        for mon in mondays:
            print_week(mon, parse_schedule(text, mon), a.short)
        return

    cfg = load_config()
    day = dt.date.fromisoformat(a.start) if a.start else dt.date.today()
    monday = day - dt.timedelta(days=day.weekday())
    for w in range(a.weeks):
        mon = monday + dt.timedelta(weeks=w)
        print_week(mon, get_week(cfg, mon, save_raw=a.raw), a.short)


if __name__ == "__main__":
    main()