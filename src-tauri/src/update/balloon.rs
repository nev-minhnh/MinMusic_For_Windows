//! Tray balloon for `update.available` while the main window is hidden in the tray.
//! `tray::balloon` (M1-4) is private, so this is a small copy with its own notify-icon id; fold it
//! into the tray module when that becomes public.
use crate::tray::Lang;
use windows::Win32::Foundation::HWND;

pub fn text(lang: Lang, version: &str, portable: bool) -> String {
    match (lang, portable) {
        (Lang::Vi, false) => format!("MinMusic {version} đã sẵn sàng. Mở Cài đặt > Cập nhật để cài."),
        (Lang::Vi, true) => format!("Có MinMusic {version}. Mở Cài đặt > Cập nhật để xem trang phát hành."),
        (Lang::En, false) => format!("MinMusic {version} is available. Open Settings > Updates to install it."),
        (Lang::En, true) => format!("MinMusic {version} is available. Open Settings > Updates for the release page."),
    }
}

fn copy_wide(dst: &mut [u16], s: &str) {
    let n = dst.len() - 1;
    for (i, u) in s.encode_utf16().take(n).enumerate() {
        dst[i] = u;
    }
}

const UID: u32 = 0x4D55;

pub fn show(hwnd: HWND, msg: &str) {
    use windows::Win32::UI::Shell::*;
    use windows::Win32::UI::WindowsAndMessaging::*;
    unsafe {
        let r = SendMessageW(hwnd, WM_GETICON, Some(windows::Win32::Foundation::WPARAM(ICON_BIG as usize)), None);
        let hicon = if r.0 != 0 { HICON(r.0 as *mut _) } else { LoadIconW(None, IDI_APPLICATION).unwrap_or_default() };
        let mut nid = NOTIFYICONDATAW {
            cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
            hWnd: hwnd,
            uID: UID,
            uFlags: NIF_ICON | NIF_TIP | NIF_INFO,
            hIcon: hicon,
            dwInfoFlags: NIIF_INFO,
            ..Default::default()
        };
        copy_wide(&mut nid.szTip, "MinMusic");
        copy_wide(&mut nid.szInfoTitle, "MinMusic");
        copy_wide(&mut nid.szInfo, msg);
        if !Shell_NotifyIconW(NIM_ADD, &nid).as_bool() {
            log::warn!("update balloon: Shell_NotifyIcon(NIM_ADD) failed");
            return;
        }
        let addr = hwnd.0 as usize;
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(8));
            let nid = NOTIFYICONDATAW {
                cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
                hWnd: HWND(addr as *mut _),
                uID: UID,
                ..Default::default()
            };
            let _ = Shell_NotifyIconW(NIM_DELETE, &nid);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_mentions_the_version_in_both_languages() {
        for (l, p) in [(Lang::Vi, false), (Lang::Vi, true), (Lang::En, false), (Lang::En, true)] {
            assert!(text(l, "2.0.1", p).contains("2.0.1"));
        }
    }
}
