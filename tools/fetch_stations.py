#!/usr/bin/env python3
"""Discover NOAA CO-OPS current-prediction stations inside a world's bbox → data/worlds/<id>/stations.json.

  python3 tools/fetch_stations.py --world bay [--pad 0.01]

Harmonic (H) stations give continuous speed/direction; subordinate (S) stations only give
max/slack events (flagged maxSlackOnly — precompute_currents.py resamples them on a cosine).
Omitting `bin` in a datagetter call returns the shallowest predicted bin, which is what a
swimmer wants; we record that bin number for reference.
"""
import json, datetime
from _common import get_json, coops
from _world import world_dir, load_world, bbox_of, fopt

MD = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=currentpredictions&units=english"

def main():
    world = load_world(); s, w, n, e = bbox_of(world); pad = fopt("--pad", 0.0)
    rows = get_json(MD)["stations"]
    by_id = {}
    for st in rows:
        lat, lon = float(st["lat"]), float(st["lng"])
        if not (s - pad <= lat <= n + pad and w - pad <= lon <= e + pad): continue
        cur = by_id.get(st["id"])
        b = int(st.get("currbin") or 0)
        if not cur or b > cur["bin"]:
            by_id[st["id"]] = {"id": st["id"], "name": st["name"], "lat": lat, "lon": lon, "type": st.get("type"), "bin": b, "depthFt": st.get("depth")}
    out = []
    day = datetime.date.today().strftime("%Y%m%d")
    for st in sorted(by_id.values(), key=lambda x: x["id"]):
        q = {"product": "currents_predictions", "station": st["id"], "interval": "MAX_SLACK", "begin_date": day, "end_date": day}
        try:
            j = coops(**q)
            cp = j.get("current_predictions", {}).get("cp", [])
            if cp:
                st["floodDir"] = cp[0].get("meanFloodDir"); st["ebbDir"] = cp[0].get("meanEbbDir"); st["binUsed"] = cp[0].get("Bin")
        except Exception as ex:
            st["error"] = str(ex)[:80]
        st["maxSlackOnly"] = st["type"] != "H"
        if st["type"] == "H":   # confirm the continuous product works without a bin
            q.update({"interval": "30", "vel_type": "speed_dir"})
            try:
                j = coops(**q); cp = j.get("current_predictions", {}).get("cp", [])
                st["continuous"] = bool(cp and "Speed" in cp[0])
            except Exception as ex:
                st["continuous"] = False; st["error"] = str(ex)[:80]
        out.append(st); print(f"{st['id']:>8} {st['type']} bin {st.get('binUsed')} flood {st.get('floodDir')} ebb {st.get('ebbDir')}  {st['name']}")
    dst = world_dir() / "stations.json"
    dst.write_text(json.dumps({"world": world["id"], "bbox": world["bbox"], "generated": datetime.datetime.now().isoformat(timespec="seconds"),
                               "source": "NOAA CO-OPS current predictions (mdapi + datagetter)", "stations": out}, indent=1))
    print(f"wrote {dst}: {len(out)} stations ({sum(1 for x in out if x['type']=='H')} harmonic)")

if __name__ == "__main__":
    main()
