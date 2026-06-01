// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Must run before any shared-library code touches GTK/GDK/WebKit.
    // lib.rs::run() has the same block as a fallback, but that can be too late
    // if the dynamic linker triggers GTK's lazy init before run() is entered.
    #[cfg(target_os = "linux")]
    linux_display_env();

    hades_lib::run()
}

#[cfg(target_os = "linux")]
fn linux_display_env() {
    // Force X11 so GTK/WebKit don't try the unstable Wayland backend.
    // Respect an explicit caller override (e.g. GDK_BACKEND=wayland).
    if std::env::var_os("GDK_BACKEND").is_none() {
        std::env::set_var("GDK_BACKEND", "x11");
    }
    // Disable GPU compositing — prevents blank/white window on many compositors.
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
    // Disable DMABUF renderer — prevents crashes with Mesa/Nvidia on XWayland.
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}
