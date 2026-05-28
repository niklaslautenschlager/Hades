use tauri::Emitter;

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
) -> Result<(), String> {
    match vendor.as_str() {
        "groq" => {
            let url = "https://api.groq.com/openai/v1/chat/completions".to_string();
            let mut msgs = vec![serde_json::json!({ "role": "system", "content": system })];
            msgs.extend(messages);
            chat_openai_compatible(&app, &url, Some(&api_key), &model, msgs, "ai-delta", "ai-done").await
        }
        "openai" => {
            let url = "https://api.openai.com/v1/chat/completions".to_string();
            let mut msgs = vec![serde_json::json!({ "role": "system", "content": system })];
            msgs.extend(messages);
            chat_openai_compatible(&app, &url, Some(&api_key), &model, msgs, "ai-delta", "ai-done").await
        }
        "ollama" => {
            let host = base_url.unwrap_or_else(|| "http://localhost:11434".to_string());
            let url = format!("{}/v1/chat/completions", host.trim_end_matches('/'));
            let mut msgs = vec![serde_json::json!({ "role": "system", "content": system })];
            msgs.extend(messages);
            // Ollama doesn't require a key
            chat_openai_compatible(&app, &url, None, &model, msgs, "ai-delta", "ai-done").await
        }
        "anthropic" => {
            chat_anthropic(&app, &api_key, &model, &system, messages, "ai-delta", "ai-done").await
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
    delta_event: &str,
    done_event: &str,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 1024,
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
    delta_event: &str,
    done_event: &str,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 1024,
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
        .invoke_handler(tauri::generate_handler![fetch_ical, chat_groq, chat_completion])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
