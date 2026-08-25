"""Shared helpers for the data-prep tools: HTTP (stdlib only), NOAA CO-OPS, Overpass, Pacific time."""
import json, urllib.request, urllib.parse, datetime, zoneinfo, time, pathlib

TZ = zoneinfo.ZoneInfo("America/Los_Angeles")
UA = "aquatic-park-swim-map/1.0 (data prep)"
COOPS = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
OVERPASS = "https://overpass-api.de/api/interpreter"

def get_json(url, retries=3, timeout=120, data=None, json_body=False):
    """GET (or POST with `data` bytes) a JSON document, retrying transient failures."""
    headers = {"User-Agent": UA, "Accept": "application/json"}
    if json_body: headers["Content-Type"] = "application/json"
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except Exception as e:
            if i == retries - 1: raise
            print(f"  retry {i + 1}: {e}"); time.sleep(3)

def http_range(url, a, b, tries=4):
    """Bytes a..b of a remote file (COG tile reads)."""
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"Range": f"bytes={a}-{b}", "User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception:
            if i == tries - 1: raise

def coops(**params):
    """A CO-OPS datagetter call (Pacific local time, English units); raises on the API's own error body."""
    p = {"time_zone": "lst_ldt", "units": "english", "format": "json", "application": "aquaticpark", **params}
    j = get_json(f"{COOPS}?{urllib.parse.urlencode(p)}")
    if "error" in j: raise RuntimeError(j["error"].get("message", j["error"]))
    return j

def overpass(query, cache=None):
    """An OpenStreetMap Overpass query; `cache` (a path) stores the reply so rebuilds need no network."""
    cache = pathlib.Path(cache) if cache else None
    if cache and cache.exists(): return json.loads(cache.read_text())
    j = get_json(OVERPASS, timeout=180, data=urllib.parse.urlencode({"data": query}).encode())
    if cache: cache.write_text(json.dumps(j))
    return j

def parse_local(s):
    """'YYYY-MM-DD HH:MM' in Pacific local time → epoch ms."""
    return int(datetime.datetime.strptime(s[:16], "%Y-%m-%d %H:%M").replace(tzinfo=TZ).timestamp() * 1000)

def ymd(d): return d.strftime("%Y%m%d")
