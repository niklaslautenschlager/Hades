use tauri::Emitter;
use tauri::Manager;

#[tauri::command]
async fn fetch_ical(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("HadesApp/0.1")
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    response.text().await.map_err(|e| e.to_string())
}

// Fetch a remote PDF natively in Rust (mirrors fetch_ical). Doing this here
// instead of via tauri-plugin-http avoids the webview's CORS policy and the
// http capability scope, and lets us follow redirects and validate the payload.
#[tauri::command]
async fn fetch_pdf(url: String) -> Result<tauri::ipc::Response, String> {
    let client = reqwest::Client::builder()
        .user_agent("HadesApp/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .header("Accept", "application/pdf,*/*")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    // Guard against HTML error pages / wrong content-type returned with a 200.
    if !bytes.starts_with(b"%PDF") {
        return Err("That URL did not return a PDF file.".to_string());
    }

    Ok(tauri::ipc::Response::new(bytes.to_vec()))
}

// ─── Legacy Groq command (kept for backward compatibility) ─────────────────
#[tauri::command]
async fn chat_groq(
    app: tauri::AppHandle,
    api_key: String,
    model: String,
    messages: Vec<serde_json::Value>,
) -> Result<(), String> {
    chat_openai_compatible(
        &app,
        "https://api.groq.com/openai/v1/chat/completions",
        Some(&api_key),
        &model,
        messages,
        1024,
        "groq-delta",
        "groq-done",
    )
    .await
}

// ─── Unified chat_completion command ──────────────────────────────────────
#[tauri::command]
async fn chat_completion(
    app: tauri::AppHandle,
    vendor: String,
    api_key: String,
    model: String,
    base_url: Option<String>,
    system: String,
    messages: Vec<serde_json::Value>,
    max_tokens: Option<u32>,
) -> Result<(), String> {
    let max_tokens = max_tokens.unwrap_or(1024);
    match vendor.as_str() {
        "groq" => {
            let url = "https://api.groq.com/openai/v1/chat/completions".to_string();
            let mut msgs = vec![serde_json::json!({ "role": "system", "content": system })];
            msgs.extend(messages);
            chat_openai_compatible(&app, &url, Some(&api_key), &model, msgs, max_tokens, "ai-delta", "ai-done").await
        }
        "openai" => {
            let url = "https://api.openai.com/v1/chat/completions".to_string();
            let mut msgs = vec![serde_json::json!({ "role": "system", "content": system })];
            msgs.extend(messages);
            chat_openai_compatible(&app, &url, Some(&api_key), &model, msgs, max_tokens, "ai-delta", "ai-done").await
        }
        "deepseek" => {
            let url = "https://api.deepseek.com/v1/chat/completions".to_string();
            let mut msgs = vec![serde_json::json!({ "role": "system", "content": system })];
            msgs.extend(messages);
            chat_openai_compatible(&app, &url, Some(&api_key), &model, msgs, max_tokens, "ai-delta", "ai-done").await
        }
        "ollama" => {
            let host = base_url.unwrap_or_else(|| "http://localhost:11434".to_string());
            let url = format!("{}/v1/chat/completions", host.trim_end_matches('/'));
            let mut msgs = vec![serde_json::json!({ "role": "system", "content": system })];
            msgs.extend(messages);
            // Ollama doesn't require a key
            chat_openai_compatible(&app, &url, None, &model, msgs, max_tokens, "ai-delta", "ai-done").await
        }
        "anthropic" => {
            chat_anthropic(&app, &api_key, &model, &system, messages, max_tokens, "ai-delta", "ai-done").await
        }
        other => Err(format!("Unknown AI vendor: {}", other)),
    }
}

async fn chat_openai_compatible(
    app: &tauri::AppHandle,
    url: &str,
    api_key: Option<&str>,
    model: &str,
    messages: Vec<serde_json::Value>,
    max_tokens: u32,
    delta_event: &str,
    done_event: &str,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "stream": true,
        "messages": messages,
    });

    let mut req = client
        .post(url)
        .header("Content-Type", "application/json")
        .json(&body);

    if let Some(key) = api_key {
        req = req.header("Authorization", format!("Bearer {}", key));
    }

    let mut response = req
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.map_err(|e| e.to_string())?;
        return Err(format!("API error ({}): {}", status, text));
    }

    let mut buffer = String::new();

    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim_end().to_string();
            buffer = buffer[pos + 1..].to_string();

            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" {
                    let _ = app.emit(done_event, ());
                    return Ok(());
                }

                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(content) = parsed["choices"][0]["delta"]["content"].as_str() {
                        if !content.is_empty() {
                            let _ = app.emit(delta_event, content);
                        }
                    }
                }
            }
        }
    }

    let _ = app.emit(done_event, ());
    Ok(())
}

async fn chat_anthropic(
    app: &tauri::AppHandle,
    api_key: &str,
    model: &str,
    system: &str,
    messages: Vec<serde_json::Value>,
    max_tokens: u32,
    delta_event: &str,
    done_event: &str,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "stream": true,
        "system": system,
        "messages": messages,
    });

    let mut response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("Content-Type", "application/json")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.map_err(|e| e.to_string())?;
        return Err(format!("Anthropic API error ({}): {}", status, text));
    }

    let mut buffer = String::new();

    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim_end().to_string();
            buffer = buffer[pos + 1..].to_string();

            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                    let kind = parsed["type"].as_str().unwrap_or("");
                    if kind == "content_block_delta" {
                        if let Some(text) = parsed["delta"]["text"].as_str() {
                            if !text.is_empty() {
                                let _ = app.emit(delta_event, text);
                            }
                        }
                    } else if kind == "message_stop" {
                        let _ = app.emit(done_event, ());
                        return Ok(());
                    }
                }
            }
        }
    }

    let _ = app.emit(done_event, ());
    Ok(())
}

// ─── Updater commands ─────────────────────────────────────────────────────────

#[tauri::command]
async fn install_update(download_url: String) -> Result<(), String> {
    use std::io::Write;

    // Only allow downloads from GitHub to prevent open redirects
    if !download_url.starts_with("https://github.com/")
        && !download_url.starts_with("https://objects.githubusercontent.com/")
    {
        return Err("Download URL must originate from github.com".to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent("HadesApp/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server returned {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read download: {}", e))?;

    #[cfg(target_os = "linux")]
    {
        // When running as an AppImage, current_exe() resolves into the read-only
        // squashfs mount (/tmp/.mount_*/…). The APPIMAGE env var is the real path.
        let target = if let Ok(path) = std::env::var("APPIMAGE") {
            std::path::PathBuf::from(path)
        } else {
            std::env::current_exe()
                .map_err(|e| format!("Cannot locate current executable: {}", e))?
        };

        let tmp = target.with_extension("new");

        {
            let mut f = std::fs::File::create(&tmp)
                .map_err(|e| format!("Cannot create temp file: {}", e))?;
            f.write_all(&bytes)
                .map_err(|e| format!("Cannot write temp file: {}", e))?;
        }

        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&tmp)
                .map_err(|e| e.to_string())?
                .permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&tmp, perms)
                .map_err(|e| format!("Cannot set executable bit: {}", e))?;
        }

        // Atomic replace — running process keeps its inode, dir entry is updated
        std::fs::rename(&tmp, &target)
            .map_err(|e| format!("Cannot replace binary: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        let tmp = std::env::temp_dir().join("hades-update.dmg");
        {
            let mut f = std::fs::File::create(&tmp)
                .map_err(|e| format!("Cannot create temp file: {}", e))?;
            f.write_all(&bytes)
                .map_err(|e| format!("Cannot write installer: {}", e))?;
        }
        std::process::Command::new("open")
            .arg(&tmp)
            .spawn()
            .map_err(|e| format!("Cannot open installer: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        let tmp = std::env::temp_dir().join("hades-update-setup.exe");
        {
            let mut f = std::fs::File::create(&tmp)
                .map_err(|e| format!("Cannot create temp file: {}", e))?;
            f.write_all(&bytes)
                .map_err(|e| format!("Cannot write installer: {}", e))?;
        }
        std::process::Command::new(&tmp)
            .spawn()
            .map_err(|e| format!("Cannot launch installer: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

// ─── App-data file I/O ──────────────────────────────────────────────────────
// Done in Rust (not tauri-plugin-fs) because the JS fs scope can't reliably
// write into the app-data dir. Used by the PDF library and the RAG index.

fn resolve_app_data(app: &tauri::AppHandle, rel_path: &str) -> Result<std::path::PathBuf, String> {
    use std::path::Component;
    // Reject anything that could escape the app-data dir.
    let rel = std::path::Path::new(rel_path);
    for comp in rel.components() {
        match comp {
            Component::Normal(_) => {}
            _ => return Err("Invalid path".to_string()),
        }
    }
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No app data dir: {}", e))?;
    Ok(base.join(rel))
}

#[tauri::command]
async fn app_data_write(app: tauri::AppHandle, rel_path: String, contents: Vec<u8>) -> Result<(), String> {
    let target = resolve_app_data(&app, &rel_path)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {}", e))?;
    }
    std::fs::write(&target, &contents).map_err(|e| format!("write failed: {}", e))
}

#[tauri::command]
async fn app_data_read(app: tauri::AppHandle, rel_path: String) -> Result<tauri::ipc::Response, String> {
    let target = resolve_app_data(&app, &rel_path)?;
    let bytes = std::fs::read(&target).map_err(|e| format!("read failed: {}", e))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
async fn app_data_remove(app: tauri::AppHandle, rel_path: String) -> Result<(), String> {
    let target = resolve_app_data(&app, &rel_path)?;
    match std::fs::remove_file(&target) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove failed: {}", e)),
    }
}

// ─── Embeddings (local Ollama) ──────────────────────────────────────────────
// Batch-embeds text via Ollama's /api/embed. Local-first; no key required.

#[tauri::command]
async fn embed_texts(base_url: String, model: String, texts: Vec<String>) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(vec![]);
    }
    let host = base_url.trim_end_matches('/');
    let url = format!("{}/api/embed", host);
    let client = reqwest::Client::new();

    let resp = client
        .post(&url)
        .json(&serde_json::json!({ "model": model, "input": texts }))
        .send()
        .await
        .map_err(|e| format!("Embedding request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Embedding error ({}): {}", status, body));
    }

    let parsed: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let arr = parsed["embeddings"]
        .as_array()
        .ok_or_else(|| "Malformed embedding response".to_string())?;

    let mut out = Vec::with_capacity(arr.len());
    for row in arr {
        let vec: Vec<f32> = row
            .as_array()
            .ok_or_else(|| "Malformed embedding row".to_string())?
            .iter()
            .map(|v| v.as_f64().unwrap_or(0.0) as f32)
            .collect();
        out.push(vec);
    }
    Ok(out)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Force X11 backend before GTK initialises to avoid Wayland protocol errors
    // on compositors that don't fully implement the protocol. Only set if the
    // caller hasn't already overridden these.
    #[cfg(target_os = "linux")]
    {
        if std::env::var("GDK_BACKEND").is_err() {
            std::env::set_var("GDK_BACKEND", "x11");
        }
        if std::env::var("WEBKIT_DISABLE_COMPOSITING_MODE").is_err() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            fetch_ical,
            fetch_pdf,
            chat_groq,
            chat_completion,
            install_update,
            restart_app,
            app_data_write,
            app_data_read,
            app_data_remove,
            embed_texts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
