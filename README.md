# Git Workspace

Desktop Git GUI for multi-repo **projects**, with **environments** that map each repo to a default branch and one-click bulk checkout.

Built with **Tauri 2 + React + TypeScript**.

## Features

- **Projects** — add a workspace from a folder scan and/or manual repo paths
  (the same repo folder can belong to **multiple projects**)
- **Repos** — branch, dirty state, ahead/behind, last commit; enable/disable
- **Fetch all / Pull all / Push all** — batch ops on enabled repos
  (`fetch --all --prune`, `pull --ff-only`, `push` with auto `-u origin` if needed)
- **Per-repo actions** — Fetch / Pull / Push / **Stage** (stage/unstage/**discard**/commit + **diff**) /
  **History** (detach / branch here) / **Branches** (create/delete) / **Folder**
- **Single-repo branch switch** — checkout a local (or origin/) branch
- **Environments** — e.g. `development`, `staging` with per-repo target branches
- **Environment switcher** — live **dry-run preview** plus bulk checkout with
  optional **stash if dirty**, **pop stash after switch**, and **fetch first**

## Requirements

- Node.js 20+
- Rust (stable) + Cargo
- System `git` on `PATH`
- Linux: WebKitGTK 4.1 and related Tauri system deps  
  (e.g. `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`, `patchelf`)

## Run

```bash
npm install
npm run tauri:dev
```

Or:

```bash
npm run tauri dev
```

### Blank window / GPU errors (Linux)

If the window is blank and the terminal shows something like:

```text
Failed to create GBM buffer ... Permission denied
KMS: DRM_IOCTL_MODE_CREATE_DUMB failed
```

that is a known **WebKitGTK + GPU (often NVIDIA)** issue. The app sets safe defaults automatically; you can also force them:

```bash
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
npm run tauri dev
```

If it is still blank, try software rendering:

```bash
export LIBGL_ALWAYS_SOFTWARE=1
export GDK_BACKEND=x11
npm run tauri dev
```

Production build:

```bash
npm run tauri:build
```

## Data

App state is stored in SQLite under the OS app data directory  
(e.g. `~/.local/share/com.technodweep.gitworkspace/git-workspace.db` on Linux).

## Screens

| Route | Purpose |
|-------|---------|
| `/` | Project list / create |
| `/projects/:id` | Repos, status, per-repo checkout |
| `/projects/:id/environments` | Create/edit environments & branch maps |
| `/projects/:id/switch` | Bulk switch to an environment |

## Out of scope (for now)

Commit/stage/push/pull, PR integration, auto-stash, submodules/worktrees.
