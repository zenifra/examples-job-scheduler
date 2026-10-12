import io
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from uptime_job.main import Logger


class _Handler(BaseHTTPRequestHandler):
    def _answer(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode() if length else ""
        self.server.requests.append({"method": self.command, "path": self.path, "body": body})
        routes = {"/ok": 200, "/hook": 200, "/missing": 404, "/hook-fail": 500}
        if self.path == "/slow":
            time.sleep(2)
        self.send_response(routes.get(self.path, 200 if self.path == "/slow" else 503))
        self.send_header("Content-Length", "0")
        self.end_headers()

    do_GET = _answer
    do_POST = _answer

    def log_message(self, *args):
        pass


class LocalServer:
    """Local HTTP server with a few fixed routes, so tests never depend on the internet."""

    def __enter__(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self.server.daemon_threads = True
        self.server.requests = []
        self.base = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return self

    @property
    def requests(self):
        return self.server.requests

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()


class MemoryLog:
    def __init__(self):
        self.buffer = io.StringIO()
        self.logger = Logger(stdout=self.buffer, stderr=self.buffer)

    @property
    def lines(self):
        return [json.loads(line) for line in self.buffer.getvalue().splitlines()]
