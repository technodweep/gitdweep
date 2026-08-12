use crate::models::RepoStatus;
use std::path::Path;
use std::process::Command;

fn run_git(repo: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let out = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !err.is_empty() {
            Err(err)
        } else if !out.is_empty() {
            Err(out)
        } else {
            Err(format!("git {:?} failed", args))
        }
    }
}

/// Like run_git but includes stderr on success (for pull/fetch/push messages).
fn run_git_with_stderr(repo: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(repo)
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let combined = [stdout.as_str(), stderr.as_str()]
        .iter()
        .filter(|s| !s.is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");

    if output.status.success() {
        Ok(if combined.is_empty() {
            "ok".into()
        } else {
            combined
        })
    } else {
        Err(if combined.is_empty() {
            format!("git {:?} failed", args)
        } else {
            combined
        })
    }
}

pub fn truncate_msg(msg: &str, max: usize) -> String {
    if msg.len() > max {
        format!("{}…", &msg[..max.saturating_sub(1)])
    } else {
        msg.to_string()
    }
}

pub fn repo_status(repo_id: &str, path: &str) -> RepoStatus {
    let p = Path::new(path);
    if !p.exists() {
        return RepoStatus {
            repo_id: repo_id.to_string(),
            path: path.to_string(),
            current_branch: None,
            is_detached: false,
            is_dirty: false,
            ahead: None,
            behind: None,
            last_commit: None,
            last_commit_at: None,
            error: Some("Path does not exist".into()),
        };
    }

    let branch_result = run_git(p, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let (current_branch, is_detached, branch_err) = match branch_result {
        Ok(b) if b == "HEAD" => {
            let sha = run_git(p, &["rev-parse", "--short", "HEAD"]).ok();
            (sha, true, None)
        }
        Ok(b) => (Some(b), false, None),
        Err(e) => (None, false, Some(e)),
    };

    let is_dirty = if branch_err.is_some() {
        false
    } else {
        match run_git(p, &["status", "--porcelain"]) {
            Ok(s) => !s.is_empty(),
            Err(_) => false,
        }
    };

    let (ahead, behind) = if branch_err.is_none() && !is_detached {
        ahead_behind(p)
    } else {
        (None, None)
    };

    let (last_commit, last_commit_at) = if branch_err.is_none() {
        (
            run_git(p, &["log", "-1", "--format=%s"]).ok(),
            run_git(p, &["log", "-1", "--format=%cr"]).ok(),
        )
    } else {
        (None, None)
    };

    RepoStatus {
        repo_id: repo_id.to_string(),
        path: path.to_string(),
        current_branch,
        is_detached,
        is_dirty,
        ahead,
        behind,
        last_commit,
        last_commit_at,
        error: branch_err,
    }
}

fn ahead_behind(repo: &Path) -> (Option<i64>, Option<i64>) {
    match run_git(repo, &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]) {
        Ok(s) => {
            let parts: Vec<&str> = s.split_whitespace().collect();
            if parts.len() >= 2 {
                let a = parts[0].parse::<i64>().ok();
                let b = parts[1].parse::<i64>().ok();
                (a, b)
            } else {
                (None, None)
            }
        }
        Err(_) => (None, None),
    }
}

pub fn list_branches(path: &str) -> Result<Vec<String>, String> {
    let p = Path::new(path);
    let out = run_git(p, &["branch", "--format=%(refname:short)"])?;
    let mut branches: Vec<String> = out
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    branches.sort();
    Ok(branches)
}

pub fn current_branch(path: &str) -> Result<Option<String>, String> {
    let p = Path::new(path);
    let b = run_git(p, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    if b == "HEAD" {
        Ok(None)
    } else {
        Ok(Some(b))
    }
}

pub fn is_dirty(path: &str) -> Result<bool, String> {
    let p = Path::new(path);
    let porcelain = run_git(p, &["status", "--porcelain"])?;
    Ok(!porcelain.is_empty())
}

pub fn stash_push(path: &str, message: &str) -> Result<String, String> {
    let p = Path::new(path);
    run_git_with_stderr(p, &["stash", "push", "-u", "-m", message])
}

pub fn stash_pop(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    run_git_with_stderr(p, &["stash", "pop"])
}

pub fn fetch_all(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    run_git_with_stderr(p, &["fetch", "--all", "--prune"])
}

pub fn pull(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if is_dirty(path)? {
        return Err("Working tree has uncommitted changes".into());
    }
    run_git_with_stderr(p, &["pull", "--ff-only"])
}

/// Push current branch. Sets upstream to origin if missing.
pub fn push(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    let branch = match current_branch(path)? {
        Some(b) => b,
        None => return Err("Detached HEAD — cannot push".into()),
    };

    // Has upstream?
    let has_upstream = run_git(p, &["rev-parse", "--abbrev-ref", "@{upstream}"]).is_ok();
    if has_upstream {
        run_git_with_stderr(p, &["push"])
    } else {
        run_git_with_stderr(p, &["push", "-u", "origin", &branch])
            .map(|m| format!("Set upstream origin/{branch} and pushed\n{m}"))
    }
}

pub fn change_summary(path: &str) -> Result<String, String> {
    let files = list_changed_files(path)?;
    if files.is_empty() {
        return Ok("No changes".into());
    }
    let mut modified = 0;
    let mut added = 0;
    let mut deleted = 0;
    let mut untracked = 0;
    for f in &files {
        match f.status.as_str() {
            "?" | "??" => untracked += 1,
            "A" => added += 1,
            "D" => deleted += 1,
            _ => modified += 1,
        }
    }
    Ok(format!(
        "{} file(s): ~{modified} +{added} -{deleted} ?{untracked}",
        files.len()
    ))
}

/// Parse `git diff --name-status` lines into (status_letter, path).
fn parse_name_status(out: &str) -> Vec<(String, String)> {
    let mut items = Vec::new();
    for line in out.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        // Formats: "M\tpath", "A\tpath", "R100\told\tnew", "C050\told\tnew"
        let mut parts = line.split('\t');
        let code = parts.next().unwrap_or("").trim();
        if code.is_empty() {
            continue;
        }
        let status = code.chars().next().unwrap_or('M').to_string();
        // For rename/copy, last field is the new path
        let paths: Vec<&str> = parts.collect();
        let file_path = paths
            .last()
            .map(|s| s.trim().trim_matches('"').to_string())
            .unwrap_or_default();
        if file_path.is_empty() {
            continue;
        }
        items.push((status, file_path));
    }
    items
}

pub fn list_changed_files(path: &str) -> Result<Vec<crate::models::ChangedFile>, String> {
    use crate::models::ChangedFile;
    use std::collections::BTreeMap;
    let p = Path::new(path);

    // Independent lists — avoids porcelain "XY" column bugs (e.g. first row wrong).
    let staged_items = parse_name_status(
        &run_git(p, &["diff", "--cached", "--name-status"]).unwrap_or_default(),
    );
    let unstaged_items =
        parse_name_status(&run_git(p, &["diff", "--name-status"]).unwrap_or_default());
    let untracked: Vec<String> =
        run_git(p, &["ls-files", "--others", "--exclude-standard"])
            .unwrap_or_default()
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();

    // path -> (staged_letter, unstaged_letter, is_untracked)
    let mut map: BTreeMap<String, (Option<char>, Option<char>, bool)> = BTreeMap::new();

    for (st, file_path) in staged_items {
        let ch = st.chars().next().unwrap_or('M');
        let e = map.entry(file_path).or_insert((None, None, false));
        e.0 = Some(ch);
    }
    for (st, file_path) in unstaged_items {
        let ch = st.chars().next().unwrap_or('M');
        let e = map.entry(file_path).or_insert((None, None, false));
        e.1 = Some(ch);
    }
    for file_path in untracked {
        let e = map.entry(file_path).or_insert((None, None, false));
        e.2 = true;
        e.1 = Some('?');
    }

    let mut out = Vec::new();
    for (file_path, (staged_ch, unstaged_ch, is_untracked)) in map {
        let staged = staged_ch.is_some();
        let unstaged = unstaged_ch.is_some() || is_untracked;
        let status = if is_untracked {
            "?".into()
        } else if let Some(c) = unstaged_ch {
            c.to_string()
        } else if let Some(c) = staged_ch {
            c.to_string()
        } else {
            "M".into()
        };
        out.push(ChangedFile {
            path: file_path,
            status,
            staged,
            unstaged,
        });
    }
    Ok(out)
}

pub fn stage_paths(path: &str, paths: &[String]) -> Result<(), String> {
    let p = Path::new(path);
    if paths.is_empty() {
        return Err("No files selected".into());
    }
    // Stages new/modified/deleted for each pathspec
    let mut args = vec!["add".to_string(), "--".to_string()];
    args.extend(paths.iter().cloned());
    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_git(p, &args_ref)?;
    Ok(())
}

/// Unstage paths (keep working tree). Uses `git restore --staged`.
pub fn unstage_paths(path: &str, paths: &[String]) -> Result<(), String> {
    let p = Path::new(path);
    if paths.is_empty() {
        return Err("No files selected".into());
    }
    let mut args = vec![
        "restore".to_string(),
        "--staged".to_string(),
        "--".to_string(),
    ];
    args.extend(paths.iter().cloned());
    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_git(p, &args_ref)?;
    Ok(())
}

pub fn stage_all(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    run_git(p, &["add", "-A"])?;
    Ok(())
}

pub fn unstage_all(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    // Reset index to HEAD for all paths
    run_git(p, &["restore", "--staged", "."])?;
    Ok(())
}

/// Discard local changes for paths (destructive).
/// - Tracked: restore index + worktree from HEAD
/// - Untracked: `git clean -f -- path`
pub fn discard_paths(path: &str, paths: &[String]) -> Result<String, String> {
    let p = Path::new(path);
    if paths.is_empty() {
        return Err("No files selected".into());
    }

    let changed = list_changed_files(path).unwrap_or_default();
    let by_path: std::collections::HashMap<String, crate::models::ChangedFile> = changed
        .into_iter()
        .map(|f| (f.path.clone(), f))
        .collect();

    let mut tracked: Vec<String> = Vec::new();
    let mut untracked: Vec<String> = Vec::new();

    for pathspec in paths {
        match by_path.get(pathspec) {
            Some(f) if f.status == "?" || f.status == "??" => {
                untracked.push(pathspec.clone());
            }
            Some(_) => tracked.push(pathspec.clone()),
            // Not in status list — try restore anyway if exists under repo
            None => {
                if p.join(pathspec).exists() {
                    // If file is untracked it might still show as ?
                    // Prefer clean for unknown new files
                    let porcelain =
                        run_git(p, &["status", "--porcelain", "--", pathspec]).unwrap_or_default();
                    if porcelain.contains("??") || porcelain.starts_with("??") {
                        untracked.push(pathspec.clone());
                    } else {
                        tracked.push(pathspec.clone());
                    }
                } else {
                    // deleted file in worktree — restore from HEAD
                    tracked.push(pathspec.clone());
                }
            }
        }
    }

    if !tracked.is_empty() {
        let mut args = vec![
            "restore".to_string(),
            "--source=HEAD".to_string(),
            "--staged".to_string(),
            "--worktree".to_string(),
            "--".to_string(),
        ];
        args.extend(tracked.iter().cloned());
        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        run_git(p, &args_ref)?;
    }

    if !untracked.is_empty() {
        let mut args = vec!["clean".to_string(), "-f".to_string(), "--".to_string()];
        args.extend(untracked.iter().cloned());
        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        run_git(p, &args_ref)?;
    }

    Ok(format!(
        "Discarded {} path(s) ({} tracked, {} untracked)",
        paths.len(),
        tracked.len(),
        untracked.len()
    ))
}

/// Stage all, selected paths, or nothing; then commit.
pub fn commit_all(
    path: &str,
    message: &str,
    stage_all: bool,
    paths: Option<&[String]>,
) -> Result<String, String> {
    let p = Path::new(path);
    let msg = message.trim();
    if msg.is_empty() {
        return Err("Commit message is required".into());
    }
    if stage_all {
        run_git(p, &["add", "-A"])?;
    } else if let Some(sel) = paths {
        if !sel.is_empty() {
            stage_paths(path, sel)?;
        }
    }
    let staged = run_git(p, &["diff", "--cached", "--name-only"])?;
    if staged.is_empty() {
        return Err("Nothing staged to commit".into());
    }
    run_git_with_stderr(p, &["commit", "-m", msg])
}

pub fn commit_log(path: &str, limit: usize) -> Result<Vec<crate::models::CommitLogEntry>, String> {
    use crate::models::CommitLogEntry;
    let p = Path::new(path);
    let n = limit.clamp(1, 300).to_string();
    // Include all branches for a SourceTree-like graph; parents for lane layout.
    // Fields: hash, short, subject, author, relative date, parents, decorations
    let out = run_git(
        p,
        &[
            "log",
            "--all",
            "--topo-order",
            &format!("-{n}"),
            "--format=%H%x1f%h%x1f%s%x1f%an%x1f%cr%x1f%P%x1f%D",
        ],
    )
    .map_err(|e| friendly_git_error(&e))?;
    if out.is_empty() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for line in out.lines() {
        let parts: Vec<&str> = line.split('\u{1f}').collect();
        if parts.len() < 5 {
            continue;
        }
        let parents: Vec<String> = parts
            .get(5)
            .unwrap_or(&"")
            .split_whitespace()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();
        let refs: Vec<String> = parts
            .get(6)
            .unwrap_or(&"")
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .map(|s| {
                // Normalize "HEAD -> master" / "origin/main" / "tag: v1"
                s.replace("HEAD -> ", "HEAD→")
                    .replace("tag: ", "")
            })
            .collect();
        entries.push(CommitLogEntry {
            hash: parts[0].to_string(),
            short_hash: parts[1].to_string(),
            subject: parts[2].to_string(),
            author: parts[3].to_string(),
            when: parts[4].to_string(),
            parents,
            refs,
        });
    }
    Ok(entries)
}

fn friendly_git_error(err: &str) -> String {
    let lower = err.to_lowercase();
    if lower.contains("empty") && lower.contains("object")
        || lower.contains("bad object")
        || lower.contains("corrupt")
    {
        format!(
            "This repository looks corrupted (bad/empty git object).\n\n{err}\n\n\
Try in a terminal:\n\
  cd <repo>\n\
  git fsck\n\
  # if HEAD is broken and you have no important commits yet:\n\
  #   rm -rf .git && git init\n\
  # or re-clone the remote."
        )
    } else {
        err.to_string()
    }
}

/// Create a local branch; optionally check it out.
pub fn create_branch(path: &str, name: &str, checkout: bool) -> Result<String, String> {
    let p = Path::new(path);
    let name = name.trim();
    if name.is_empty() {
        return Err("Branch name is required".into());
    }
    if name.contains(' ') || name.contains("..") {
        return Err("Invalid branch name".into());
    }
    // Fail if exists
    if run_git(p, &["show-ref", "--verify", &format!("refs/heads/{name}")]).is_ok() {
        return Err(format!("Branch already exists: {name}"));
    }
    if checkout {
        run_git(p, &["checkout", "-b", name])?;
        Ok(format!("Created and checked out {name}"))
    } else {
        run_git(p, &["branch", name])?;
        Ok(format!("Created branch {name}"))
    }
}

/// Delete a local branch (not the current one).
pub fn delete_branch(path: &str, name: &str, force: bool) -> Result<String, String> {
    let p = Path::new(path);
    let name = name.trim();
    if name.is_empty() {
        return Err("Branch name is required".into());
    }
    if let Ok(Some(cur)) = current_branch(path) {
        if cur == name {
            return Err("Cannot delete the branch you are currently on".into());
        }
    }
    let flag = if force { "-D" } else { "-d" };
    run_git(p, &["branch", flag, name])?;
    Ok(format!("Deleted branch {name}"))
}

/// Checkout a commit (detached HEAD) or create/checkout a branch at that commit.
pub fn checkout_commit(
    path: &str,
    rev: &str,
    new_branch: Option<&str>,
) -> Result<String, String> {
    let p = Path::new(path);
    let rev = rev.trim();
    if rev.is_empty() {
        return Err("Commit hash is required".into());
    }
    if is_dirty(path)? {
        return Err("Working tree has uncommitted changes".into());
    }
    if let Some(b) = new_branch.map(str::trim).filter(|s| !s.is_empty()) {
        run_git(p, &["checkout", "-b", b, rev])?;
        Ok(format!("Created branch {b} at {rev} and checked out"))
    } else {
        run_git(p, &["checkout", "--detach", rev])?;
        Ok(format!("Checked out {rev} (detached HEAD)"))
    }
}

/// Unified-ish diff for a working-tree file (unstaged + staged if present).
pub fn file_diff(path: &str, file_path: &str) -> Result<String, String> {
    let p = Path::new(path);
    let file_path = file_path.trim();
    if file_path.is_empty() {
        return Err("File path is required".into());
    }

    // Prefer unstaged working tree diff; fall back to staged
    let unstaged = run_git(
        p,
        &["diff", "--", file_path],
    )
    .unwrap_or_default();
    let staged = run_git(
        p,
        &["diff", "--cached", "--", file_path],
    )
    .unwrap_or_default();

    // Untracked: show as new file content via /dev/null trick may fail; try status
    if unstaged.is_empty() && staged.is_empty() {
        // untracked file?
        let show = run_git(p, &["status", "--porcelain", "--", file_path]).unwrap_or_default();
        if show.starts_with("??") || show.contains("??") {
            // Read file content as "diff"
            let full = p.join(file_path);
            match std::fs::read_to_string(&full) {
                Ok(content) => {
                    let mut out = format!("Untracked file: {file_path}\n\n");
                    for (i, line) in content.lines().enumerate() {
                        if i >= 400 {
                            out.push_str("… (truncated)\n");
                            break;
                        }
                        out.push('+');
                        out.push_str(line);
                        out.push('\n');
                    }
                    return Ok(out);
                }
                Err(e) => return Err(format!("Could not read untracked file: {e}")),
            }
        }
        return Ok("(no diff — binary, empty, or unchanged)".into());
    }

    let mut out = String::new();
    if !staged.is_empty() {
        out.push_str("--- staged ---\n");
        out.push_str(&staged);
        out.push('\n');
    }
    if !unstaged.is_empty() {
        out.push_str("--- unstaged ---\n");
        out.push_str(&unstaged);
    }
    // Truncate very large diffs
    if out.len() > 80_000 {
        out.truncate(80_000);
        out.push_str("\n… (diff truncated)");
    }
    Ok(out)
}

#[derive(Debug, Clone)]
pub struct CheckoutOutcome {
    pub message: String,
    pub stashed: bool,
    pub already_on: bool,
}

/// Checkout branch. If `stash_if_dirty`, stash uncommitted changes first.
pub fn checkout_branch(
    path: &str,
    branch: &str,
    stash_if_dirty: bool,
) -> Result<CheckoutOutcome, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    if let Ok(Some(cur)) = current_branch(path) {
        if cur == branch {
            return Ok(CheckoutOutcome {
                message: format!("Already on {branch}"),
                stashed: false,
                already_on: true,
            });
        }
    }

    let dirty = is_dirty(path)?;
    let mut stashed = false;
    if dirty {
        if stash_if_dirty {
            stash_push(path, "git-workspace: auto-stash before checkout")?;
            stashed = true;
        } else {
            return Err("Working tree has uncommitted changes".into());
        }
    }

    // Prefer local branch
    let local = run_git(p, &["show-ref", "--verify", &format!("refs/heads/{branch}")]);
    if local.is_ok() {
        run_git(p, &["checkout", branch])?;
        return Ok(CheckoutOutcome {
            message: if stashed {
                format!("Stashed changes and switched to {branch}")
            } else {
                format!("Switched to {branch}")
            },
            stashed,
            already_on: false,
        });
    }

    // Try remote tracking branch
    let remote = run_git(
        p,
        &[
            "show-ref",
            "--verify",
            &format!("refs/remotes/origin/{branch}"),
        ],
    );
    if remote.is_ok() {
        run_git(p, &["checkout", "-B", branch, &format!("origin/{branch}")])?;
        return Ok(CheckoutOutcome {
            message: if stashed {
                format!("Stashed changes and switched to {branch} (tracking origin)")
            } else {
                format!("Switched to {branch} (tracking origin)")
            },
            stashed,
            already_on: false,
        });
    }

    Err(format!("Branch not found: {branch}"))
}
