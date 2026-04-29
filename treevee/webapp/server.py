#!/usr/bin/env python3
"""Evorun Snapshot Visualizer server.

Usage:
    python server.py [folder] [--port PORT]

If folder is provided, auto-loads .treevee/state.json from it.
Otherwise, shows file upload UI.
"""

import argparse
import difflib
import gzip
import hashlib
import http.server
import json
import math
import os
import threading
import webbrowser
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qs, urlparse


STATE_FILE = ".treevee/state.json"
DEFAULT_PORT = 9000
HOST = "localhost"


def parse_server_args():
    """Parse server-specific arguments."""
    parser = argparse.ArgumentParser(
        description="Evorun Snapshot Visualizer server",
    )
    parser.add_argument(
        "folder", nargs="?", default=None,
        help="Directory containing .treevee/state.json to auto-load",
    )
    parser.add_argument(
        "--port", "-p", type=int, default=DEFAULT_PORT,
        help=f"Port to listen on (default: {DEFAULT_PORT})",
    )
    return parser.parse_args()


class EvorunHandler(http.server.SimpleHTTPRequestHandler):
    state_folder = None
    webapp_dir = None

    # In-memory state cache: {path: {mtime: float, data: dict}}
    _state_cache = {}
    # History fields stripped from /api/state (lazy-loaded on demand)
    _LARGE_HISTORY_FIELDS = frozenset([
        "planner_input", "planner_output",
        "editor_input", "editor_output", "diff_text",
    ])

    def translate_path(self, path):
        # Strip query string
        path = path.split("?")[0]
        # Map to filesystem under webapp_dir
        if path == "/":
            path = "/index.html"
        # Remove leading slash and join with webapp_dir
        return os.path.join(self.webapp_dir, path.lstrip("/"))

    def do_GET(self):
        if self.path == "/api/state":
            self._serve_state()
            return
        if self.path.startswith("/api/diff_from_root"):
            self._serve_diff_from_root()
            return
        if self.path.startswith("/api/node-detail"):
            self._serve_node_detail()
            return
        if self.path.startswith("/api/history-detail"):
            self._serve_history_detail()
            return
        return super().do_GET()

    @staticmethod
    def _sanitize(obj):
        """Replace NaN/Inf floats with null so output is valid JSON."""
        if isinstance(obj, float):
            return None if (not math.isfinite(obj)) else obj
        if isinstance(obj, list):
            return [EvorunHandler._sanitize(item) for item in obj]
        if isinstance(obj, dict):
            return {k: EvorunHandler._sanitize(v) for k, v in obj.items()}
        return obj

    def _load_state(self):
        """Load state.json into cache if mtime changed. Returns (data, mtime) or (None, None)."""
        state_path = os.path.join(self.state_folder, STATE_FILE)
        try:
            mtime = os.path.getmtime(state_path)
        except OSError:
            return None, None

        cache = EvorunHandler._state_cache
        if cache.get("path") == state_path and cache.get("mtime") == mtime:
            return cache["data"], mtime

        try:
            with open(state_path) as f:
                data = json.load(f)
            EvorunHandler._state_cache = {"path": state_path, "mtime": mtime, "data": data}
            return data, mtime
        except json.JSONDecodeError:
            return None, None

    def _build_light_state(self, data):
        """Build a lightweight copy of state without mutating the input,
        stripping large text fields that are only needed on-demand.

        Strips:
          - eval_output from every tree node (keeps first 500 chars for
            error/status detection, full output is lazy-loaded)
          - planner_input, planner_output, editor_input, editor_output,
            diff_text from every history entry
        """
        # Shallow copy the top-level dict — the substructures are rebuilt
        # below so we don't need a deep copy.
        light = dict(data)

        tree = data.get("tree_structure")
        if tree:
            light["tree_structure"] = dict(tree)
            light["tree_structure"]["nodes"] = [
                {k: (v[:500] if k == "eval_output" and len(v) > 500 else v)
                 for k, v in n.items()}
                | ({"_eval_output_truncated": True} if n.get("eval_output") and len(n["eval_output"]) > 500 else {})
                for n in tree.get("nodes", [])
            ]

        light["history"] = [
            {k: v for k, v in h.items() if k not in self._LARGE_HISTORY_FIELDS}
            for h in data.get("history", [])
        ]

        return light

    def _etag_for(self, mtime):
        """Generate a short ETag from mtime + state file path."""
        raw = f"{mtime}:{EvorunHandler._state_cache.get('path', '')}"
        return f'"{hashlib.md5(raw.encode()).hexdigest()[:16]}"'

    def _serve_state(self):
        if not self.state_folder:
            self._send_json(404, {"error": "No folder configured. Pass a folder argument: python server.py <folder>"})
            return

        data, mtime = self._load_state()
        if data is None:
            state_path = os.path.join(self.state_folder, STATE_FILE)
            self._send_json(500, {"error": f"Failed to load {state_path}"})
            return

        # ETag-based caching.
        etag = self._etag_for(mtime) if mtime else None
        if etag and self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.end_headers()
            return

        # Serve a lightweight copy — large text fields are lazy-loaded.
        light = self._build_light_state(data)
        light = self._sanitize(light)
        self._send_json(200, light, etag=etag)

    def _serve_node_detail(self):
        if not self.state_folder:
            self._send_json(404, {"error": "No folder configured"})
            return
        qs = parse_qs(urlparse(self.path).query)
        node_ids = qs.get("node_id", [])
        if not node_ids:
            self._send_json(400, {"error": "Missing node_id parameter"})
            return
        node_id = node_ids[0]

        data, _ = self._load_state()
        if data is None:
            self._send_json(500, {"error": "Could not load state"})
            return

        for node in data.get("tree_structure", {}).get("nodes", []):
            if node.get("id") == node_id:
                eval_output = node.get("eval_output", "")
                # Try detail file if trimmed (Phase 3 optimization).
                if len(eval_output) <= 500:
                    detail_path = os.path.join(
                        self.state_folder, ".treevee", "details", "nodes", f"{node_id}.json"
                    )
                    try:
                        with open(detail_path) as f:
                            detail = json.load(f)
                        eval_output = detail.get("eval_output", eval_output)
                    except (OSError, json.JSONDecodeError):
                        pass
                self._send_json(200, {"eval_output": eval_output})
                return

        self._send_json(404, {"error": f"Node {node_id} not found"})

    def _serve_history_detail(self):
        if not self.state_folder:
            self._send_json(404, {"error": "No folder configured"})
            return
        qs = parse_qs(urlparse(self.path).query)
        iters = qs.get("iter", [])
        if not iters:
            self._send_json(400, {"error": "Missing iter parameter"})
            return
        try:
            target_iter = int(iters[0])
        except ValueError:
            self._send_json(400, {"error": "iter must be an integer"})
            return

        data, _ = self._load_state()
        if data is None:
            self._send_json(500, {"error": "Could not load state"})
            return

        for entry in data.get("history", []):
            if entry.get("iter") == target_iter:
                # Return only the large text fields.
                detail = {f: entry.get(f, "") for f in self._LARGE_HISTORY_FIELDS}
                # Try detail file if stripped (Phase 3 optimization).
                if not any(detail.values()):
                    detail_path = os.path.join(
                        self.state_folder, ".treevee", "details", "history", f"{target_iter}.json"
                    )
                    try:
                        with open(detail_path) as f:
                            detail = json.load(f)
                    except (OSError, json.JSONDecodeError):
                        pass
                self._send_json(200, detail)
                return

        self._send_json(404, {"error": f"History entry {target_iter} not found"})

    def _serve_diff_from_root(self):
        if not self.state_folder:
            self._send_json(404, {"error": "No folder configured"})
            return
        qs = parse_qs(urlparse(self.path).query)
        node_ids = qs.get("node_id", [])
        if not node_ids:
            self._send_json(400, {"error": "Missing node_id parameter"})
            return
        node_id = node_ids[0]

        state, _ = self._load_state()
        if state is None:
            self._send_json(500, {"error": "Could not load state"})
            return

        nodes = state.get("tree_structure", {}).get("nodes", [])
        root_node = next((n for n in nodes if n.get("parent_id") is None), None)
        target_node = next((n for n in nodes if n.get("id") == node_id), None)

        if not root_node:
            self._send_json(404, {"error": "Root node not found in state"})
            return
        if not target_node:
            self._send_json(404, {"error": f"Node {node_id} not found in state"})
            return

        snaps_dir = os.path.join(self.state_folder, ".treevee", "snapshots")

        def find_snap(node):
            named = os.path.join(snaps_dir, f"iter_snapshot_{node['id'][:8]}")
            if os.path.isdir(named):
                return named
            pre = os.path.join(snaps_dir, f"iter_snapshot_pre_{node['step']}")
            if os.path.isdir(pre):
                return pre
            return None

        root_snap = find_snap(root_node)
        node_snap = find_snap(target_node)

        if root_snap and node_snap:
            diff_text = self._compute_snapshots_diff(root_snap, node_snap)
            self._send_json(200, {"diff_text": diff_text})
            return

        # Fall back: chain history diff_texts along parent path to this node.
        node_by_id = {n["id"]: n for n in nodes}
        history_by_step = {e["iter"]: e for e in state.get("history", [])}
        _history_detail_cache = {}

        def _get_diff_text(step):
            entry = history_by_step.get(step)
            if not entry:
                return ""
            diff_text = entry.get("diff_text", "")
            if diff_text:
                return diff_text
            # Try loading from detail file (Phase 3 trim).
            if step not in _history_detail_cache:
                detail_path = os.path.join(
                    self.state_folder, ".treevee", "details", "history", f"{step}.json"
                )
                try:
                    with open(detail_path) as f:
                        _history_detail_cache[step] = json.load(f)
                except (OSError, json.JSONDecodeError):
                    _history_detail_cache[step] = {}
            return _history_detail_cache[step].get("diff_text", "")

        path_steps = []
        cur = target_node
        while cur and cur.get("parent_id") is not None:
            diff_text = _get_diff_text(cur["step"])
            if diff_text.strip():
                path_steps.append(diff_text)
            cur = node_by_id.get(cur["parent_id"])
        path_steps.reverse()

        self._send_json(200, {"diff_text": "\n".join(path_steps)})

    @staticmethod
    def _compute_snapshots_diff(root_snap: str, node_snap: str) -> str:
        root_path = Path(root_snap)
        node_path = Path(node_snap)

        def collect_files(base: Path) -> dict[str, str]:
            files = {}
            for p in sorted(base.rglob("*")):
                if p.is_file() and p.name != ".deleted_files":
                    rel = str(p.relative_to(base))
                    try:
                        files[rel] = p.read_text(encoding="utf-8", errors="replace")
                    except Exception:
                        pass
            return files

        root_files = collect_files(root_path)
        node_files = collect_files(node_path)
        all_paths = sorted(set(root_files) | set(node_files))

        parts = []
        for rel in all_paths:
            old_text = root_files.get(rel, "")
            new_text = node_files.get(rel, "")
            if old_text == new_text:
                continue
            diff = difflib.unified_diff(
                old_text.splitlines(keepends=True),
                new_text.splitlines(keepends=True),
                fromfile=f"a/{rel}",
                tofile=f"b/{rel}",
            )
            parts.append("".join(diff))

        return "\n".join(parts) if parts else ""

    def _send_json(self, code, data, etag=None):
        body = json.dumps(data).encode("utf-8")
        content_encoding = None

        # Gzip compression if the client supports it and body is large enough.
        accept_encoding = self.headers.get("Accept-Encoding", "")
        if len(body) > 1024 and "gzip" in accept_encoding:
            buf = BytesIO()
            with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=6) as f:
                f.write(body)
            compressed = buf.getvalue()
            if len(compressed) < len(body):  # only use if actually smaller
                body = compressed
                content_encoding = "gzip"

        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if content_encoding:
            self.send_header("Content-Encoding", content_encoding)
        if etag:
            self.send_header("ETag", etag)
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


def start_server(folder=None, port=DEFAULT_PORT, host=HOST, open_browser=True):
    """Start the visualizer server, optionally blocking until interrupted.

    Args:
        folder: Directory containing .treevee/state.json to auto-load.
        port: Port to listen on.
        host: Host to bind to.
        open_browser: Whether to open a browser tab on startup.

    Returns:
        The HTTPServer instance (caller is responsible for serving/stopping).
    """
    webapp_dir = os.path.dirname(os.path.abspath(__file__))

    EvorunHandler.state_folder = os.path.abspath(folder) if folder else None
    EvorunHandler.webapp_dir = webapp_dir

    server = http.server.HTTPServer((host, port), EvorunHandler)

    if folder:
        print(f"Evorun Visualizer -> {host}:{port}")
        print(f"Loading: {os.path.join(folder, STATE_FILE)}")
    else:
        print(f"Evorun Visualizer -> {host}:{port}")
        print("Drop a .treevee/state.json file or click Load")

    if open_browser:
        url = f"http://{host}:{port}"
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()

    return server


def main():
    args = parse_server_args()
    server = start_server(
        folder=args.folder,
        port=args.port,
        open_browser=True,
    )

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()
