// 文件 hash 计算命令
// 实现来自原 Electron 主进程 src/main/ipc.ts 中的 computeFileHash
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Seek, SeekFrom};

const BUFFER_SIZE: usize = 1024 * 1024; // 1MB

/// 计算文件 sha256：头 1MB + 尾 1MB（不足则取实际大小）
#[tauri::command]
pub fn compute_file_hash(file_path: String) -> Result<String, String> {
    compute_file_hash_inner(&file_path)
}

/// 内部版本，供其他模块调用
pub fn compute_file_hash_inner(file_path: &str) -> Result<String, String> {
    let mut file = fs::File::open(file_path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    let size = metadata.len() as usize;

    let mut buffer = vec![0u8; 2 * BUFFER_SIZE];

    // 读头部 1MB
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let head_len = BUFFER_SIZE.min(size);
    file.read_exact(&mut buffer[..head_len])
        .map_err(|e| e.to_string())?;

    // 读尾部 1MB
    if size > BUFFER_SIZE {
        file.seek(SeekFrom::End(-(BUFFER_SIZE as i64)))
            .map_err(|e| e.to_string())?;
        file.read_exact(&mut buffer[BUFFER_SIZE..BUFFER_SIZE + BUFFER_SIZE])
            .map_err(|e| e.to_string())?;
    } else {
        // 文件总长不足 1MB：剩余部分从 0 偏移补读
        file.seek(SeekFrom::Start(0))
            .map_err(|e| e.to_string())?;
        file.read_exact(&mut buffer[BUFFER_SIZE..BUFFER_SIZE + size])
            .map_err(|e| e.to_string())?;
    }

    let mut hasher = Sha256::new();
    hasher.update(&buffer);
    Ok(format!("{:x}", hasher.finalize()))
}