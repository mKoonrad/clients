/*
    The `windowing` module provides a safe abstraction
    over unsafe Win32 API functions for autotype
    usage.
*/

use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;

use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Input::KeyboardAndMouse::{RegisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
};
use windows_result::*;

/*
    Returns a handle to the foreground window.

    https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow
*/
pub fn get_foreground_window() -> std::result::Result<HWND, ()> {
    let foreground_window_handle = unsafe { GetForegroundWindow() };

    if foreground_window_handle.is_invalid() {
        return std::result::Result::Err(());
    }

    Ok(foreground_window_handle)
}

/*
    Returns the window title, if possible.

    https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowtextw
    https://learn.microsoft.com/en-us/windows/win32/api/errhandlingapi/nf-errhandlingapi-getlasterror
*/
pub fn get_window_title(window_handle: HWND) -> std::result::Result<Option<String>, ()> {
    if window_handle.is_invalid() {
        return std::result::Result::Err(());
    }

    let window_title_length = get_window_title_length(window_handle)?;
    if window_title_length == 0 {
        // TODO: Future improvement is to use GetLastError
        return std::result::Result::Ok(None);
    }

    let mut buffer: Vec<u16> = vec![0; window_title_length + 1]; // add extra space for the null character

    let window_title_length = unsafe { GetWindowTextW(window_handle, &mut buffer) };
    if window_title_length == 0 {
        // TODO: Future improvement is to use GetLastError
        return std::result::Result::Ok(None);
    }

    let window_title = OsString::from_wide(&buffer);
    Ok(Some(window_title.to_string_lossy().into_owned()))
}

/*
    Gets the length of the title for a window.

    https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowtextlengthw
    https://learn.microsoft.com/en-us/windows/win32/api/errhandlingapi/nf-errhandlingapi-getlasterror
*/
fn get_window_title_length(window_handle: HWND) -> std::result::Result<usize, ()> {
    if window_handle.is_invalid() {
        return std::result::Result::Err(());
    }

    match unsafe { usize::try_from(GetWindowTextLengthW(window_handle)) } {
        Ok(length) => Ok(length),
        // TODO: Future improvement is to use GetLastError
        Err(_) => std::result::Result::Err(()),
    }
}
