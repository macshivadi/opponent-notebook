#!/usr/bin/env python3
"""Local static server. Sets a correct MIME type for .wasm."""
import argparse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

Handler.extensions_map[".wasm"] = "application/wasm"
Handler.extensions_map[".js"] = "text/javascript"
Handler.extensions_map[".mjs"] = "text/javascript"

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8765)
    args = p.parse_args()
    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Serving {ROOT} on http://127.0.0.1:{args.port}/", flush=True)
    httpd.serve_forever()

if __name__ == "__main__":
    main()
