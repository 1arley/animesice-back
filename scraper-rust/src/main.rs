use regex::Regex;
use reqwest::blocking::{Client, Response};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::{self, Read};
use std::time::Duration;
use url::Url;

const MAX_RESPONSE_BYTES: usize = 5 * 1024 * 1024;
const MAX_VISITED: usize = 32;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input { episode_url: String, ua: String }

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Output {
    videos: Vec<String>,
    iframes: Vec<String>,
    cloudflare: bool,
    player_tokens: Vec<String>,
}

fn host_allowed(host: &str) -> bool {
    host == "animefire.io" || host.ends_with(".animefire.io")
        || host == "meusanimes.blog"
        || host == "meusdoramas.club" || host.ends_with(".meusdoramas.club")
        || host == "video.meusdoramas.club"
}

fn checked_url(value: &str, base: Option<&Url>) -> Result<Url, String> {
    let parsed = match base { Some(base) => base.join(value), None => Url::parse(value) }
        .map_err(|_| "URL inválida".to_string())?;
    let host = parsed.host_str().unwrap_or_default();
    if !matches!(parsed.scheme(), "http" | "https") || !host_allowed(host) {
        return Err("URL fora dos domínios permitidos".into());
    }
    Ok(parsed)
}

fn bounded_text(response: Response) -> Result<String, String> {
    if response.content_length().is_some_and(|n| n > MAX_RESPONSE_BYTES as u64) {
        return Err("Resposta maior que o limite permitido".into());
    }
    let mut limited = response.take(MAX_RESPONSE_BYTES as u64 + 1);
    let mut bytes = Vec::new();
    limited.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_RESPONSE_BYTES { return Err("Resposta maior que o limite permitido".into()); }
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

fn get(client: &Client, url: Url, ua: &str, referer: Option<&str>) -> Result<String, String> {
    let mut request = client.get(url).header("user-agent", ua)
        .header("accept-language", "pt-BR,pt;q=0.9")
        .header("accept", "text/html,application/json;q=0.9,*/*;q=0.8");
    if let Some(referer) = referer { request = request.header("referer", referer); }
    bounded_text(request.send().map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?)
}

fn extract_animefire(client: &Client, episode: Url, ua: &str) -> Result<Output, String> {
    let html = get(client, episode.clone(), ua, None)?;
    let attr = Regex::new(r#"data-video-src=["']([^"']+)["']"#).unwrap();
    let value = attr.captures(&html).and_then(|m| m.get(1)).ok_or("animefire: data-video-src não encontrado")?.as_str();
    let video = checked_url(value, Some(&episode))?;
    let json = get(client, video, ua, Some("https://animefire.io/"))?;
    let data: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    let mut out = Output::default();
    let mut seen = HashSet::new();
    let mp4 = Regex::new(r"(?i)\.mp4($|[?#])").unwrap();
    let no_video = Regex::new(r"(?i)/no[_-]?video(\.mp4)?($|[?#])").unwrap();
    if let Some(items) = data.get("data").and_then(|v| v.as_array()) {
        for item in items {
            if let Some(src) = item.get("src").and_then(|v| v.as_str()) {
                let src = src.replace("\\/", "/");
                if (src.starts_with("http://") || src.starts_with("https://")) && mp4.is_match(&src) && !no_video.is_match(&src) && seen.insert(src.clone()) { out.videos.push(src); }
            }
        }
    }
    if let Some(index) = out.videos.iter().position(|s| s.to_ascii_lowercase().contains("/hd/")) { let hd = out.videos.remove(index); out.videos.insert(0, hd); }
    Ok(out)
}

fn extract_meusanimes(client: &Client, episode: Url, ua: &str) -> Result<Output, String> {
    let html = get(client, episode, ua, None)?;
    let iframe = Regex::new(r"serv(\d+)\.meusdoramas\.club/#/video/(\d+)/(\d+)/(\d+)").unwrap();
    let mut out = Output::default();
    let mut visited = HashSet::new();
    if let Some(m) = iframe.captures(&html) {
        resolve_server(client, &format!("serv{}.meusdoramas.club", &m[1]), &m[2], &m[3], &m[4], ua, &mut visited, &mut out)?;
    }
    Ok(out)
}

fn resolve_server(client: &Client, host: &str, tmdb: &str, season: &str, episode: &str, ua: &str, visited: &mut HashSet<String>, out: &mut Output) -> Result<(), String> {
    let key = format!("{host}/{tmdb}/{season}/{episode}");
    if visited.len() >= MAX_VISITED || !visited.insert(key) { return Ok(()); }
    let url = Url::parse(&format!("https://{host}/posts/get-video.php?tmdb={tmdb}&season_number={season}&episode_number={episode}")).map_err(|e| e.to_string())?;
    let json = get(client, url, ua, Some(&format!("https://{host}/")))?;
    let video = serde_json::from_str::<serde_json::Value>(&json).ok().and_then(|v| v.get("videoUrl").and_then(|x| x.as_str()).map(str::to_owned));
    let Some(video) = video else { return Ok(()); };
    if video.contains("blogger.com/video.g?token=") || video.contains("youtube.com/") || video.contains("youtube-nocookie.com/") { out.player_tokens.push(video); return Ok(()); }
    if video.contains("video.meusdoramas.club/embed/") {
        let embed = checked_url(&video, None)?;
        let body = get(client, embed, ua, None)?;
        let file = Regex::new(r#""file"\s*:\s*"([^"]+\.(?:mp4|m3u8)(?:\?[^" ]*)?)""#).unwrap();
        for m in file.captures_iter(&body) { out.videos.push(m[1].replace("\\/", "/")); }
    } else if Regex::new(r"(?i)\.(mp4|m3u8)(\?|#|$)").unwrap().is_match(&video) { out.videos.push(video); }
    Ok(())
}

fn extract(input: Input) -> Result<Output, String> {
    let episode = checked_url(&input.episode_url, None)?;
    let client = Client::builder().timeout(Duration::from_secs(15)).redirect(reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 { return attempt.error("limite de redirecionamentos excedido"); }
        if attempt.url().host_str().is_some_and(host_allowed) && matches!(attempt.url().scheme(), "http" | "https") { attempt.follow() } else { attempt.error("redirecionamento fora dos domínios permitidos") }
    })).build().map_err(|e| e.to_string())?;
    let host = episode.host_str().unwrap_or_default();
    if host == "meusanimes.blog" || host.ends_with(".meusdoramas.club") { extract_meusanimes(&client, episode, &input.ua) } else { extract_animefire(&client, episode, &input.ua) }
}

fn main() {
    let mut input = String::new();
    let result = io::stdin().take(64 * 1024).read_to_string(&mut input).map_err(|e| e.to_string()).and_then(|_| serde_json::from_str::<Input>(&input).map_err(|e| e.to_string())).and_then(extract);
    match result { Ok(output) => println!("{}", serde_json::to_string(&output).unwrap()), Err(error) => { eprintln!("{error}"); std::process::exit(1); } }
}
