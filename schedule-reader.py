#!/usr/bin/env python3
"""Step 1: fetch your Studie+ schedule and print it, so you can check it by eye.

  python skema_fetch.py                    # this week only (one network call)
  python skema_fetch.py --weeks 4          # this week + the next 3 (one call per week)
  python skema_fetch.py --from 2026-11-09  # start at the week containing that date
  python skema_fetch.py --raw              # also save every raw response to raw_<date>.txt
  python skema_fetch.py --short            # cut long notes/homework to 140 characters
  python skema_fetch.py --file resp.txt    # decode a saved response (no network)

Your cookies go in config.json, next to this script. See README_SETUP.md.
"""
import argparse, datetime as dt, html, json, os, re, sys
import urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "https://all.uddataplus.dk/skema/skema/"
URL = BASE + "skemaservice"
DEFAULT_STRONG = "0E790BF304400AEF7F91A082938908F3"
# Booking-type lessons carry two strings: a TYPE (Elevmøde, Eksamen, Forberedelse...) and a TITLE
# (a free text, or the subject for exams). For the types below the TITLE is shown as the subject and
# the TYPE as the remark. For every other type it is the other way around.
EXAM_TYPES = {"Eksamen", "Forberedelse"}
UDATE_TYPE = "dk.uddata.gwt.comm.shared.UDate/2314285719"
SERVICE = "dk.uddata.services.interfaces.SkemaService"


# ---------------------------------------------------------------- config / request
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


def fetch_week(cfg, monday):
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


# ---------------------------------------------------------------- decoding
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
    """Studie+ sends notes as HTML (and a flattened plain version). Rebuild readable text with line breaks."""
    h = re.sub(r"\s+", " ", h)
    h = re.sub(r"(?i)<br\s*/?>|</div>|</p>|</li>|</h\d>", "\n", h)
    h = re.sub(r"<[^>]+>", "", h)
    h = html.unescape(h)
    lines = [re.sub(r"[ \t\u00a0]+", " ", l).strip() for l in h.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def parse(text):
    """Returns a list of dicts, one per lesson, sorted by start time."""
    if not text.startswith("//OK"):
        sys.exit("Server did not return a schedule:\n  " + text[:300])
    table = string_table(text)

    def idx(prefix):  # 1-based index of a class-name string, as used in the data stream
        for i, s in enumerate(table, 1):
            if s.startswith(prefix):
                return i
        return None

    def s(i):  # string by 1-based reference; "" for null/empty
        i = int(i)
        return table[i - 1] if 0 < i <= len(table) else ""

    med = idx("dk.uddata.model.skema.SkemaBegivenhed$MedarbejderISkema")
    lok = idx("dk.uddata.model.skema.SkemaBegivenhed$LokalerISkema")
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
            h = html_to_text(s(htm))
            return h or s(plain).strip()
        for m in note_re.finditer(text):
            n_plain, n_html, h_plain, h_html, eid = m.groups()
            notes[int(eid)] = {"note": best(n_plain, n_html), "homework": best(h_plain, h_html)}

    # ---- lessons
    teacher_re = re.compile(rf"(?<![\d-])\d+,(\d+),\d+,{med}(?!\d)") if med else None
    room_re = re.compile(rf"(?<![\d-])\d+,(\d+),\d+,{lok}(?!\d)") if lok else None
    core_re = re.compile(rf",\d+,{arr},(\d),0,(\d+),0,0,0,") if arr else None   # lessonNo, subject
    akt = idx("dk.uddata.model.skema.SkemaBegivenhed$AktiviteterISkema")
    # The remark is the string right before the first "group" entry (class/team + HOLD|STAM + id).
    # Both normal lessons and booking-type lessons (no subject/room) share this anchor.
    remark_re = re.compile(rf",(\d+),0,\d+,\d+,\d+,\d+,{akt},") if akt else None
    remark_old = re.compile(rf",{arr},0,0,0,0,(\d+),0,") if arr else None
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

        lesson = {"start": start, "end": end, "id": eid, "lesson": "?", "subject": "",
                  "rooms": [], "teachers": [], "remark": "", "homework": "", "note": ""}
        cm = core_re.search(seg) if core_re else None
        if cm:
            lesson["lesson"], lesson["subject"] = cm.group(1), s(cm.group(2))
            region = seg[:cm.end()]
            # written order is the reverse of file order, so reverse to get display order
            if teacher_re:
                lesson["teachers"] = [s(x) for x in teacher_re.findall(region)][::-1]
            if room_re:
                lesson["rooms"] = [s(x) for x in room_re.findall(region)][::-1]
        rm = (remark_re.search(seg, cm.end() if cm else 0) if remark_re else None) \
            or (remark_old.search(seg, cm.end() if cm else 0) if remark_old else None)
        if rm:
            lesson["remark"] = s(rm.group(1)).strip()
            if not lesson["subject"]:
                # Booking-type lesson: the token just before the title is the booking type (0 for normal lessons)
                prev = seg[:rm.start(1) - 1].rsplit(",", 1)[-1]
                btype = s(prev).strip() if prev.isdigit() else ""
                title = lesson["remark"]
                if btype in EXAM_TYPES:
                    lesson["subject"], lesson["remark"] = title or btype, btype
                elif btype:
                    lesson["subject"], lesson["remark"] = btype, title
        if eid in notes:
            lesson["homework"] = notes[eid]["homework"]
            lesson["note"] = notes[eid]["note"]
        out.append(lesson)
    return sorted(out, key=lambda l: (l["start"], l["end"]))


# ---------------------------------------------------------------- output
def clip(text, short):
    if short and len(text) > 140:
        return text[:140].rstrip() + "..."
    return text


def print_week(monday, lessons, short=False):
    print(f"\n=== Week of {monday:%d %b %Y} (ISO week {monday.isocalendar()[1]}) ===")
    for i in range(7):
        day = monday + dt.timedelta(days=i)
        todays = [l for l in lessons if l["start"].date() == day]
        if i >= 5 and not todays:
            continue
        print(f"{day:%a %d/%m}", "" if todays else " - no lessons")
        for l in todays:
            print(f"   {l['start']:%H:%M}-{l['end']:%H:%M}  L{l['lesson']}  {l['subject'] or '?':<16} "
                  f"{'-'.join(l['rooms']) or '?':<16} {', '.join(l['teachers'])}")
            for label, key in (("Remark", "remark"), ("Homework", "homework"), ("Note", "note")):
                if l[key]:
                    body = clip(l[key], short).replace("\n", "\n" + " " * 18)
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
        lessons = parse(open(a.file, encoding="utf-8").read())
        days = sorted({l["start"].date() for l in lessons})
        for d in sorted({x - dt.timedelta(days=x.weekday()) for x in days}):
            print_week(d, [l for l in lessons if 0 <= (l["start"].date() - d).days < 7], a.short)
        return

    cfg = load_config()
    day = dt.date.fromisoformat(a.start) if a.start else dt.date.today()
    monday = day - dt.timedelta(days=day.weekday())
    for w in range(a.weeks):
        mon = monday + dt.timedelta(weeks=w)
        text = fetch_week(cfg, mon)
        if a.raw:
            with open(os.path.join(HERE, f"raw_{mon}.txt"), "w", encoding="utf-8") as f:
                f.write(text)
        print_week(mon, parse(text), a.short)


if __name__ == "__main__":
    main()