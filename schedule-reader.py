#!/usr/bin/env python3
"""Step 1: fetch your Studie+ schedule and print it, so you can check it by eye.

  python skema_fetch.py                    # this week + next week
  python skema_fetch.py --weeks 4          # this week + the next 3
  python skema_fetch.py --from 2026-11-09  # start at the week containing that date
  python skema_fetch.py --raw              # also save every raw response to raw_<date>.txt
  python skema_fetch.py --file resp.txt    # decode a saved response (no network)

Your cookies go in config.json, next to this script. See README_SETUP.md.
"""
import argparse, datetime as dt, json, os, re, sys
import urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "https://all.uddataplus.dk/skema/skema/"
URL = BASE + "skemaservice"
DEFAULT_STRONG = "0E790BF304400AEF7F91A082938908F3"
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


def parse(text):
    if not text.startswith("//OK"):
        sys.exit("Server did not return a schedule:\n  " + text[:300])
    table = string_table(text)

    def idx(prefix):  # 1-based index of a class-name string, as used in the data stream
        for i, s in enumerate(table, 1):
            if s.startswith(prefix):
                return i
        return None

    med = idx("dk.uddata.model.skema.SkemaBegivenhed$MedarbejderISkema")
    lok = idx("dk.uddata.model.skema.SkemaBegivenhed$LokalerISkema")
    arr = idx("java.util.ArrayList")
    detail = None
    if med and lok and arr:
        # teacher, <id>, MEDARB, 1, ARRAYLIST, 0, 14, room, <id>, LOKALER, 1, ARRAYLIST, lessonNo, 0, subject
        detail = re.compile(rf",(\d+),\d+,{med},\d+,{arr},0,\d+,(\d+),\d+,{lok},\d+,{arr},(\d+),0,(\d+),")

    def s(i):
        i = int(i)
        return table[i - 1] if 0 < i <= len(table) else "?"

    matches = list(LESSON_RE.finditer(text))
    found = {}
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
        seg_end = matches[n + 1].start() if n + 1 < len(matches) else len(text)
        info = {"subject": "?", "room": "?", "teacher": "?", "lesson": "?"}
        dm = detail.search(text, m.end(), seg_end) if detail else None
        if dm:
            info = {"teacher": s(dm.group(1)), "room": s(dm.group(2)),
                    "lesson": dm.group(3), "subject": s(dm.group(4))}
        found[(start, end)] = info
    return [(a, b, found[(a, b)]) for a, b in sorted(found)]


# ---------------------------------------------------------------- output
def print_week(monday, lessons):
    print(f"\n=== Week of {monday:%d %b %Y} (ISO week {monday.isocalendar()[1]}) ===")
    for i in range(5):
        day = monday + dt.timedelta(days=i)
        todays = [l for l in lessons if l[0].date() == day]
        print(f"{day:%a %d/%m}", "" if todays else " - no lessons")
        for s, e, info in todays:
            print(f"   {s:%H:%M}-{e:%H:%M}  L{info['lesson']}  {info['subject']:<16} "
                  f"{info['room']:<6} {info['teacher']}")
    extra = [l for l in lessons if l[0].weekday() >= 5]
    for s, e, info in extra:
        print(f"{s:%a %d/%m} (weekend)  {s:%H:%M}-{e:%H:%M}  {info['subject']}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weeks", type=int, default=2)
    ap.add_argument("--from", dest="start", help="YYYY-MM-DD")
    ap.add_argument("--raw", action="store_true")
    ap.add_argument("--file")
    a = ap.parse_args()

    if a.file:
        lessons = parse(open(a.file, encoding="utf-8").read())
        days = sorted({l[0].date() for l in lessons})
        for d in sorted({x - dt.timedelta(days=x.weekday()) for x in days}):
            print_week(d, [l for l in lessons if 0 <= (l[0].date() - d).days < 7])
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
        print_week(mon, parse(text))


if __name__ == "__main__":
    main()