use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Input::KeyboardAndMouse::{RegisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextLengthW};
use windows_result::*;

mod windowing;

/*
    Gets the title bar string for the foreground window.
*/
pub fn get_foreground_window_title() -> std::result::Result<String, String> {
    let w = windowing::get_foreground_window().expect("failed to get foreground window");
    let title = windowing::get_window_title(w)
        .expect("failed to get window title")
        .expect("the window doesn't have a title (or an error occurred");

    Ok(title)
}
