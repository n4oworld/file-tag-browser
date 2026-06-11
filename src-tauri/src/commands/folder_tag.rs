// 文件夹 UUID.tag 文件相关命令
// 实现来自原 Electron 主进程 src/main/ipc.ts 中的 readFolderUUID / createFolderUUIDFile
use std::fs;
use std::path::Path;
use uuid::Uuid;

/// 在 folderPath 下创建 <uuid>.tag 文件，内容为 uuid 字符串
/// 返回新生成的 uuid
#[tauri::command]
pub fn create_folder_tag_file(folder_path: String) -> Result<String, String> {
    create_folder_tag_file_inner(&folder_path)
}

/// 内部版本，供其他模块调用
pub fn create_folder_tag_file_inner(folder_path: &str) -> Result<String, String> {
    let uuid = Uuid::new_v4().to_string();
    let path = Path::new(folder_path).join(format!("{}.tag", uuid));
    fs::write(&path, &uuid).map_err(|e| e.to_string())?;
    Ok(uuid)
}

/// 读取 folderPath 下的 .tag 文件，返回 uuid 字符串；若不存在或为空则返回 None
#[tauri::command]
pub fn read_folder_tag(folder_path: String) -> Result<Option<String>, String> {
    read_folder_tag_inner(&folder_path)
}

/// 内部版本
pub fn read_folder_tag_inner(folder_path: &str) -> Result<Option<String>, String> {
    let dir = match fs::read_dir(folder_path) {
        Ok(d) => d,
        Err(_) => return Ok(None),
    };
    for entry in dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".tag") && entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            let content = fs::read_to_string(entry.path()).map_err(|e| e.to_string())?;
            let trimmed = content.trim().to_string();
            if !trimmed.is_empty() {
                return Ok(Some(trimmed));
            }
        }
    }
    Ok(None)
}