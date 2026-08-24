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
            is_merging: false,
            is_rebasing: false,
            conflict_files: Vec::new(),
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

    let is_merging = run_git(p, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_ok();
    let is_rebasing = is_rebase_in_progress(p);

    let conflict_files = if is_merging || is_rebasing {
        conflicted_paths(p)
    } else {
        Vec::new()
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
        is_merging,
        is_rebasing,
        conflict_files,
        error: branch_err,
    }
}

fn is_rebase_in_progress(repo: &Path) -> bool {
    // Prefer git-path so worktrees and linked checkouts resolve correctly
    for name in ["rebase-merge", "rebase-apply"] {
        if let Ok(p) = run_git(repo, &["rev-parse", "--git-path", name]) {
            let raw = Path::new(p.trim());
            let full = if raw.is_absolute() {
                raw.to_path_buf()
            } else {
                repo.join(raw)
            };
            if full.exists() {
                return true;
            }
        }
    }
    let git_dir = repo.join(".git");
    git_dir.join("rebase-merge").exists()
        || git_dir.join("rebase-apply").exists()
        || repo.join("rebase-merge").exists()
        || repo.join("rebase-apply").exists()
}

fn conflicted_paths(repo: &Path) -> Vec<String> {
    // Unmerged paths: status codes start with U or have UU/AA/DD etc.
    let porcelain =
        run_git(repo, &["-c", "color.status=false", "status", "--porcelain=v1"])
            .unwrap_or_default();
    let mut out = Vec::new();
    for line in porcelain.lines() {
        let bytes = line.as_bytes();
        if bytes.len() < 4 {
            continue;
        }
        let x = bytes[0] as char;
        let y = bytes[1] as char;
        let unmerged = matches!(
            (x, y),
            ('U', _) | (_, 'U') | ('A', 'A') | ('D', 'D')
        );
        if !unmerged {
            continue;
        }
        let path_start = if bytes[2] == b' ' { 3 } else { 2 };
        if path_start < line.len() {
            let path = line[path_start..].trim().trim_matches('"').to_string();
            if !path.is_empty() {
                out.push(path);
            }
        }
    }
    out
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
    Ok(list_all_branches(path)?
        .into_iter()
        .filter(|b| b.kind == "local")
        .map(|b| b.name)
        .collect())
}

/// Parse `%(upstream:track,nobracket)` values like `ahead 1, behind 2`, `behind 3`, `gone`.
fn parse_upstream_track(track: &str) -> (Option<i64>, Option<i64>, bool) {
    let track = track.trim();
    if track.is_empty() {
        return (Some(0), Some(0), false);
    }
    if track.eq_ignore_ascii_case("gone") {
        return (None, None, true);
    }
    let mut ahead = 0i64;
    let mut behind = 0i64;
    for part in track.split(',') {
        let p = part.trim();
        if let Some(rest) = p.strip_prefix("ahead ") {
            ahead = rest.trim().parse().unwrap_or(0);
        } else if let Some(rest) = p.strip_prefix("behind ") {
            behind = rest.trim().parse().unwrap_or(0);
        }
    }
    (Some(ahead), Some(behind), false)
}

/// Local + remote-tracking branches for UI (dropdowns, branch manager).
/// Local branches include upstream + ahead/behind so the UI can show pulls on other branches.
pub fn list_all_branches(path: &str) -> Result<Vec<crate::models::BranchInfo>, String> {
    use crate::models::BranchInfo;
    let p = Path::new(path);
    let mut out = Vec::new();

    // name\0upstream\0track\0HEAD-marker (*)
    let local = run_git(
        p,
        &[
            "for-each-ref",
            "--format=%(refname:short)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(HEAD)",
            "refs/heads/",
        ],
    )?;
    for line in local.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('\0').collect();
        let name = parts.first().copied().unwrap_or("").trim();
        if name.is_empty() {
            continue;
        }
        let upstream_raw = parts.get(1).copied().unwrap_or("").trim();
        let track = parts.get(2).copied().unwrap_or("").trim();
        let head_mark = parts.get(3).copied().unwrap_or("").trim();
        let is_current = head_mark == "*";

        let (upstream, ahead, behind, upstream_gone) = if upstream_raw.is_empty() {
            (None, None, None, false)
        } else {
            let (a, b, gone) = parse_upstream_track(track);
            (Some(upstream_raw.to_string()), a, b, gone)
        };

        out.push(BranchInfo {
            name: name.to_string(),
            kind: "local".into(),
            short_name: name.to_string(),
            upstream,
            ahead,
            behind,
            is_current,
            upstream_gone,
        });
    }

    let remote = run_git(p, &["branch", "-r", "--format=%(refname:short)"])?;
    for name in remote.lines().map(|l| l.trim()).filter(|l| !l.is_empty()) {
        // Skip symbolic remote HEADs like origin/HEAD
        if name.ends_with("/HEAD") || name.contains("->") {
            continue;
        }
        let short_name = name
            .split_once('/')
            .map(|(_, rest)| rest.to_string())
            .unwrap_or_else(|| name.to_string());
        out.push(BranchInfo {
            name: name.to_string(),
            kind: "remote".into(),
            short_name,
            upstream: None,
            ahead: None,
            behind: None,
            is_current: false,
            upstream_gone: false,
        });
    }

    out.sort_by(|a, b| {
        // Current local first, then other locals, then remotes; name within group
        b.is_current
            .cmp(&a.is_current)
            .then_with(|| a.kind.cmp(&b.kind))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(out)
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

/// Conservative pull used by the multi-repository batch action.
pub fn pull_ff_only(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if is_dirty(path)? {
        return Err("Working tree has uncommitted changes".into());
    }
    run_git_with_stderr(p, &["pull", "--ff-only"])
}

#[derive(Debug, Clone)]
pub struct PullPlan {
    pub branch: String,
    pub upstream: String,
    pub current_head: String,
    pub ahead: i64,
    pub behind: i64,
    pub action: String,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct PullOutcome {
    pub success: bool,
    pub status: String,
    pub message: String,
    pub branch: String,
    pub upstream: String,
    pub ahead: i64,
    pub behind: i64,
    pub before_head: String,
    pub after_head: Option<String>,
    pub conflict_files: Vec<String>,
}

/// Fetch the configured upstream and describe exactly what a pull would do.
pub fn preview_pull(path: &str) -> Result<PullPlan, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("Path does not exist: {path}"));
    }
    if run_git(p, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_ok() {
        return Err("A merge is already in progress. Finish or abort it before pulling.".into());
    }
    if is_rebase_in_progress(p) {
        return Err("A rebase is already in progress. Finish or abort it before pulling.".into());
    }
    if is_dirty(path)? {
        return Err(
            "Working tree has uncommitted changes. Commit, stash, or discard them before pulling."
                .into(),
        );
    }

    let branch = current_branch(path)?
        .ok_or_else(|| "Detached HEAD — check out a branch before pulling".to_string())?;
    let upstream = run_git(
        p,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    )
    .map_err(|_| format!("Branch {branch} has no upstream. Set an upstream before pulling."))?;

    // With no explicit remote, Git follows branch.<name>.remote and the normal
    // fetch configuration for the checked-out branch.
    run_git_with_stderr(p, &["fetch", "--prune"])?;

    let current_head = run_git(p, &["rev-parse", "--short", "HEAD"])?;
    let (ahead, behind) = ahead_behind(p);
    let ahead = ahead.ok_or_else(|| format!("Could not compare {branch} with {upstream}"))?;
    let behind = behind.ok_or_else(|| format!("Could not compare {branch} with {upstream}"))?;

    let (action, message) = if behind == 0 {
        let detail = if ahead == 0 {
            format!("Already up to date with {upstream} at {current_head}.")
        } else {
            format!(
                "{upstream} is already integrated; {branch} is {ahead} local commit(s) ahead."
            )
        };
        ("up_to_date", detail)
    } else if ahead == 0 {
        (
            "fast_forward",
            format!("{branch} will fast-forward by {behind} commit(s) from {upstream}."),
        )
    } else {
        (
            "merge",
            format!(
                "Branches diverged: {ahead} local and {behind} remote commit(s). Pull will create a merge commit if the changes combine cleanly."
            ),
        )
    };

    Ok(PullPlan {
        branch,
        upstream,
        current_head,
        ahead,
        behind,
        action: action.into(),
        message,
    })
}

/// Pull the checked-out branch after fetching. Fast-forward whenever possible;
/// when `allow_merge` is true, merge divergent history using Git's default
/// merge strategy and preserve any conflict state for the GUI resolver.
pub fn pull_with_strategy(path: &str, allow_merge: bool) -> Result<PullOutcome, String> {
    let p = Path::new(path);
    let plan = preview_pull(path)?;
    let base = |success: bool,
                status: &str,
                message: String,
                after_head: Option<String>,
                conflict_files: Vec<String>| PullOutcome {
        success,
        status: status.into(),
        message,
        branch: plan.branch.clone(),
        upstream: plan.upstream.clone(),
        ahead: plan.ahead,
        behind: plan.behind,
        before_head: plan.current_head.clone(),
        after_head,
        conflict_files,
    };

    if plan.action == "up_to_date" {
        return Ok(base(
            true,
            "up_to_date",
            plan.message.clone(),
            Some(plan.current_head.clone()),
            Vec::new(),
        ));
    }
    if plan.action == "merge" && !allow_merge {
        return Ok(base(
            false,
            "needs_merge",
            format!(
                "Fast-forward only cannot update {}: it is {} commit(s) ahead and {} behind {}.",
                plan.branch, plan.ahead, plan.behind, plan.upstream
            ),
            None,
            Vec::new(),
        ));
    }

    let args = if plan.action == "fast_forward" {
        vec!["merge", "--ff-only", plan.upstream.as_str()]
    } else {
        vec!["merge", "--no-edit", plan.upstream.as_str()]
    };

    match run_git_with_stderr(p, &args) {
        Ok(_) => {
            let after_head = run_git(p, &["rev-parse", "--short", "HEAD"])?;
            if plan.action == "fast_forward" {
                Ok(base(
                    true,
                    "fast_forwarded",
                    format!(
                        "Fast-forwarded {} from {} to {} ({} commit(s)).",
                        plan.branch, plan.current_head, after_head, plan.behind
                    ),
                    Some(after_head),
                    Vec::new(),
                ))
            } else {
                Ok(base(
                    true,
                    "merged",
                    format!(
                        "Merged {} into {} as {} ({} local, {} remote commit(s)).",
                        plan.upstream, plan.branch, after_head, plan.ahead, plan.behind
                    ),
                    Some(after_head),
                    Vec::new(),
                ))
            }
        }
        Err(e) => {
            let conflicts = conflicted_paths(p);
            let merging = run_git(p, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_ok();
            if !conflicts.is_empty() {
                Ok(base(
                    false,
                    "conflict",
                    format!(
                        "Fetched {}, but the merge stopped with conflicts in {} file(s). Resolve them and commit, or abort the merge.",
                        plan.upstream,
                        conflicts.len()
                    ),
                    None,
                    conflicts,
                ))
            } else if merging {
                Ok(base(
                    false,
                    "merge_in_progress",
                    format!(
                        "Git combined the changes but could not create the merge commit. Finish the merge by committing, or abort it. Git reported: {}",
                        truncate_msg(&e, 240)
                    ),
                    None,
                    Vec::new(),
                ))
            } else {
                Err(truncate_msg(&e, 500))
            }
        }
    }
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
    let n = limit.clamp(1, 2000).to_string();
    // Include all branches for a SourceTree-like graph; parents for lane layout.
    // Full decorations let the UI reliably distinguish local branches, remotes,
    // tags and HEAD instead of guessing from a shortened ref name.
    let out = run_git(
        p,
        &[
            "log",
            "--all",
            "--topo-order",
            "--decorate=full",
            &format!("-{n}"),
            "--format=%H%x1f%h%x1f%s%x1f%an%x1f%cr%x1f%P%x1f%D%x1f%aI",
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
                if let Some(name) = s.strip_prefix("HEAD -> refs/heads/") {
                    format!("head:{name}")
                } else if s == "HEAD" {
                    "head:detached HEAD".to_string()
                } else if let Some(name) = s.strip_prefix("refs/heads/") {
                    format!("branch:{name}")
                } else if let Some(name) = s.strip_prefix("refs/remotes/") {
                    format!("remote:{}", name.replace(" -> refs/remotes/", " → "))
                } else if let Some(name) = s.strip_prefix("tag: refs/tags/") {
                    format!("tag:{name}")
                } else if let Some(name) = s.strip_prefix("refs/tags/") {
                    format!("tag:{name}")
                } else {
                    format!("other:{s}")
                }
            })
            .collect();
        entries.push(CommitLogEntry {
            hash: parts[0].to_string(),
            short_hash: parts[1].to_string(),
            subject: parts[2].to_string(),
            author: parts[3].to_string(),
            when: parts[4].to_string(),
            authored_at: parts.get(7).unwrap_or(&"").to_string(),
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

/// Merge `source` into the current branch.
/// Returns Ok with status text, or a structured conflict message via Err with prefix CONFLICT:
pub fn merge_branch(
    path: &str,
    source: &str,
    no_ff: bool,
    squash: bool,
) -> Result<crate::models::MergeResult, String> {
    use crate::models::MergeResult;
    let p = Path::new(path);
    let source = source.trim();
    if source.is_empty() {
        return Err("Source branch is required".into());
    }

    // Resolve remote-looking names
    let source_ref = if run_git(
        p,
        &["show-ref", "--verify", &format!("refs/heads/{source}")],
    )
    .is_ok()
    {
        source.to_string()
    } else if run_git(
        p,
        &["show-ref", "--verify", &format!("refs/remotes/{source}")],
    )
    .is_ok()
    {
        source.to_string()
    } else if run_git(
        p,
        &[
            "show-ref",
            "--verify",
            &format!("refs/remotes/origin/{source}"),
        ],
    )
    .is_ok()
    {
        format!("origin/{source}")
    } else {
        return Err(format!("Branch not found: {source}"));
    };

    if run_git(p, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_ok() {
        let conflicts = conflicted_paths(p);
        return Ok(MergeResult {
            repo_id: String::new(),
            success: false,
            status: "conflict".into(),
            message: "A merge is already in progress. Resolve conflicts or abort first."
                .into(),
            conflict_files: conflicts,
        });
    }

    if is_dirty(path)? {
        return Err(
            "Working tree has uncommitted changes. Commit, stash, or discard them before merging."
                .into(),
        );
    }

    if let Ok(Some(cur)) = current_branch(path) {
        // Compare tips
        let cur_tip = run_git(p, &["rev-parse", &cur]).unwrap_or_default();
        let src_tip = run_git(p, &["rev-parse", &source_ref]).unwrap_or_default();
        if !cur_tip.is_empty() && cur_tip == src_tip {
            return Ok(MergeResult {
                repo_id: String::new(),
                success: true,
                status: "already_up_to_date".into(),
                message: format!("Already up to date with {source_ref}"),
                conflict_files: Vec::new(),
            });
        }
    }

    let mut args = vec!["merge".to_string()];
    if squash {
        args.push("--squash".into());
    } else if no_ff {
        args.push("--no-ff".into());
    }
    args.push("--no-edit".into());
    args.push(source_ref.clone());
    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    match run_git_with_stderr(p, &args_ref) {
        Ok(msg) => {
            let lower = msg.to_lowercase();
            let status = if lower.contains("already up to date") {
                "already_up_to_date"
            } else if squash {
                "squash_staged"
            } else {
                "ok"
            };
            Ok(MergeResult {
                repo_id: String::new(),
                success: true,
                status: status.into(),
                message: if msg.trim().is_empty() {
                    format!("Merged {source_ref} successfully")
                } else {
                    truncate_msg(&msg, 400)
                },
                conflict_files: Vec::new(),
            })
        }
        Err(e) => {
            let conflicts = conflicted_paths(p);
            let merging = run_git(p, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_ok();
            if merging || !conflicts.is_empty() {
                Ok(MergeResult {
                    repo_id: String::new(),
                    success: false,
                    status: "conflict".into(),
                    message: format!(
                        "Merge conflicts in {} file(s). Fix them, then commit — or abort the merge.",
                        conflicts.len()
                    ),
                    conflict_files: conflicts,
                })
            } else {
                Err(truncate_msg(&e, 500))
            }
        }
    }
}

pub fn merge_abort(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if run_git(p, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_err() {
        return Err("No merge in progress".into());
    }
    run_git_with_stderr(p, &["merge", "--abort"])
}

/// Rebase current branch onto `onto`.
pub fn rebase_onto(path: &str, onto: &str) -> Result<crate::models::RebaseResult, String> {
    use crate::models::RebaseResult;
    let p = Path::new(path);
    let onto = onto.trim();
    if onto.is_empty() {
        return Err("Base branch is required".into());
    }

    let onto_ref = if run_git(p, &["show-ref", "--verify", &format!("refs/heads/{onto}")]).is_ok()
    {
        onto.to_string()
    } else if run_git(p, &["show-ref", "--verify", &format!("refs/remotes/{onto}")]).is_ok() {
        onto.to_string()
    } else if run_git(
        p,
        &[
            "show-ref",
            "--verify",
            &format!("refs/remotes/origin/{onto}"),
        ],
    )
    .is_ok()
    {
        format!("origin/{onto}")
    } else {
        return Err(format!("Branch not found: {onto}"));
    };

    if is_rebase_in_progress(p) {
        let conflicts = conflicted_paths(p);
        return Ok(RebaseResult {
            repo_id: String::new(),
            success: false,
            status: "conflict".into(),
            message: "A rebase is already in progress. Continue, skip, or abort."
                .into(),
            conflict_files: conflicts,
        });
    }
    if run_git(p, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_ok() {
        return Err("A merge is in progress. Finish or abort it before rebasing.".into());
    }
    if is_dirty(path)? {
        return Err(
            "Working tree has uncommitted changes. Commit, stash, or discard before rebasing."
                .into(),
        );
    }

    match run_git_with_stderr(p, &["rebase", &onto_ref]) {
        Ok(msg) => {
            let lower = msg.to_lowercase();
            let status = if lower.contains("up to date") || lower.contains("is up to date") {
                "already_up_to_date"
            } else {
                "ok"
            };
            Ok(RebaseResult {
                repo_id: String::new(),
                success: true,
                status: status.into(),
                message: if msg.trim().is_empty() {
                    format!("Rebased onto {onto_ref}")
                } else {
                    truncate_msg(&msg, 400)
                },
                conflict_files: Vec::new(),
            })
        }
        Err(e) => {
            let conflicts = conflicted_paths(p);
            if is_rebase_in_progress(p) || !conflicts.is_empty() {
                Ok(RebaseResult {
                    repo_id: String::new(),
                    success: false,
                    status: "conflict".into(),
                    message: format!(
                        "Rebase paused with {} conflict(s). Resolve files, then Continue — or Abort.",
                        conflicts.len()
                    ),
                    conflict_files: conflicts,
                })
            } else {
                Err(truncate_msg(&e, 500))
            }
        }
    }
}

pub fn rebase_continue(path: &str) -> Result<crate::models::RebaseResult, String> {
    use crate::models::RebaseResult;
    let p = Path::new(path);
    if !is_rebase_in_progress(p) {
        return Err("No rebase in progress".into());
    }
    // Ensure no unmerged paths remain
    let conflicts = conflicted_paths(p);
    if !conflicts.is_empty() {
        return Ok(RebaseResult {
            repo_id: String::new(),
            success: false,
            status: "conflict".into(),
            message: format!(
                "Still {} unresolved conflict(s). Use Ours/Theirs or edit + Mark resolved.",
                conflicts.len()
            ),
            conflict_files: conflicts,
        });
    }
    match run_git_with_stderr(p, &["-c", "core.editor=true", "rebase", "--continue"]) {
        Ok(msg) => Ok(RebaseResult {
            repo_id: String::new(),
            success: true,
            status: if is_rebase_in_progress(p) {
                "ok".into()
            } else {
                "ok".into()
            },
            message: if msg.trim().is_empty() {
                "Rebase continued".into()
            } else {
                truncate_msg(&msg, 400)
            },
            conflict_files: conflicted_paths(p),
        }),
        Err(e) => {
            let conflicts = conflicted_paths(p);
            if is_rebase_in_progress(p) || !conflicts.is_empty() {
                Ok(RebaseResult {
                    repo_id: String::new(),
                    success: false,
                    status: "conflict".into(),
                    message: format!(
                        "Rebase still has conflicts ({}). {}",
                        conflicts.len(),
                        truncate_msg(&e, 200)
                    ),
                    conflict_files: conflicts,
                })
            } else {
                Err(truncate_msg(&e, 500))
            }
        }
    }
}

pub fn rebase_abort(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if !is_rebase_in_progress(p) {
        return Err("No rebase in progress".into());
    }
    run_git_with_stderr(p, &["rebase", "--abort"])
}

pub fn rebase_skip(path: &str) -> Result<crate::models::RebaseResult, String> {
    use crate::models::RebaseResult;
    let p = Path::new(path);
    if !is_rebase_in_progress(p) {
        return Err("No rebase in progress".into());
    }
    match run_git_with_stderr(p, &["rebase", "--skip"]) {
        Ok(msg) => Ok(RebaseResult {
            repo_id: String::new(),
            success: true,
            status: "ok".into(),
            message: if msg.trim().is_empty() {
                "Skipped commit; rebase continued".into()
            } else {
                truncate_msg(&msg, 400)
            },
            conflict_files: conflicted_paths(p),
        }),
        Err(e) => {
            let conflicts = conflicted_paths(p);
            Ok(RebaseResult {
                repo_id: String::new(),
                success: false,
                status: if conflicts.is_empty() {
                    "error".into()
                } else {
                    "conflict".into()
                },
                message: truncate_msg(&e, 400),
                conflict_files: conflicts,
            })
        }
    }
}

/// Resolve one conflicted path: ours | theirs | mark_resolved (git add).
/// Labels: during merge, ours=current branch, theirs=incoming.
/// During rebase, git swaps meaning — we still use git's --ours/--theirs.
pub fn resolve_conflict(
    path: &str,
    file_path: &str,
    strategy: &str,
) -> Result<String, String> {
    let p = Path::new(path);
    let file_path = file_path.trim();
    if file_path.is_empty() {
        return Err("File path is required".into());
    }
    let strategy = strategy.trim().to_lowercase();
    match strategy.as_str() {
        "ours" => {
            run_git(p, &["checkout", "--ours", "--", file_path])?;
            run_git(p, &["add", "--", file_path])?;
            Ok(format!("Kept ours for {file_path}"))
        }
        "theirs" => {
            run_git(p, &["checkout", "--theirs", "--", file_path])?;
            run_git(p, &["add", "--", file_path])?;
            Ok(format!("Kept theirs for {file_path}"))
        }
        "mark_resolved" => {
            run_git(p, &["add", "--", file_path])?;
            Ok(format!("Marked resolved: {file_path}"))
        }
        _ => Err(format!("Unknown strategy: {strategy}")),
    }
}

pub fn read_conflict_file(
    path: &str,
    file_path: &str,
) -> Result<crate::models::ConflictFileView, String> {
    use crate::models::ConflictFileView;
    let p = Path::new(path);
    let file_path = file_path.trim();
    let full = p.join(file_path);
    let content = std::fs::read_to_string(&full).map_err(|e| {
        format!("Could not read {file_path}: {e}")
    })?;
    let has_markers = content.contains("<<<<<<<")
        || content.contains("=======")
        || content.contains(">>>>>>>");
    let mut content = content;
    if content.len() > 120_000 {
        content.truncate(120_000);
        content.push_str("\n… (truncated)");
    }
    Ok(ConflictFileView {
        path: file_path.to_string(),
        content,
        has_markers,
    })
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

/// Checkout a local branch name, or a remote-tracking ref like `origin/feature`.
/// Remote refs create/update a local branch tracking that remote.
pub fn checkout_branch(
    path: &str,
    branch: &str,
    stash_if_dirty: bool,
) -> Result<CheckoutOutcome, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    let branch = branch.trim();
    if branch.is_empty() {
        return Err("Branch name is required".into());
    }

    // Resolve remote-tracking ref → local short name
    let (local_name, remote_ref) = if run_git(
        p,
        &["show-ref", "--verify", &format!("refs/remotes/{branch}")],
    )
    .is_ok()
    {
        // branch is like "origin/feature"
        let short = branch
            .split_once('/')
            .map(|(_, rest)| rest.to_string())
            .unwrap_or_else(|| branch.to_string());
        (short, Some(branch.to_string()))
    } else if run_git(
        p,
        &["show-ref", "--verify", &format!("refs/heads/{branch}")],
    )
    .is_ok()
    {
        (branch.to_string(), None)
    } else if run_git(
        p,
        &[
            "show-ref",
            "--verify",
            &format!("refs/remotes/origin/{branch}"),
        ],
    )
    .is_ok()
    {
        (branch.to_string(), Some(format!("origin/{branch}")))
    } else {
        return Err(format!("Branch not found: {branch}"));
    };

    if let Ok(Some(cur)) = current_branch(path) {
        if cur == local_name {
            return Ok(CheckoutOutcome {
                message: format!("Already on {local_name}"),
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

    if let Some(remote) = remote_ref {
        let local_exists =
            run_git(p, &["show-ref", "--verify", &format!("refs/heads/{local_name}")]).is_ok();
        if local_exists {
            // Update local branch tip to remote, then check it out
            run_git(p, &["checkout", "-B", &local_name, &remote])?;
        } else {
            // Create local branch tracking the remote
            run_git(p, &["checkout", "--track", "-b", &local_name, &remote])
                .or_else(|_| run_git(p, &["checkout", "-b", &local_name, &remote]))?;
        }
        return Ok(CheckoutOutcome {
            message: if stashed {
                format!("Stashed changes and checked out {local_name} ← {remote}")
            } else {
                format!("Checked out {local_name} ← {remote}")
            },
            stashed,
            already_on: false,
        });
    }

    run_git(p, &["checkout", &local_name])?;
    Ok(CheckoutOutcome {
        message: if stashed {
            format!("Stashed changes and switched to {local_name}")
        } else {
            format!("Switched to {local_name}")
        },
        stashed,
        already_on: false,
    })
}

#[cfg(test)]
mod pull_tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestRepos {
        root: PathBuf,
        local: PathBuf,
        peer: PathBuf,
    }

    impl Drop for TestRepos {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn git_ok(cwd: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .output()
            .expect("git should start");
        assert!(
            output.status.success(),
            "git {:?} failed:\nstdout: {}\nstderr: {}",
            args,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn configure_user(repo: &Path) {
        git_ok(repo, &["config", "user.name", "GitDweep Test"]);
        git_ok(repo, &["config", "user.email", "gitdweep@example.test"]);
    }

    fn commit_file(repo: &Path, name: &str, content: &str, message: &str) {
        fs::write(repo.join(name), content).expect("write fixture file");
        git_ok(repo, &["add", "--", name]);
        git_ok(repo, &["commit", "-m", message]);
    }

    fn setup_repos() -> TestRepos {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "gitdweep-pull-test-{}-{nonce}",
            std::process::id()
        ));
        let remote = root.join("remote.git");
        let seed = root.join("seed");
        let local = root.join("local");
        let peer = root.join("peer");
        fs::create_dir_all(&root).expect("create fixture root");

        git_ok(&root, &["init", "--bare", "--initial-branch=main", "remote.git"]);
        git_ok(&root, &["init", "--initial-branch=main", "seed"]);
        configure_user(&seed);
        commit_file(&seed, "base.txt", "base\n", "base");
        git_ok(
            &seed,
            &["remote", "add", "origin", remote.to_str().expect("utf-8 path")],
        );
        git_ok(&seed, &["push", "-u", "origin", "main"]);
        git_ok(
            &root,
            &["clone", remote.to_str().expect("utf-8 path"), "local"],
        );
        git_ok(
            &root,
            &["clone", remote.to_str().expect("utf-8 path"), "peer"],
        );
        configure_user(&local);
        configure_user(&peer);

        TestRepos { root, local, peer }
    }

    #[test]
    fn previews_and_executes_fast_forward() {
        let repos = setup_repos();
        commit_file(&repos.peer, "remote.txt", "remote\n", "remote change");
        git_ok(&repos.peer, &["push"]);

        let plan = preview_pull(repos.local.to_str().expect("utf-8 path")).unwrap();
        assert_eq!(plan.action, "fast_forward");
        assert_eq!((plan.ahead, plan.behind), (0, 1));

        let outcome =
            pull_with_strategy(repos.local.to_str().expect("utf-8 path"), true).unwrap();
        assert!(outcome.success);
        assert_eq!(outcome.status, "fast_forwarded");
        assert_ne!(outcome.before_head, outcome.after_head.unwrap());
    }

    #[test]
    fn merges_clean_divergence_and_creates_a_merge_commit() {
        let repos = setup_repos();
        commit_file(&repos.local, "local.txt", "local\n", "local change");
        commit_file(&repos.peer, "remote.txt", "remote\n", "remote change");
        git_ok(&repos.peer, &["push"]);

        let plan = preview_pull(repos.local.to_str().expect("utf-8 path")).unwrap();
        assert_eq!(plan.action, "merge");
        assert_eq!((plan.ahead, plan.behind), (1, 1));

        let outcome =
            pull_with_strategy(repos.local.to_str().expect("utf-8 path"), true).unwrap();
        assert!(outcome.success);
        assert_eq!(outcome.status, "merged");
        let parents = git_ok(&repos.local, &["rev-list", "--parents", "-n", "1", "HEAD"]);
        assert_eq!(parents.split_whitespace().count(), 3);
    }

    #[test]
    fn fast_forward_only_refuses_divergence_without_changing_head() {
        let repos = setup_repos();
        commit_file(&repos.local, "local.txt", "local\n", "local change");
        commit_file(&repos.peer, "remote.txt", "remote\n", "remote change");
        git_ok(&repos.peer, &["push"]);
        let before = git_ok(&repos.local, &["rev-parse", "HEAD"]);

        let outcome =
            pull_with_strategy(repos.local.to_str().expect("utf-8 path"), false).unwrap();
        assert!(!outcome.success);
        assert_eq!(outcome.status, "needs_merge");
        assert_eq!(git_ok(&repos.local, &["rev-parse", "HEAD"]), before);
        assert!(run_git(&repos.local, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_err());
    }

    #[test]
    fn preserves_conflicted_merge_for_resolution() {
        let repos = setup_repos();
        commit_file(&repos.local, "base.txt", "local\n", "local conflict");
        commit_file(&repos.peer, "base.txt", "remote\n", "remote conflict");
        git_ok(&repos.peer, &["push"]);

        let outcome =
            pull_with_strategy(repos.local.to_str().expect("utf-8 path"), true).unwrap();
        assert!(!outcome.success);
        assert_eq!(outcome.status, "conflict");
        assert_eq!(outcome.conflict_files, vec!["base.txt"]);
        assert!(run_git(&repos.local, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_ok());
    }
}
