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

#[tauri::command]
async fn chat_groq(
    app: tauri::AppHandle,
    api_key: String,
    model: String,
    messages: Vec<serde_json::Value>,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "model": model,
        "max_tokens": 1024,
        "stream": true,
        "messages": messages,
    });

    let mut response = client
        .post("https://api.groq.com/openai/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.map_err(|e| e.to_string())?;
        return Err(format!("Groq API error ({}): {}", status, text));
    }

    let mut buffer = String::new();

    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim_end().to_string();
            buffer = buffer[pos + 1..].to_string();

            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" {
                    let _ = app.emit("groq-done", ());
                    return Ok(());
                }

                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(content) = parsed["choices"][0]["delta"]["content"].as_str() {
                        if !content.is_empty() {
                            let _ = app.emit("groq-delta", content);
                        }
                    }
                }
            }
        }
    }

    let _ = app.emit("groq-done", ());
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![fetch_ical, chat_groq])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
