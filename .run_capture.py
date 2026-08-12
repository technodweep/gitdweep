#!/usr/bin/env python3
"""Capture npm run tauri:dev / cargo check / tsc output for debugging.
Run manually if the agent shell cannot spawn /bin/bash:
  python3 .run_capture.py
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "tauri-dev-capture.log"

env = os.environ.copy()
home = Path.home()
env["PATH"] = (
    f"{home}/.local/share/fnm/node-versions/v22.23.2/installation/bin:"
    f"{home}/.cargo/bin:/usr/bin:/bin:"
    + env.get("PATH", "")
)
env["PKG_CONFIG_PATH"] = (
    "/usr/lib/x86_64-linux-gnu/pkgconfig:" + env.get("PKG_CONFIG_PATH", "")
)
env["WEBKIT_DISABLE_DMABUF_RENDERER"] = "1"
env["WEBKIT_DISABLE_COMPOSITING_MODE"] = "1"
env["DISPLAY"] = env.get("DISPLAY", ":0")
env["GDK_BACKEND"] = env.get("GDK_BACKEND", "x11")
env["LIBGL_ALWAYS_SOFTWARE"] = env.get("LIBGL_ALWAYS_SOFTWARE", "1")


def run(label: str, cmd: list[str], timeout: int | None = 180) -> int:
    lines = [f"\n===== {label} =====", f"$ {' '.join(cmd)}"]
    try:
        p = subprocess.run(
            cmd,
            cwd=str(ROOT),
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if p.stdout:
            lines.append(p.stdout)
        if p.stderr:
            lines.append("--- stderr ---")
            lines.append(p.stderr)
        lines.append(f"exit_code={p.returncode}")
        code = p.returncode
    except subprocess.TimeoutExpired as e:
        out = e.stdout if isinstance(e.stdout, str) else (e.stdout or b"").decode(errors="replace")
        err = e.stderr if isinstance(e.stderr, str) else (e.stderr or b"").decode(errors="replace")
        lines.append(out or "")
        lines.append("--- stderr ---")
        lines.append(err or "")
        lines.append(f"TIMEOUT after {timeout}s")
        code = 124
    except Exception as e:
        lines.append(f"EXCEPTION: {type(e).__name__}: {e}")
        code = 1
    text = "\n".join(lines) + "\n"
    with OUT.open("a", encoding="utf-8") as f:
        f.write(text)
    print(text, flush=True)
    return code


def main() -> int:
    if OUT.exists():
        OUT.unlink()
    with OUT.open("w", encoding="utf-8") as f:
        f.write("Git Workspace capture log\n")

    run(
        "toolchain",
        [
            "bash",
            "-lc",
            "node -v; npm -v; rustc --version; which cargo; which tauri || true",
        ],
        30,
    )
    run("cargo check", ["cargo", "check", "--manifest-path", "src-tauri/Cargo.toml"], 300)
    run("tsc --noEmit", ["npx", "tsc", "--noEmit"], 120)
    run(
        "free port 1430",
        [
            "bash",
            "-lc",
            "fuser -k 1430/tcp 2>/dev/null || true; pkill -x git-workspace 2>/dev/null || true; true",
        ],
        15,
    )
    return run("npm run tauri:dev", ["npm", "run", "tauri:dev"], 180)


if __name__ == "__main__":
    sys.exit(main())
