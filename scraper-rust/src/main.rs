use regex::Regex;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::io::{self, Read};
use std::{collections::HashSet, time::Duration};
use url::Url;

const MAX_RESPONSE_BYTES: usize = 5 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    episode_url: String,
    ua: String,
}

#[derive(Deserialize)]
struct VideoData {
    data: Option<Vec<VideoSource>>,
}

#[derive(Deserialize)]
struct VideoSource {
    src: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    videos: Vec<String>,
    iframes: Vec<String>,
    cloudflare: bool,
}

fn checked_url(value: &str, base: Option<&Url>) -> Result<Url, String> {
    let parsed = match base {
        Some(base) => base.join(value),
        None => Url::parse(value),
    }
    .map_err(|_| "URL inválida".to_string())?;
    let host = parsed.host_str().unwrap_or_default();
    if !matches!(parsed.scheme(), "http" | "https")
        || !(host == "animefire.io" || host.ends_with(".animefire.io"))
        || !matches!(parsed.port_or_known_default(), Some(80 | 443))
    {
        return Err("URL fora do domínio permitido".into());
    }
    Ok(parsed)
}

fn bounded_text(response: reqwest::blocking::Response) -> Result<String, String> {
    if response.content_length().is_some_and(|len| len > MAX_RESPONSE_BYTES as u64) {
        return Err("Resposta maior que o limite permitido".into());
    }
    let mut limited = response.take(MAX_RESPONSE_BYTES as u64 + 1);
    let mut bytes = Vec::new();
    limited
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err("Resposta maior que o limite permitido".into());
    }
    String::from_utf8(bytes.to_vec()).map_err(|e| e.to_string())
}

fn extract(input: Input) -> Result<Output, String> {
    let episode = checked_url(&input.episode_url, None)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.error("limite de redirecionamentos excedido");
            }
            let host = attempt.url().host_str().unwrap_or_default();
            if !(host == "animefire.io" || host.ends_with(".animefire.io"))
                || !matches!(attempt.url().scheme(), "http" | "https")
                || !matches!(attempt.url().port_or_known_default(), Some(80 | 443))
            {
                return attempt.error("redirecionamento fora do domínio permitido");
            }
            attempt.follow()
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let html = bounded_text(
        client
            .get(episode.clone())
            .header("user-agent", &input.ua)
            .header("accept-language", "pt-BR,pt;q=0.9")
            .header("accept", "text/html,application/xhtml+xml")
            .send()
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?,
    )?;
    let attr = Regex::new(r#"data-video-src=["']([^"']+)["']"#).unwrap();
    let video_page_value = attr
        .captures(&html)
        .and_then(|m| m.get(1))
        .ok_or_else(|| "animefire: data-video-src não encontrado no HTML.".to_string())?
        .as_str();
    let video_page = checked_url(video_page_value, Some(&episode))?;
    let json_text = bounded_text(
        client
            .get(video_page)
            .header("user-agent", &input.ua)
            .header("referer", "https://animefire.io/")
            .header("origin", "https://animefire.io")
            .header("accept", "application/json, text/plain, */*")
            .header("accept-language", "pt-BR,pt;q=0.9")
            .send()
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?,
    )?;
    let data: VideoData = serde_json::from_str(&json_text).map_err(|e| e.to_string())?;
    let mut seen = HashSet::new();
    let mp4 = Regex::new(r"\.mp4($|[?#])").map_err(|e| e.to_string())?;
    let no_video = Regex::new(r"(?i)/no[_-]?video(\.mp4)?($|[?#])")
        .map_err(|e| e.to_string())?;
    let mut srcs: Vec<String> = data
        .data
        .unwrap_or_default()
        .into_iter()
        .filter_map(|entry| entry.src)
        .map(|src| src.replace("\\/", "/"))
        .filter(|src| {
            (src.starts_with("http://") || src.starts_with("https://"))
                && mp4.is_match(&src.to_ascii_lowercase())
                && !no_video.is_match(&src)
                && seen.insert(src.clone())
        })
        .collect();
    if let Some(index) = srcs.iter().position(|src| src.to_ascii_lowercase().contains("/hd/")) {
        let hd = srcs.remove(index);
        srcs.insert(0, hd);
    }
    Ok(Output { videos: srcs, iframes: vec![], cloudflare: false })
}

fn main() {
    let mut input = String::new();
    let result = io::stdin()
        .take(64 * 1024)
        .read_to_string(&mut input)
        .map_err(|e| e.to_string())
        .and_then(|_| serde_json::from_str::<Input>(&input).map_err(|e| e.to_string()))
        .and_then(extract);
    match result {
        Ok(output) => println!("{}", serde_json::to_string(&output).unwrap()),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
