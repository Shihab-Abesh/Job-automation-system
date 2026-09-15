#!/usr/bin/env python3
"""Run the whole system on this machine. No GitHub, no hosting, no account.

    python run_local.py              discover jobs, then open the approval queue
    python run_local.py --serve      just open the queue, skip discovery
    python run_local.py --discover   just discover, do not open a browser
    python run_local.py --port 9000  use a different port

Why a server and not just double-clicking review.html: a page opened from
file:// is not allowed to fetch data/jobs.json, so the queue would come up
empty. Serving the folder over http://localhost fixes that, and nothing leaves
your machine.
"""
from __future__ import annotations

import argparse
import http.server
import socket
import socketserver
import sys
import threading
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def end_headers(self):
        # The feed changes every run. Never let the browser hold an old copy.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # the pipeline's own output is the interesting part


def free_port(preferred: int) -> int:
    for port in range(preferred, preferred + 20):
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise SystemExit(f"No free port between {preferred} and {preferred + 19}.")


def discover(config: str) -> int:
    from backend.pipeline import main as pipeline_main
    print("Looking for jobs. This takes a minute or two.\n")
    return pipeline_main(["--config", config, "run"])


def lan_ip() -> str:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
        except OSError:
            return "127.0.0.1"


def serve(port: int, page: str, lan: bool = False) -> None:
    socketserver.TCPServer.allow_reuse_address = True
    host = "0.0.0.0" if lan else "127.0.0.1"
    with socketserver.TCPServer((host, port), Handler) as httpd:
        url = f"http://localhost:{port}/{page}"
        print(f"\nCareerPilot is running at {url}")
        if lan:
            print(f"On your phone, same wifi: http://{lan_ip()}:{port}/{page}")
        print("Leave this window open while you use it. Press Ctrl+C to stop.\n")
        threading.Thread(target=lambda: (time.sleep(0.6), webbrowser.open(url)),
                         daemon=True).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


def main() -> int:
    ap = argparse.ArgumentParser(description="Run CareerPilot BD locally")
    ap.add_argument("--serve", action="store_true", help="skip discovery")
    ap.add_argument("--discover", action="store_true", help="skip the browser")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--lan", action="store_true",
                    help="also reach it from your phone on the same wifi")
    ap.add_argument("--config", default="config/search.yml")
    ap.add_argument("--page", default="review.html",
                    help="review.html for the queue, index.html for the dashboard")
    args = ap.parse_args()

    if not (ROOT / "index.html").exists():
        raise SystemExit(f"Run this from the project folder. Looked in {ROOT}.")

    if not args.serve:
        code = discover(args.config)
        if code != 0:
            print("\nDiscovery finished with errors. Opening whatever it found.")
    if args.discover:
        return 0

    serve(free_port(args.port), args.page, args.lan)
    return 0


if __name__ == "__main__":
    sys.exit(main())
