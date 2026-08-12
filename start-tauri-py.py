#!/usr/bin/env python3
"""Start Git Workspace tauri:dev without relying on bash-login wrappers.
Absolute paths only. Does not kill other cargo/rust projects.
"""
from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path("/home/sandeep/Documents/projects/technodweep/gitGUI1")
STATUS = ROOT / "tauri-start-status.txt"
LOG = ROOT / "tauri-dev-last.log"
NODE_BIN = Path.home() / ".local/share/fnm/node-versions/v22.23.2/installation/bin"
CARGO_BIN = Path.home() / ".cargo/bin"
NPM = NODE_BIN / "npm"
NODE = NODE_BIN / "node"
CORRUPT_OBJ = ROOT / ".git/objects/f7/4801ad371589e1ea8af05eb7e0c5fcc9bcc7d5"
PORT = 1430


def write_status(text: str) -> None:
    STATUS.write_text(text, encoding="utf-8")


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


def free_port_1430() -> None:
    # Prefer fuser if present; fall back to /proc scan for LISTEN on 1430 only.
    fuser = Path("/usr/bin/fuser")
    if fuser.exists():
        subprocess.run(
            [str(fuser), "-k", f"{PORT}/tcp"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        time.sleep(0.4)
        return
    # Minimal /proc net fallback is intentionally omitted (needs hex parse).


def kill_old_git_workspace() -> None:
    # Exact binary name only.
    pkill = Path("/usr/bin/pkill")
    if pkill.exists():
        subprocess.run(
            [str(pkill), "-x", "git-workspace"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )


def main() -> int:
    lines: list[str] = []
    lines.append("# tauri-start-status")
    lines.append(f"time={time.strftime('%Y-%m-%dT%H:%M:%S%z')}")
    lines.append(f"cwd={ROOT}")
    lines.append(f"node={NODE} exists={NODE.exists()}")
    lines.append(f"npm={NPM} exists={NPM.exists()}")

    if not NPM.exists() or not NODE.exists():
        lines.append("started=NO")
        lines.append("error=node/npm not found at expected fnm path")
        write_status("\n".join(lines) + "\n")
        return 1

    if CORRUPT_OBJ.exists():
        try:
            CORRUPT_OBJ.unlink()
            lines.append("removed_corrupt_git_object=yes")
        except OSError as e:
            lines.append(f"removed_corrupt_git_object=failed:{e}")
    else:
        lines.append("removed_corrupt_git_object=already_absent")

    free_port_1430()
    kill_old_git_workspace()
    lines.append(f"port_{PORT}_after_free={port_in_use(PORT)}")

    env = os.environ.copy()
    path_parts = [
        str(NODE_BIN),
        str(CARGO_BIN),
        "/usr/bin",
        "/bin",
        env.get("PATH", ""),
    ]
    env["PATH"] = ":".join(p for p in path_parts if p)
    env["PKG_CONFIG_PATH"] = (
        "/usr/lib/x86_64-linux-gnu/pkgconfig:" + env.get("PKG_CONFIG_PATH", "")
    )
    env["DISPLAY"] = env.get("DISPLAY") or ":0"
    env["WEBKIT_DISABLE_DMABUF_RENDERER"] = "1"
    env["WEBKIT_DISABLE_COMPOSITING_MODE"] = "1"
    env["GDK_BACKEND"] = "x11"

    log_f = open(LOG, "w", encoding="utf-8", buffering=1)
    # npm run tauri:dev — shell=False
    proc = subprocess.Popen(
        [str(NPM), "run", "tauri:dev"],
        cwd=str(ROOT),
        env=env,
        stdout=log_f,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    lines.append(f"npm_pid={proc.pid}")
    lines.append("command=npm run tauri:dev")
    lines.append("started=YES (process launched; await compile)")

    # Wait briefly for early failures
    time.sleep(8)
    rc = proc.poll()
    # Read first log chunk
    try:
        log_text = LOG.read_text(encoding="utf-8", errors="replace")
    except OSError:
        log_text = ""
    first_lines = "\n".join(log_text.splitlines()[:80])
    lines.append(f"still_running={rc is None}")
    if rc is not None:
        lines.append(f"exit_code={rc}")
        lines.append("started=NO (exited early)")
    lines.append("--- log head ---")
    lines.append(first_lines)
    write_status("\n".join(lines) + "\n")
    return 0 if rc is None else rc


if __name__ == "__main__":
    sys.exit(main())
