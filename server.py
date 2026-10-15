#!/usr/bin/env python3
"""
Biome Atlas — tiny stdlib web server.

Serves the Leaflet frontend (web/) and the precomputed data (data/processed/).
No Flask/FastAPI: just http.server. Run it, open the printed URL.

    python3 server.py [port]      # default 8000
"""

import http.server
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def translate_path(self, path):
        # /data/... maps to on-disk data/, everything else to web/
        if path.startswith("/data/"):
            return os.path.join(HERE, path.lstrip("/").split("?")[0])
        clean = path.lstrip("/").split("?")[0] or "index.html"
        return os.path.join(HERE, "web", clean)

    def end_headers(self):
        # Local dev tool: never cache, so edits always show on reload.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass                                    # quiet


if __name__ == "__main__":
    missing = [p for p in ("data/processed/biomes.geojson", "data/processed/stats.json")
               if not os.path.exists(os.path.join(HERE, p))]
    if missing:
        print("! Missing data:", ", ".join(missing))
        print("  Run the pipeline first — see README.md.")
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler) as httpd:
        print(f"Biome Atlas → http://127.0.0.1:{PORT}   (Ctrl-C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nbye")
