#!/usr/bin/env python3
"""
Atmosphere desktop agent — reference implementation (Windows).

A minimal local HTTPS service that lets Atmosphere Computer operate a Windows
desktop app (Xactimate) under the same approve-before-submit gate the cloud
browser uses. See README.md for the security model and HTTP surface.

This is a starting point, not a hardened build. It verifies the request
signature and timestamp, serves one virtual screen at a fixed size, and maps
Computer's actions onto Windows input. Sign-in types a username/password into
the focused window's fields and keeps nothing.

Run:
    python reference_agent.py --port 8443 --cert cert.pem --key key.pem
Secret comes from the ATMOS_DESKTOP_AGENT_SECRET environment variable (same
value the backend holds in COMPUTER_DESKTOP_AGENT_SECRET).

Dependencies (install on the Windows host):
    pip install pywinauto pillow mss pynput
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import io
import json
import os
import ssl
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "0.1.0"
MAX_SKEW_SECONDS = 60

# Apps this agent may launch, by the id the backend uses. Keep in step with the
# backend's DESKTOP_APPS. The value is how to start the app on this machine.
APPS = {
    "xactimate": {
        "launch": [r"C:\Program Files\Xactware\Xactimate\Xactimate.exe"],
        "sign_in_host": "identity.xactware.com",
    },
}


def _const_eq(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def _expected_sig(secret: str, method: str, path: str, ts: str, body: bytes) -> str:
    body_hash = hashlib.sha256(body).hexdigest()
    msg = f"{method.upper()}\n{path}\n{ts}\n{body_hash}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


class Desktop:
    """Thin wrapper over screen capture and input. Imports lazily so --help works anywhere."""

    def __init__(self, width: int, height: int) -> None:
        self.width = width
        self.height = height

    def screenshot(self, fmt: str) -> str:
        import mss
        from PIL import Image

        with mss.mss() as sct:
            raw = sct.grab(sct.monitors[1])
        img = Image.frombytes("RGB", raw.size, raw.rgb).resize((self.width, self.height))
        buf = io.BytesIO()
        img.save(buf, format="JPEG" if fmt == "jpeg" else "PNG", quality=70)
        return base64.b64encode(buf.getvalue()).decode("ascii")

    def _scale(self, x: int, y: int) -> tuple[int, int]:
        import mss

        with mss.mss() as sct:
            mon = sct.monitors[1]
        return int(x / self.width * mon["width"]), int(y / self.height * mon["height"])

    def input(self, a: dict) -> None:
        from pynput.keyboard import Controller as K, Key
        from pynput.mouse import Button, Controller as M

        mouse, kb = M(), K()
        action = a.get("action")
        if action in ("click", "move", "down", "up", "scroll"):
            sx, sy = self._scale(int(a.get("x", 0)), int(a.get("y", 0)))
            mouse.position = (sx, sy)
        btn = {"left": Button.left, "right": Button.right, "middle": Button.middle}.get(a.get("button", "left"), Button.left)
        if action == "move":
            return
        if action == "click":
            mouse.click(btn, int(a.get("clickCount", 1)))
        elif action == "down":
            mouse.press(btn)
        elif action == "up":
            mouse.release(btn)
        elif action == "drag":
            fx, fy = self._scale(*a["from"])
            tx, ty = self._scale(*a["to"])
            mouse.position = (fx, fy)
            mouse.press(Button.left)
            mouse.position = (tx, ty)
            mouse.release(Button.left)
        elif action == "scroll":
            dy = int(a.get("amount", 3))
            mouse.scroll(0, -dy if a.get("direction") == "down" else dy)
        elif action == "type":
            kb.type(str(a.get("text", "")))
        elif action == "key":
            self._key(kb, Key, str(a.get("combo", "")), int(a.get("repeat", 1)))

    def _key(self, kb, Key, combo: str, repeat: int) -> None:
        names = {
            "return": Key.enter, "enter": Key.enter, "tab": Key.tab, "backspace": Key.backspace,
            "escape": Key.esc, "delete": Key.delete, "up": Key.up, "down": Key.down,
            "left": Key.left, "right": Key.right, "home": Key.home, "end": Key.end,
            "page_up": Key.page_up, "page_down": Key.page_down, "ctrl": Key.ctrl,
            "alt": Key.alt, "shift": Key.shift, "super": Key.cmd,
        }
        parts = [p.strip().lower() for p in combo.split("+") if p.strip()]
        if not parts:
            return
        *mods, last = parts
        mod_keys = [names.get(m, m) for m in mods]
        tap = names.get(last, last)
        for _ in range(max(1, repeat)):
            for m in mod_keys:
                kb.press(m)
            kb.press(tap)
            kb.release(tap)
            for m in reversed(mod_keys):
                kb.release(m)


class Agent:
    def __init__(self) -> None:
        self.desktop = Desktop(1280, 800)

    def handle(self, path: str, body: dict) -> dict:
        if path == "/session/start":
            self.desktop = Desktop(int(body.get("width", 1280)), int(body.get("height", 800)))
            return {"ok": True}
        if path == "/session/end":
            return {"ok": True}
        if path == "/screenshot":
            return {"image": self.desktop.screenshot(body.get("format", "png"))}
        if path == "/input":
            self.desktop.input(body)
            return {"ok": True}
        if path == "/launch":
            return self._launch(str(body.get("app", "")))
        if path == "/open-url":
            os.startfile(str(body["url"]))  # noqa: S606 — opens the default browser
            return {"ok": True}
        if path == "/window":
            return self._window()
        if path in ("/element-at", "/focused", "/fields", "/text", "/signals", "/cursor", "/signin"):
            # The reference build returns empty structures for the inspection
            # endpoints; a production build fills them from UI Automation.
            return self._inspect(path, body)
        return {"error": "unknown path"}

    def _launch(self, app_id: str) -> dict:
        app = APPS.get(app_id)
        if not app:
            return {"error": "unknown app"}
        subprocess.Popen(app["launch"])  # noqa: S603
        return {"ok": True, "app": app_id}

    def _window(self) -> dict:
        # A production build reads the foreground window via UI Automation.
        return {"kind": "app", "app": None, "title": None, "url": None, "signIn": False}

    def _inspect(self, path: str, body: dict) -> dict:
        if path == "/fields":
            return {"fields": []}
        if path == "/text":
            return {"text": ""}
        if path == "/signals":
            return {"text": "", "hasPasswordField": False, "hasOneTimeCodeField": False}
        if path == "/cursor":
            return {"x": 0, "y": 0}
        if path == "/signin":
            # Type username, Tab, password, Enter into the focused sign-in form.
            from pynput.keyboard import Controller as K, Key

            kb = K()
            kb.type(str(body.get("username", "")))
            kb.press(Key.tab)
            kb.release(Key.tab)
            kb.type(str(body.get("password", "")))
            kb.press(Key.enter)
            kb.release(Key.enter)
            return {"result": "submitted"}
        return {}


def make_handler(agent: Agent, secret: str):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args) -> None:  # never log requests
            pass

        def _send(self, code: int, payload: dict) -> None:
            data = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/health":
                self._send(200, {"ok": True, "version": VERSION})
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            length = int(self.headers.get("content-length", "0") or "0")
            body = self.rfile.read(length) if length else b""
            ts = self.headers.get("x-atmos-timestamp", "")
            sig = self.headers.get("x-atmos-signature", "")
            if not ts.isdigit() or abs(time.time() * 1000 - int(ts)) > MAX_SKEW_SECONDS * 1000:
                self._send(401, {"error": "stale or missing timestamp"})
                return
            if not _const_eq(sig, _expected_sig(secret, "POST", self.path, ts, body)):
                self._send(403, {"error": "bad signature"})
                return
            try:
                parsed = json.loads(body) if body else {}
                self._send(200, agent.handle(self.path, parsed))
            except Exception as exc:  # noqa: BLE001 — never leak detail to the caller
                self._send(500, {"error": type(exc).__name__})

    return Handler


def main() -> None:
    ap = argparse.ArgumentParser(description="Atmosphere desktop agent (reference)")
    ap.add_argument("--port", type=int, default=8443)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--cert", required=True)
    ap.add_argument("--key", required=True)
    args = ap.parse_args()

    secret = os.environ.get("ATMOS_DESKTOP_AGENT_SECRET", "")
    if len(secret) < 32:
        raise SystemExit("Set ATMOS_DESKTOP_AGENT_SECRET to the 32+ char secret the backend holds.")

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=args.cert, keyfile=args.key)
    httpd = ThreadingHTTPServer((args.host, args.port), make_handler(Agent(), secret))
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    print(f"Atmosphere desktop agent {VERSION} on https://{args.host}:{args.port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
