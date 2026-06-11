// 驱动器枚举命令（Windows 原生实现）
// 不再依赖 PowerShell，改用 Win32 API：GetLogicalDrives + GetDriveTypeW + GetDiskFreeSpaceExW
use serde::Serialize;

// Win32 GetDriveTypeW 返回值常量
// https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getdrivetypew
const DRIVE_FIXED: u32 = 3;
const DRIVE_REMOTE: u32 = 4;

#[derive(Serialize)]
pub struct DriveInfo {
    pub name: String,
    pub label: String,
    pub size: u64,
    pub free: u64,
    #[serde(rename = "type")]
    pub r#type: u32,
}

#[cfg(windows)]
mod platform {
    use super::{DriveInfo, DRIVE_FIXED, DRIVE_REMOTE};
    use windows::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetDriveTypeW};

    pub fn list_drives() -> Result<Vec<DriveInfo>, String> {
        // GetLogicalDrives 返回位掩码，每一位代表一个盘符
        #[link(name = "kernel32")]
        extern "system" {
            fn GetLogicalDrives() -> u32;
        }
        let mask = unsafe { GetLogicalDrives() };
        if mask == 0 {
            return Err("GetLogicalDrives 调用失败".to_string());
        }

        let mut drives = Vec::new();
        for i in 0..26u32 {
            if mask & (1 << i) == 0 {
                continue;
            }
            let letter = (b'A' + i as u8) as char;
            let root = format!("{}:\\", letter);
            let root_w: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();

            let drive_type = unsafe { GetDriveTypeW(windows::core::PCWSTR(root_w.as_ptr())) };

            // 仅保留本地固定盘(3)与网络盘(4)
            if drive_type != DRIVE_FIXED && drive_type != DRIVE_REMOTE {
                continue;
            }

            let mut free_bytes_available: u64 = 0;
            let mut total_bytes: u64 = 0;
            let mut total_free: u64 = 0;
            let ok = unsafe {
                GetDiskFreeSpaceExW(
                    windows::core::PCWSTR(root_w.as_ptr()),
                    Some(&mut free_bytes_available),
                    Some(&mut total_bytes),
                    Some(&mut total_free),
                )
            };

            if ok.is_ok() {
                drives.push(DriveInfo {
                    name: letter.to_string(),
                    label: letter.to_string(),
                    size: total_bytes,
                    free: total_free,
                    r#type: drive_type,
                });
            }
        }

        Ok(drives)
    }
}

#[cfg(not(windows))]
mod platform {
    use super::DriveInfo;
    pub fn list_drives() -> Result<Vec<DriveInfo>, String> {
        Ok(vec![])
    }
}

#[tauri::command]
pub fn get_drives() -> Result<Vec<DriveInfo>, String> {
    platform::list_drives()
}