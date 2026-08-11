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
