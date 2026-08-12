#!/usr/bin/env python3
import os
import subprocess
import time
import sys

home = os.path.expanduser("~")
node_bin = os.path.join(home, ".local/share/fnm/node-versions/v22.23.2/installation/bin")
cargo_bin = os.path.join(home, ".cargo/bin")
path = f"{node_bin}:{cargo_bin}:/usr/bin:/bin:" + os.environ.get("PATH", "")

env = os.environ.copy()
env["PATH"] = path
env["PKG_CONFIG_PATH"] = "/usr/lib/x86_64-linux-gnu/pkgconfig:" + env.get("PKG_CONFIG_PATH", "")
env["DISPLAY"] = env.get("DISPLAY", ":0")
env["WEBKIT_DISABLE_DMABUF_RENDERER"] = "1"
env["WEBKIT_DISABLE_COMPOSITING_MODE"] = "1"
env["GDK_BACKEND"] = "x11"

proj = "/home/sandeep/Documents/projects/technodweep/gitGUI1"
os.chdir(proj)

bad = os.path.join(proj, ".git/objects/f7/4801ad371589e1ea8af05eb7e0c5fcc9bcc7d5")
try:
    os.remove(bad)
except FileNotFoundError:
    pass

subprocess.run(
    ["/usr/bin/fuser", "-k", "1430/tcp"],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
subprocess.run(
    ["/usr/bin/pkill", "-x", "git-workspace"],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)
time.sleep(0.5)

npm = os.path.join(node_bin, "npm")
node = os.path.join(node_bin, "node")
log_path = os.path.join(proj, "tauri-dev.log")
status_path = os.path.join(proj, "tauri-start-status.txt")

if not os.path.exists(npm):
    with open(status_path, "w") as f:
        f.write(f"started: N\nPID: N/A\nerror: npm not found at {npm}\n")
    sys.exit(1)

logf = open(log_path, "w")
# npm is a shell script with node shebang — invoke via absolute path
p = subprocess.Popen(
    [npm, "run", "tauri:dev"],
    cwd=proj,
    env=env,
    stdout=logf,
    stderr=subprocess.STDOUT,
    start_new_session=True,
)

# Give it a moment to surface early failures
time.sleep(8)
alive = p.poll() is None
errors = []
try:
    with open(log_path, "r", errors="replace") as lf:
        content = lf.read()
    for line in content.splitlines():
        low = line.lower()
        if "error" in low or "failed" in low or "cannot" in low or "panic" in low:
            errors.append(line)
except Exception as e:
    errors.append(f"could not read log: {e}")

with open(status_path, "w") as f:
    f.write(f"started: {'Y' if alive else 'N'}\n")
    f.write(f"PID: {p.pid}\n")
    f.write(f"log: {log_path}\n")
    f.write(f"node: {node} exists={os.path.exists(node)}\n")
    f.write(f"npm: {npm} exists={os.path.exists(npm)}\n")
    if not alive:
        f.write(f"exit_code: {p.returncode}\n")
    f.write("first_compile_errors:\n")
    if errors:
        for e in errors[:40]:
            f.write(f"  {e}\n")
    else:
        f.write("  (none detected in first 8s of log)\n")
    # include tail of log
    f.write("\nlog_tail:\n")
    try:
        with open(log_path, "r", errors="replace") as lf:
            lines = lf.read().splitlines()
        for line in lines[-50:]:
            f.write(f"  {line}\n")
    except Exception:
        pass

print(f"PID={p.pid} alive={alive}")
print(f"status written to {status_path}")
