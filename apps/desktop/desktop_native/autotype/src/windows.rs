use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;

use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
    VIRTUAL_KEY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
};

/*
    Gets the title bar string for the foreground window.
*/
pub fn get_foreground_window_title() -> std::result::Result<String, ()> {
    let Ok(window_handle) = get_foreground_window() else {
        return Err(());
    };
    let Ok(Some(window_title)) = get_window_title(window_handle) else {
        return Err(());
    };

    _ = type_input(vec![0x42, 0x49, 0x54]);
    println!("type_input() success");

    Ok(window_title)
}

/*
    Attempts to type the input text wherever the user's cursor is.

    `input` must be between A - Z or one of the following virtual keys:
    VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN

    https://learn.microsoft.com/en-in/windows/win32/api/winuser/nf-winuser-sendinput
    https://learn.microsoft.com/en-us/windows/win32/inputdev/virtual-key-codes
*/
pub fn type_input(input: Vec<u16>) -> Result<(), ()> {
    let mut input_down_keys: Vec<INPUT> = Vec::new();
    let mut input_up_keys: Vec<INPUT> = Vec::new();

    for i in input {
        let next_down_input: INPUT = match i {
            // Inserts a Virtual Key
            // VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN
            0x10..0x12 | 0x5B | 0x5C => INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(i),
                        wScan: 0,
                        dwFlags: Default::default(),
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            // Inserts unicode
            // A - Z
            0x41..=0x5A => INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: Default::default(),
                        wScan: i,
                        dwFlags: KEYEVENTF_UNICODE,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            _ => return Err(()),
        };
        let next_up_input: INPUT = match i {
            // Inserts a Virtual Key
            // VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN
            0x10..0x12 | 0x5B | 0x5C => INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(i),
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            // Inserts unicode
            // A - Z
            0x41..=0x5A => INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: Default::default(),
                        wScan: i,
                        dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            _ => return Err(()),
        };

        input_down_keys.push(next_down_input);
        input_up_keys.push(next_up_input);
    }

    let insert_count = unsafe { SendInput(&input_down_keys, std::mem::size_of::<INPUT>() as i32) };

    println!("type_input insert count: {:?}", insert_count);

    Ok(())
}

/*
    https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow
*/
fn get_foreground_window() -> Result<HWND, ()> {
    let foreground_window_handle = unsafe { GetForegroundWindow() };

    if foreground_window_handle.is_invalid() {
        return Err(());
    }

    Ok(foreground_window_handle)
}

/*
    TODO: Future improvement is to use GetLastError for better error handling

    https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowtextlengthw
*/
fn get_window_title_length(window_handle: HWND) -> Result<usize, ()> {
    if window_handle.is_invalid() {
        return Err(());
    }

    match usize::try_from(unsafe { GetWindowTextLengthW(window_handle) }) {
        Ok(length) => Ok(length),
        Err(_) => Err(()),
    }
}

/*
    TODO: Future improvement is to use GetLastError for better error handling

    https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowtextw
*/
fn get_window_title(window_handle: HWND) -> Result<Option<String>, ()> {
    if window_handle.is_invalid() {
        return Err(());
    }

    let window_title_length = get_window_title_length(window_handle)?;
    if window_title_length == 0 {
        return Ok(None);
    }

    let mut buffer: Vec<u16> = vec![0; window_title_length + 1]; // add extra space for the null character

    let window_title_length = unsafe { GetWindowTextW(window_handle, &mut buffer) };
    if window_title_length == 0 {
        return Ok(None);
    }

    let window_title = OsString::from_wide(&buffer);

    Ok(Some(window_title.to_string_lossy().into_owned()))
}
