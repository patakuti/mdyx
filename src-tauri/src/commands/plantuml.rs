use std::fmt::Write as _;

/// PlantUML servers accept a source-encoded URL segment. The `~h<hex>` form
/// (plain hex of the UTF-8 source, no compression) is simpler and just as
/// universally supported by the reference PlantUML server implementation as
/// the classic deflate+base64 scheme, and avoids pulling in a compression
/// dependency for it.
fn encode_hex(source: &str) -> String {
    let mut out = String::with_capacity(source.len() * 2);
    for byte in source.as_bytes() {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

#[tauri::command]
pub async fn render_plantuml(source: String, server_url: String) -> Result<String, String> {
    let base = server_url.trim_end_matches('/');
    let url = format!("{base}/~h{}", encode_hex(&source));

    let response = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("PlantUML server returned HTTP {status}"));
    }
    response.text().await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn renders_against_the_real_official_server() {
        let svg = render_plantuml(
            "@startuml\nAlice -> Bob: hello\n@enduml".to_string(),
            "https://www.plantuml.com/plantuml/svg/".to_string(),
        )
        .await
        .expect("render should succeed");
        assert!(svg.contains("<svg"));
    }

    // Confirms the same `~h<hex>` encoding is understood by a self-hosted
    // server too, not just plantuml.com's own deployment (01_requirements.md
    // 5.5節: server URL must be user-configurable to any server). Requires
    // `docker run -p 18080:8080 plantuml/plantuml-server:jetty` running
    // locally; not part of the default test run.
    #[tokio::test]
    #[ignore]
    async fn renders_against_a_local_server() {
        let svg = render_plantuml(
            "@startuml\nAlice -> Bob: hello\n@enduml".to_string(),
            "http://localhost:18080/svg/".to_string(),
        )
        .await
        .expect("render should succeed");
        assert!(svg.contains("<svg"));
    }
}
