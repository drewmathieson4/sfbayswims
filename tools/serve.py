#!/usr/bin/env python3
"""Production static server for the frame (stdlib only).

  python3 tools/serve.py [port]            # default 8000, binds 127.0.0.1 (set AQUATIC_HOST=0.0.0.0 for LAN debugging)

Threaded (the stdlib default is single-threaded and Chromium opens several connections at once), assets revalidate
(`no-cache`) so an updated app is picked up on the nightly reload, and /ambient.json is mapped to the light
sensor's file (AQUATIC_AMBIENT, default /run/aquatic/ambient.json) and never cached.
"""
import http.server, os, pathlib, socketserver, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
AMBIENT = pathlib.Path(os.environ.get("AQUATIC_AMBIENT", "/run/aquatic/ambient.json"))
HOST = os.environ.get("AQUATIC_HOST", "127.0.0.1")

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
    def end_headers(self):
        self.send_header("Cache-Control", "no-store" if self.path.startswith("/ambient.json") else "no-cache")   # revalidate; the sensor file never caches
        super().end_headers()
    def translate_path(self, path):
        if path.split("?", 1)[0] == "/ambient.json": return str(AMBIENT)
        return super().translate_path(path)
    def log_message(self, fmt, *args):
        if args and str(args[1:2]) not in ("('200',)", "('304',)"): sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    with Server((HOST, port), Handler) as srv:
        print(f"serving {ROOT} on http://{HOST}:{port} (ambient: {AMBIENT})", flush=True)
        try: srv.serve_forever()
        except KeyboardInterrupt: pass
