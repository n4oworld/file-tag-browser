// 文件系统类命令：scan_folder、stat_path
// 实现来自原 Electron 主进程 src/main/ipc.ts
use serde::Serialize;
use std::fs;
use std::path::Path;

/// 标准化盘符路径：
/// `D`、`D\`、`D:\` 都规范化为 `D:\`
fn normalize_root(p: &str) -> String {
    let trimmed = p.trim_end_matches('\\').trim_end_matches('/');
    if trimmed.len() == 1 && trimmed.chars().next().map(|c| c.is_ascii_alphabetic()).unwrap_or(false) {
        return format!("{}:\\", trimmed);
    }
    if !trimmed.ends_with('\\') && !trimmed.ends_with('/') {
        return format!("{}\\", trimmed);
    }
    trimmed.replace('/', "\\")
}

#[derive(Serialize)]
pub struct ScanResult {
    pub files: Vec<ScanFile>,
    pub folders: Vec<ScanFolder>,
    pub total: usize,
}

#[derive(Serialize)]
pub struct ScanFile {
    pub path: String,
    pub name: String,
    pub is_directory: u8,
}

#[derive(Serialize)]
pub struct ScanFolder {
    pub name: String,
    pub path: String,
}

/// 仅读取目录条目，不入库任何数据
#[tauri::command]
pub fn scan_folder(path: String) -> Result<ScanResult, String> {
    let normalized = normalize_root(&path);
    scan_folder_inner(&normalized)
}

/// scan_folder 的内部版本，供其他模块复用
pub fn scan_folder_inner(path: &str) -> Result<ScanResult, String> {
    let normalized = normalize_root(path);
    let entries = fs::read_dir(&normalized).map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    let mut folders = Vec::new();
    let mut file_count = 0usize;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let full_path = entry.path().to_string_lossy().to_string();

        if is_dir {
            folders.push(ScanFolder {
                name: name.clone(),
                path: full_path.clone(),
            });
            files.push(ScanFile {
                path: full_path,
                name,
                is_directory: 1,
            });
        } else {
            files.push(ScanFile {
                path: full_path,
                name,
                is_directory: 0,
            });
            file_count += 1;
        }
    }

    Ok(ScanResult {
        files,
        folders,
        total: file_count,
    })
}

#[derive(Serialize)]
pub struct FileStat {
    pub size: u64,
    pub mtime: i64, // 秒
    pub is_directory: bool,
}

/// 获取 path 的 stat 信息
#[tauri::command]
pub fn stat_path(path: String) -> Result<FileStat, String> {
    let normalized = normalize_root(&path);
    stat_path_inner(&normalized)
}

/// stat_path 的内部版本
pub fn stat_path_inner(path: &str) -> Result<FileStat, String> {
    let normalized = normalize_root(path);
    let metadata = fs::metadata(Path::new(&normalized)).map_err(|e| e.to_string())?;
    let mtime = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    Ok(FileStat {
        size: metadata.len(),
        mtime,
        is_directory: metadata.is_dir(),
    })
}