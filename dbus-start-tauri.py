#!/usr/bin/env python3
"""Start git-workspace-tauri-dev.service via systemd user D-Bus (no bash)."""
import os
import sys
import time

STATUS = "/home/sandeep/Documents/projects/technodweep/gitGUI1/tauri-start-status.txt"

def main():
    try:
        import dbus  # type: ignore
    except Exception:
        # Prefer jeepney/raw if dbus module missing - fall back to subprocess systemd
        try:
            import subprocess
            r = subprocess.run(
                ["/usr/bin/systemctl", "--user", "daemon-reload"],
                capture_output=True, text=True
            )
            r2 = subprocess.run(
                ["/usr/bin/systemctl", "--user", "start", "git-workspace-tauri-dev.service"],
                capture_output=True, text=True
            )
            with open(STATUS, "w") as f:
                f.write(f"started: {'Y' if r2.returncode==0 else 'N'}\n")
                f.write(f"method: systemctl subprocess\n")
                f.write(f"daemon_reload_rc={r.returncode}\n")
                f.write(f"start_rc={r2.returncode}\n")
                f.write(f"stdout={r2.stdout}\nstderr={r2.stderr}\n")
            return r2.returncode
        except Exception as e:
            with open(STATUS, "w") as f:
                f.write(f"started: N\nerror: {e}\n")
            return 1

    bus = dbus.SessionBus()
    systemd = bus.get_object("org.freedesktop.systemd1", "/org/freedesktop/systemd1")
    manager = dbus.Interface(systemd, "org.freedesktop.systemd1.Manager")
    try:
        manager.Reload()
    except Exception as e:
        pass
    try:
        job = manager.StartUnit("git-workspace-tauri-dev.service", "replace")
        with open(STATUS, "w") as f:
            f.write("started: Y\n")
            f.write("method: dbus StartUnit\n")
            f.write(f"job: {job}\n")
            f.write("PID: (see service MainPID after start)\n")
        # Wait for python launcher to write fuller status
        time.sleep(12)
        return 0
    except Exception as e:
        with open(STATUS, "w") as f:
            f.write(f"started: N\nmethod: dbus\nerror: {e}\n")
        return 1

if __name__ == "__main__":
    sys.exit(main())
