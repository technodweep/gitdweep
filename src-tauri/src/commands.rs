use crate::db::Db;
use crate::git;
use crate::models::*;
use crate::scan;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

pub struct AppState {
    pub db: Arc<Db>,
}

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> Result<Vec<ProjectSummary>, String> {
    state.db.list_projects()
}

#[tauri::command]
pub fn get_project(state: State<'_, AppState>, id: String) -> Result<ProjectDetail, String> {
    let detail = state.db.get_project(&id)?;
    let _ = state.db.touch_project(&id);
    let _ = state.db.set_setting("last_project_id", &id);
    Ok(detail)
}

#[tauri::command]
pub fn create_project(
    state: State<'_, AppState>,
    request: CreateProjectRequest,
) -> Result<ProjectDetail, String> {
    if request.name.trim().is_empty() {
        return Err("Project name is required".into());
    }
    state.db.create_project(
        request.name.trim(),
        request.root_path.as_deref(),
        &request.repo_paths,
    )
}

#[tauri::command]
pub fn delete_project(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.delete_project(&id)
}

#[tauri::command]
pub fn scan_repos(root_path: String, max_depth: Option<usize>) -> Result<Vec<ScannedRepo>, String> {
    let depth = max_depth.unwrap_or(5);
    scan::scan_repos_efficient(&root_path, depth)
}

#[tauri::command]
pub fn add_repo(
    state: State<'_, AppState>,
    project_id: String,
    path: String,
) -> Result<Repo, String> {
    let p = std::path::Path::new(&path);
    if !p.join(".git").exists() {
        return Err(format!("Not a git repository: {path}"));
    }
    state.db.add_repo(&project_id, &path)
}

#[tauri::command]
pub fn remove_repo(state: State<'_, AppState>, repo_id: String) -> Result<(), String> {
    state.db.remove_repo(&repo_id)
}

#[tauri::command]
pub fn set_repo_enabled(
    state: State<'_, AppState>,
    repo_id: String,
    enabled: bool,
) -> Result<(), String> {
    state.db.set_repo_enabled(&repo_id, enabled)
}

#[tauri::command]
pub fn list_environments(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<Environment>, String> {
    state.db.list_environments(&project_id)
}

#[tauri::command]
pub fn create_environment(
    state: State<'_, AppState>,
    project_id: String,
    name: String,
    is_default: Option<bool>,
) -> Result<Environment, String> {
    if name.trim().is_empty() {
        return Err("Environment name is required".into());
    }
    state
        .db
        .create_environment(&project_id, name.trim(), is_default.unwrap_or(false))
}

#[tauri::command]
pub fn update_environment(
    state: State<'_, AppState>,
    env_id: String,
    name: Option<String>,
    is_default: Option<bool>,
) -> Result<Environment, String> {
    state
        .db
        .update_environment(&env_id, name.as_deref(), is_default)
}

#[tauri::command]
pub fn delete_environment(state: State<'_, AppState>, env_id: String) -> Result<(), String> {
    state.db.delete_environment(&env_id)
}

#[tauri::command]
pub fn get_environment_map(
    state: State<'_, AppState>,
    env_id: String,
) -> Result<Vec<EnvironmentBranch>, String> {
    state.db.get_environment_map(&env_id)
}

#[tauri::command]
pub fn set_environment_branch(
    state: State<'_, AppState>,
    env_id: String,
    repo_id: String,
    branch: String,
) -> Result<(), String> {
    state.db.set_environment_branch(&env_id, &repo_id, &branch)
}

#[tauri::command]
pub fn get_repo_status(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<RepoStatus, String> {
    let repo = state.db.get_repo(&repo_id)?;
    Ok(git::repo_status(&repo.id, &repo.path))
}

#[tauri::command]
pub fn get_project_repo_statuses(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<RepoStatus>, String> {
    let detail = state.db.get_project(&project_id)?;
    Ok(detail
        .repos
        .iter()
        .map(|r| git::repo_status(&r.id, &r.path))
        .collect())
}

#[tauri::command]
pub fn list_branches(state: State<'_, AppState>, repo_id: String) -> Result<Vec<String>, String> {
    let repo = state.db.get_repo(&repo_id)?;
    git::list_branches(&repo.path)
}

/// Prefetch local branches for every repo in a project (one IPC round-trip).
#[tauri::command]
pub fn list_project_branches(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<HashMap<String, Vec<String>>, String> {
    let detail = state.db.get_project(&project_id)?;
    let mut out = HashMap::new();
    for repo in detail.repos {
        match git::list_branches(&repo.path) {
            Ok(branches) => {
                out.insert(repo.id, branches);
            }
            Err(_) => {
                out.insert(repo.id, Vec::new());
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn checkout_branch(
    state: State<'_, AppState>,
    repo_id: String,
    branch: String,
    stash_if_dirty: Option<bool>,
) -> Result<RepoStatus, String> {
    let repo = state.db.get_repo(&repo_id)?;
    git::checkout_branch(&repo.path, &branch, stash_if_dirty.unwrap_or(false))?;
    Ok(git::repo_status(&repo.id, &repo.path))
}

#[tauri::command]
pub fn switch_environment(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    env_id: String,
    options: Option<SwitchOptions>,
) -> Result<Vec<SwitchResult>, String> {
    let opts = options.unwrap_or_default();
    let detail = state.db.get_project(&project_id)?;
    let map = state.db.get_environment_map(&env_id)?;
    let branch_by_repo: HashMap<String, String> = map
        .into_iter()
        .map(|b| (b.repo_id, b.branch))
        .collect();

    let mut results = Vec::new();

    for repo in detail.repos.iter().filter(|r| r.enabled) {
        let target = match branch_by_repo.get(&repo.id) {
            Some(b) if !b.is_empty() => b.clone(),
            _ => {
                let r = SwitchResult {
                    repo_id: repo.id.clone(),
                    repo_name: repo.name.clone(),
                    path: repo.path.clone(),
                    target_branch: String::new(),
                    success: false,
                    message: "No target branch configured for this environment".into(),
                    stashed: false,
                };
                let _ = app.emit(
                    "switch-progress",
                    SwitchProgress {
                        repo_id: repo.id.clone(),
                        repo_name: repo.name.clone(),
                        status: "skipped".into(),
                        message: r.message.clone(),
                    },
                );
                results.push(r);
                continue;
            }
        };

        // Already on target?
        if let Ok(Some(cur)) = git::current_branch(&repo.path) {
            if cur == target {
                let msg = format!("Already on {target}");
                let _ = app.emit(
                    "switch-progress",
                    SwitchProgress {
                        repo_id: repo.id.clone(),
                        repo_name: repo.name.clone(),
                        status: "ok".into(),
                        message: msg.clone(),
                    },
                );
                results.push(SwitchResult {
                    repo_id: repo.id.clone(),
                    repo_name: repo.name.clone(),
                    path: repo.path.clone(),
                    target_branch: target,
                    success: true,
                    message: msg,
                    stashed: false,
                });
                continue;
            }
        }

        if opts.fetch_first {
            let _ = app.emit(
                "switch-progress",
                SwitchProgress {
                    repo_id: repo.id.clone(),
                    repo_name: repo.name.clone(),
                    status: "running".into(),
                    message: "Fetching…".into(),
                },
            );
            if let Err(e) = git::fetch_all(&repo.path) {
                let r = SwitchResult {
                    repo_id: repo.id.clone(),
                    repo_name: repo.name.clone(),
                    path: repo.path.clone(),
                    target_branch: target.clone(),
                    success: false,
                    message: format!("Fetch failed: {e}"),
                    stashed: false,
                };
                let _ = app.emit(
                    "switch-progress",
                    SwitchProgress {
                        repo_id: repo.id.clone(),
                        repo_name: repo.name.clone(),
                        status: "error".into(),
                        message: r.message.clone(),
                    },
                );
                results.push(r);
                continue;
            }
        }

        let _ = app.emit(
            "switch-progress",
            SwitchProgress {
                repo_id: repo.id.clone(),
                repo_name: repo.name.clone(),
                status: "running".into(),
                message: format!("Checking out {target}…"),
            },
        );

        let mut result = match git::checkout_branch(&repo.path, &target, opts.stash_if_dirty) {
            Ok(outcome) => SwitchResult {
                repo_id: repo.id.clone(),
                repo_name: repo.name.clone(),
                path: repo.path.clone(),
                target_branch: target.clone(),
                success: true,
                message: outcome.message,
                stashed: outcome.stashed,
            },
            Err(e) => SwitchResult {
                repo_id: repo.id.clone(),
                repo_name: repo.name.clone(),
                path: repo.path.clone(),
                target_branch: target.clone(),
                success: false,
                message: e,
                stashed: false,
            },
        };

        // Optional: restore stashed work after successful checkout
        if result.success && result.stashed && opts.pop_stash_after {
            let _ = app.emit(
                "switch-progress",
                SwitchProgress {
                    repo_id: repo.id.clone(),
                    repo_name: repo.name.clone(),
                    status: "running".into(),
                    message: "Restoring stash…".into(),
                },
            );
            match git::stash_pop(&repo.path) {
                Ok(msg) => {
                    result.message = format!(
                        "{}; stash pop: {}",
                        result.message,
                        git::truncate_msg(&msg, 80)
                    );
                }
                Err(e) => {
                    // Checkout succeeded; stash remains — report partial warning as success with note
                    result.message = format!(
                        "{}; stash pop failed (stash kept): {}",
                        result.message,
                        git::truncate_msg(&e, 80)
                    );
                }
            }
        }

        let _ = app.emit(
            "switch-progress",
            SwitchProgress {
                repo_id: result.repo_id.clone(),
                repo_name: result.repo_name.clone(),
                status: if result.success {
                    "ok".into()
                } else {
                    "error".into()
                },
                message: result.message.clone(),
            },
        );
        results.push(result);
    }

    Ok(results)
}

fn run_batch_git_op(
    app: &AppHandle,
    state: &State<'_, AppState>,
    project_id: &str,
    event: &str,
    running_msg: &str,
    op: impl Fn(&str) -> Result<String, String>,
) -> Result<Vec<PullResult>, String> {
    let detail = state.db.get_project(project_id)?;
    let mut results = Vec::new();

    for repo in detail.repos.iter().filter(|r| r.enabled) {
        let _ = app.emit(
            event,
            SwitchProgress {
                repo_id: repo.id.clone(),
                repo_name: repo.name.clone(),
                status: "running".into(),
                message: running_msg.into(),
            },
        );

        let result = match op(&repo.path) {
            Ok(msg) => PullResult {
                repo_id: repo.id.clone(),
                repo_name: repo.name.clone(),
                path: repo.path.clone(),
                success: true,
                message: git::truncate_msg(&msg, 160),
            },
            Err(e) => PullResult {
                repo_id: repo.id.clone(),
                repo_name: repo.name.clone(),
                path: repo.path.clone(),
                success: false,
                message: e,
            },
        };

        let _ = app.emit(
            event,
            SwitchProgress {
                repo_id: result.repo_id.clone(),
                repo_name: result.repo_name.clone(),
                status: if result.success {
                    "ok".into()
                } else {
                    "error".into()
                },
                message: result.message.clone(),
            },
        );
        results.push(result);
    }

    Ok(results)
}

/// Pull --ff-only for every enabled repo in the project.
#[tauri::command]
pub fn pull_all(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<PullResult>, String> {
    run_batch_git_op(&app, &state, &project_id, "pull-progress", "Pulling…", git::pull)
}

/// Fetch --all --prune for every enabled repo.
#[tauri::command]
pub fn fetch_all_repos(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<PullResult>, String> {
    run_batch_git_op(
        &app,
        &state,
        &project_id,
        "fetch-progress",
        "Fetching…",
        git::fetch_all,
    )
}

/// Push current branch for every enabled repo (sets upstream if missing).
#[tauri::command]
pub fn push_all(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<PullResult>, String> {
    run_batch_git_op(&app, &state, &project_id, "push-progress", "Pushing…", git::push)
}

/// Dry-run: plan what switch_environment would do (no git mutations).
#[tauri::command]
pub fn preview_switch_environment(
    state: State<'_, AppState>,
    project_id: String,
    env_id: String,
    options: Option<SwitchOptions>,
) -> Result<Vec<SwitchPreviewItem>, String> {
    let opts = options.unwrap_or_default();
    let detail = state.db.get_project(&project_id)?;
    let map = state.db.get_environment_map(&env_id)?;
    let branch_by_repo: HashMap<String, String> = map
        .into_iter()
        .map(|b| (b.repo_id, b.branch))
        .collect();

    let mut items = Vec::new();
    for repo in detail.repos.iter().filter(|r| r.enabled) {
        let current = git::current_branch(&repo.path).ok().flatten();
        let dirty = git::is_dirty(&repo.path).unwrap_or(false);
        let target = branch_by_repo
            .get(&repo.id)
            .cloned()
            .unwrap_or_default();

        let (action, detail_msg) = if target.is_empty() {
            (
                "no_target".into(),
                "No target branch configured".into(),
            )
        } else if current.as_deref() == Some(target.as_str()) {
            (
                "skip".into(),
                format!("Already on {target}"),
            )
        } else if dirty && !opts.stash_if_dirty {
            (
                "will_fail".into(),
                "Dirty working tree (enable stash to proceed)".into(),
            )
        } else if dirty && opts.stash_if_dirty {
            let pop = if opts.pop_stash_after {
                "; then pop stash"
            } else {
                "; leave stash"
            };
            (
                "will_stash".into(),
                format!("Stash, checkout {target}{pop}"),
            )
        } else {
            let fetch = if opts.fetch_first { "Fetch, then " } else { "" };
            (
                "will_switch".into(),
                format!("{fetch}Checkout {target}"),
            )
        };

        items.push(SwitchPreviewItem {
            repo_id: repo.id.clone(),
            repo_name: repo.name.clone(),
            path: repo.path.clone(),
            current_branch: current,
            target_branch: target,
            is_dirty: dirty,
            action,
            detail: detail_msg,
        });
    }
    Ok(items)
}

#[tauri::command]
pub fn pull_repo(state: State<'_, AppState>, repo_id: String) -> Result<PullResult, String> {
    let repo = state.db.get_repo(&repo_id)?;
    match git::pull(&repo.path) {
        Ok(msg) => Ok(PullResult {
            repo_id: repo.id,
            repo_name: repo.name,
            path: repo.path,
            success: true,
            message: git::truncate_msg(&msg, 160),
        }),
        Err(e) => Ok(PullResult {
            repo_id: repo.id,
            repo_name: repo.name,
            path: repo.path,
            success: false,
            message: e,
        }),
    }
}

#[tauri::command]
pub fn push_repo(state: State<'_, AppState>, repo_id: String) -> Result<PullResult, String> {
    let repo = state.db.get_repo(&repo_id)?;
    match git::push(&repo.path) {
        Ok(msg) => Ok(PullResult {
            repo_id: repo.id,
            repo_name: repo.name,
            path: repo.path,
            success: true,
            message: git::truncate_msg(&msg, 160),
        }),
        Err(e) => Ok(PullResult {
            repo_id: repo.id,
            repo_name: repo.name,
            path: repo.path,
            success: false,
            message: e,
        }),
    }
}

#[tauri::command]
pub fn fetch_repo(state: State<'_, AppState>, repo_id: String) -> Result<PullResult, String> {
    let repo = state.db.get_repo(&repo_id)?;
    match git::fetch_all(&repo.path) {
        Ok(msg) => Ok(PullResult {
            repo_id: repo.id,
            repo_name: repo.name,
            path: repo.path,
            success: true,
            message: git::truncate_msg(&msg, 160),
        }),
        Err(e) => Ok(PullResult {
            repo_id: repo.id,
            repo_name: repo.name,
            path: repo.path,
            success: false,
            message: e,
        }),
    }
}

#[tauri::command]
pub fn get_change_summary(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<String, String> {
    let repo = state.db.get_repo(&repo_id)?;
    git::change_summary(&repo.path)
}

#[tauri::command]
pub fn list_changed_files(
    state: State<'_, AppState>,
    repo_id: String,
) -> Result<Vec<ChangedFile>, String> {
    let repo = state.db.get_repo(&repo_id)?;
    git::list_changed_files(&repo.path)
}

#[tauri::command]
pub fn stage_files(
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> Result<Vec<ChangedFile>, String> {
    let repo = state.db.get_repo(&repo_id)?;
    if paths.is_empty() {
        git::stage_all(&repo.path)?;
    } else {
        git::stage_paths(&repo.path, &paths)?;
    }
    git::list_changed_files(&repo.path)
}

#[tauri::command]
pub fn unstage_files(
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> Result<Vec<ChangedFile>, String> {
    let repo = state.db.get_repo(&repo_id)?;
    if paths.is_empty() {
        git::unstage_all(&repo.path)?;
    } else {
        git::unstage_paths(&repo.path, &paths)?;
    }
    git::list_changed_files(&repo.path)
}

/// Discard working-tree + index changes for selected paths (cannot be undone).
#[tauri::command]
pub fn discard_files(
    state: State<'_, AppState>,
    repo_id: String,
    paths: Vec<String>,
) -> Result<Vec<ChangedFile>, String> {
    let repo = state.db.get_repo(&repo_id)?;
    if paths.is_empty() {
        return Err("No files selected to discard".into());
    }
    git::discard_paths(&repo.path, &paths)?;
    git::list_changed_files(&repo.path)
}

#[tauri::command]
pub fn commit_repo(
    state: State<'_, AppState>,
    request: CommitRequest,
) -> Result<CommitResult, String> {
    let repo = state.db.get_repo(&request.repo_id)?;
    let paths = request.paths.as_deref();
    match git::commit_all(&repo.path, &request.message, request.stage_all, paths) {
        Ok(msg) => Ok(CommitResult {
            repo_id: repo.id,
            success: true,
            message: git::truncate_msg(&msg, 200),
        }),
        Err(e) => Ok(CommitResult {
            repo_id: repo.id,
            success: false,
            message: e,
        }),
    }
}

#[tauri::command]
pub fn get_commit_log(
    state: State<'_, AppState>,
    repo_id: String,
    limit: Option<usize>,
) -> Result<Vec<CommitLogEntry>, String> {
    let repo = state.db.get_repo(&repo_id)?;
    git::commit_log(&repo.path, limit.unwrap_or(40))
}

#[tauri::command]
pub fn get_repo_path(state: State<'_, AppState>, repo_id: String) -> Result<String, String> {
    let repo = state.db.get_repo(&repo_id)?;
    Ok(repo.path)
}

#[tauri::command]
pub fn create_branch(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
    checkout: Option<bool>,
) -> Result<RepoStatus, String> {
    let repo = state.db.get_repo(&repo_id)?;
    git::create_branch(&repo.path, &name, checkout.unwrap_or(true))?;
    Ok(git::repo_status(&repo.id, &repo.path))
}

#[tauri::command]
pub fn delete_branch(
    state: State<'_, AppState>,
    repo_id: String,
    name: String,
    force: Option<bool>,
) -> Result<(), String> {
    let repo = state.db.get_repo(&repo_id)?;
    git::delete_branch(&repo.path, &name, force.unwrap_or(false))?;
    Ok(())
}

#[tauri::command]
pub fn checkout_commit(
    state: State<'_, AppState>,
    repo_id: String,
    rev: String,
    new_branch: Option<String>,
) -> Result<RepoStatus, String> {
    let repo = state.db.get_repo(&repo_id)?;
    git::checkout_commit(&repo.path, &rev, new_branch.as_deref())?;
    Ok(git::repo_status(&repo.id, &repo.path))
}

#[tauri::command]
pub fn get_file_diff(
    state: State<'_, AppState>,
    repo_id: String,
    file_path: String,
) -> Result<String, String> {
    let repo = state.db.get_repo(&repo_id)?;
    git::file_diff(&repo.path, &file_path)
}

#[tauri::command]
pub fn get_setting(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    state.db.get_setting(&key)
}

#[tauri::command]
pub fn set_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    state.db.set_setting(&key, &value)
}
