use regex::Regex;
use reqwest::blocking::{Client, Response};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::{self, Read};
use std::time::Duration;
use url::Url;

const MAX_RESPONSE_BYTES: usize = 5 * 1024 * 1024;
const MAX_VISITED: usize = 32;
const MAX_CANDIDATES: usize = 4;

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
    host == "meusanimes.blog"
        || host == "meusdoramas.club" || host.ends_with(".meusdoramas.club")
        || host == "video.meusdoramas.club"
        || host == "animesonline.cloud" || host.ends_with(".animesonline.cloud")
        || host == "animesdigital.org" || host.ends_with(".animesdigital.org")
}

fn is_http(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

fn decode_html(value: &str) -> String {
    value.replace("&amp;", "&")
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

fn parse_animesonline(html: &str) -> Output {
    let media_attr = Regex::new(r#"<(?:source|video)[^>]*\bsrc=["']([^"']+)["']"#).unwrap();
    let media_url = Regex::new(r#"(https?://[^\s"'<>\\]+?\.(?:mp4|m3u8)(?:[^\s"'<>\\]*))"#).unwrap();
    let iframe = Regex::new(r#"<iframe[^>]+src=["']([^"']+)["']"#).unwrap();
    let blogger = Regex::new(r"(?i)^https?://(?:www\.)?blogger\.com/video\.g\?token=").unwrap();
    let mut out = Output::default();
    let mut seen = HashSet::new();
    for pattern in [&media_attr, &media_url] {
        for m in pattern.captures_iter(html) {
            let url = decode_html(&m[1]);
            if is_http(&url) && seen.insert(url.clone()) { out.videos.push(url); }
        }
    }
    out.videos.truncate(MAX_CANDIDATES);
    let mut tokens = HashSet::new();
    for m in iframe.captures_iter(html) {
        let url = decode_html(&m[1]);
        if blogger.is_match(&url) && tokens.insert(url.clone()) { out.player_tokens.push(url); }
    }
    out
}

fn extract_animesonline(client: &Client, episode: Url, ua: &str) -> Result<Output, String> {
    let html = get(client, episode, ua, Some("https://animesonline.cloud/"))?;
    // ponytail: sem probe de liveness por candidata (o adapter TS probe antes de devolver).
    // streaming.service probe antes de servir, entao candidata morta cai la. Teto: 4 candidatas
    // sem filtro. Mover o probe para ca se taxa de URL morta incomodar.
    Ok(parse_animesonline(&html))
}

fn parse_animesdigital(html: &str) -> Output {
    let iframe = Regex::new(r#"<iframe[^>]+src=["']([^"']+)["']"#).unwrap();
    let media = Regex::new(r"(?i)\.(?:m3u8|mp4)(?:$|[?#])").unwrap();
    let mut out = Output::default();
    let mut seen = HashSet::new();
    for m in iframe.captures_iter(html) {
        let Ok(src) = Url::parse(&decode_html(&m[1])) else { continue };
        let Some(hls) = src.query_pairs().find(|(key, _)| key == "d").map(|(_, value)| value.into_owned()) else { continue };
        if media.is_match(&hls) && seen.insert(hls.clone()) { out.videos.push(hls); }
    }
    out
}

fn extract_animesdigital(client: &Client, episode: Url, ua: &str) -> Result<Output, String> {
    let html = get(client, episode, ua, None)?;
    Ok(parse_animesdigital(&html))
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
    let host = episode.host_str().unwrap_or_default().to_string();
    if host == "meusanimes.blog" || host.ends_with(".meusdoramas.club") { extract_meusanimes(&client, episode, &input.ua) }
    else if host == "animesonline.cloud" || host.ends_with(".animesonline.cloud") { extract_animesonline(&client, episode, &input.ua) }
    else if host == "animesdigital.org" || host.ends_with(".animesdigital.org") { extract_animesdigital(&client, episode, &input.ua) }
    else { Err(format!("fonte sem extractor Rust: {host}")) }
}

fn main() {
    let mut input = String::new();
    let result = io::stdin().take(64 * 1024).read_to_string(&mut input).map_err(|e| e.to_string()).and_then(|_| serde_json::from_str::<Input>(&input).map_err(|e| e.to_string())).and_then(extract);
    match result { Ok(output) => println!("{}", serde_json::to_string(&output).unwrap()), Err(error) => { eprintln!("{error}"); std::process::exit(1); } }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn animesonline_ordena_source_antes_inline_e_isola_token_blogger() {
        let html = r#"<video><source src="https://animeflix.blog/Animes/x/23.mp4"></video>
            <a href="https://cdn.test/stream.m3u8">player</a>
            <iframe src="https://www.blogger.com/video.g?token=abc123"></iframe>
            <iframe src="https://ads.test/frame.html"></iframe>"#;
        let out = parse_animesonline(html);
        assert_eq!(out.videos[0], "https://animeflix.blog/Animes/x/23.mp4");
        assert_eq!(out.videos[1], "https://cdn.test/stream.m3u8");
        assert_eq!(out.player_tokens, vec!["https://www.blogger.com/video.g?token=abc123"]);
    }

    #[test]
    fn animesdigital_extrai_param_d_do_iframe() {
        let html = r#"<iframe src="https://player.test/e?d=https://cdn.test/hls/master.m3u8&amp;t=1"></iframe>
            <iframe src="https://player.test/e?d=https://cdn.test/img.jpg"></iframe>
            <iframe src="/e?d=https://cdn.test/hls/2.m3u8"></iframe>"#;
        assert_eq!(parse_animesdigital(html).videos, vec!["https://cdn.test/hls/master.m3u8"]);
    }

    #[test]
    fn host_allowed_cobre_as_fontes_ativas_e_recusa_animefire() {
        assert!(host_allowed("animesonline.cloud"));
        assert!(host_allowed("animesdigital.org"));
        assert!(host_allowed("serv1.meusdoramas.club"));
        assert!(!host_allowed("animefire.io"));
    }
}
