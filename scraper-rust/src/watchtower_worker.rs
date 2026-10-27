use reqwest::{redirect::Policy, Client as HttpClient, StatusCode};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    env,
    net::{IpAddr, SocketAddr},
    process::Stdio,
    str::FromStr,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::AsyncWriteExt,
    process::Command,
    time::{interval, sleep, timeout},
};
use tokio_postgres::{Client, NoTls};
use tokio_postgres_rustls::MakeRustlsConnect;
use url::Url;

const HEARTBEAT_FILE: &str = "/tmp/watchtower-worker.heartbeat";
const WORKER_LOCK_NAMESPACE: i32 = 991233;
const WORKER_LOCK_ID: i32 = 1;
const LEASE_VALID_FOR_SECONDS: i64 = 90;
const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const RUST_PAGE_HOSTS: &[&str] = &[
    "meusanimes.blog",
    "meusdoramas.club",
    "animesonline.cloud",
    "animesonlinecc.to",
    "animesdigital.org",
];

#[derive(Debug)]
struct Job {
    id: String,
    locked_by: String,
    payload: Value,
    attempts: i32,
    max_attempts: i32,
}

#[derive(Debug, Clone)]
struct Candidate {
    source_id: String,
    page_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScrapeResult {
    videos: Vec<String>,
    #[serde(default)]
    player_tokens: Vec<String>,
}

enum ScrapeOutcome {
    Videos(Vec<String>),
    BrowserRequired,
}

#[derive(Debug)]
struct Episode {
    id: String,
    audio: String,
    video_url: Option<String>,
    video_broken: bool,
}

fn log_event(event: &str, fields: Value) {
    println!("{}", json!({"event": event, "fields": fields}));
}

fn env_bool(name: &str) -> bool {
    env::var(name)
        .map(|value| value.eq_ignore_ascii_case("true") || value == "1")
        .unwrap_or(false)
}

fn db_uses_tls(database_url: &str) -> bool {
    let Ok(url) = Url::parse(database_url) else {
        return true;
    };
    if let Some(mode) = url
        .query_pairs()
        .find(|(key, _)| key.eq_ignore_ascii_case("sslmode"))
        .map(|(_, value)| value.to_ascii_lowercase())
    {
        return mode != "disable";
    }
    !matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "::1" | "db" | "postgres")
    )
}

async fn connect_unlocked(
    database_url: &str,
) -> Result<Client, Box<dyn std::error::Error + Send + Sync>> {
    let mut connection_url = Url::parse(database_url)?;
    connection_url.set_query(None);
    connection_url.set_fragment(None);
    let config = tokio_postgres::Config::from_str(connection_url.as_str())?;
    let client = if db_uses_tls(database_url) {
        let mut roots = rustls::RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let tls = rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        let (client, connection) = config.connect(MakeRustlsConnect::new(tls)).await?;
        tokio::spawn(async move {
            if connection.await.is_err() {
                eprintln!("{{\"event\":\"postgres_connection_closed\"}}");
            }
        });
        client
    } else {
        let (client, connection) = config.connect(NoTls).await?;
        tokio::spawn(async move {
            if connection.await.is_err() {
                eprintln!("{{\"event\":\"postgres_connection_closed\"}}");
            }
        });
        client
    };
    Ok(client)
}

async fn connect(database_url: &str) -> Result<Client, Box<dyn std::error::Error + Send + Sync>> {
    let client = connect_unlocked(database_url).await?;
    let lock_acquired: bool = client
        .query_one(
            "SELECT pg_try_advisory_lock($1, $2)",
            &[&WORKER_LOCK_NAMESPACE, &WORKER_LOCK_ID],
        )
        .await?
        .get(0);
    if !lock_acquired {
        return Err("outro worker Rust mantém o lock exclusivo".into());
    }
    Ok(client)
}

fn worker_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("rust:{}:{nanos}", std::process::id())
}

async fn claim(client: &Client) -> Result<Option<Job>, tokio_postgres::Error> {
    let locked_by = worker_id();
    let row = client
        .query_opt(
            r#"
            UPDATE "WatchtowerJob" AS job
            SET "status" = 'RUNNING', "lockedBy" = $1,
                "lockedAt" = NOW(), "updatedAt" = NOW()
            WHERE job."id" = (
                SELECT candidate."id"
                FROM "WatchtowerJob" AS candidate
                WHERE candidate."status" = 'PENDING'
                  AND candidate."nextRunAt" <= NOW()
                  AND candidate."type" = 'REPAIR_EPISODE'
                  AND candidate."payload"->>'rustEligible' = 'true'
                ORDER BY candidate."priority" ASC, candidate."nextRunAt" ASC,
                         candidate."createdAt" ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING job."id", job."payload", job."attempts", job."maxAttempts"
            "#,
            &[&locked_by],
        )
        .await?;

    Ok(row.map(|row| Job {
        id: row.get("id"),
        locked_by,
        payload: row.get("payload"),
        attempts: row.get("attempts"),
        max_attempts: row.get("maxAttempts"),
    }))
}

async fn heartbeat(database_url: String, job_id: String, locked_by: String) {
    let Ok(client) = connect_unlocked(&database_url).await else {
        return;
    };
    let mut timer = interval(Duration::from_secs(20));
    loop {
        timer.tick().await;
        match client
            .execute(
                r#"UPDATE "WatchtowerJob" SET "lockedAt" = NOW(), "updatedAt" = NOW()
                   WHERE "id" = $1 AND "lockedBy" = $2 AND "status" = 'RUNNING'"#,
                &[&job_id, &locked_by],
            )
            .await
        {
            Ok(1) => {}
            _ => {
                return;
            }
        }
    }
}

fn rust_source_host(url: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    parsed.scheme() == "https"
        && parsed.host_str().is_some_and(|host| {
            RUST_PAGE_HOSTS
                .iter()
                .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
        })
}

fn source_matches_host(source_id: &str, url: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    match (source_id, parsed.host_str().unwrap_or_default()) {
        ("meusanimes", "meusanimes.blog") => true,
        ("meusanimes", host) if host.ends_with(".meusdoramas.club") => true,
        ("animesonline", "animesonline.cloud") => true,
        ("animesonline", "animesonlinecc.to") => true,
        ("animesdigital", "animesdigital.org") => true,
        _ => false,
    }
}

fn episode_path_matches(url: &str, episode_number: i32) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    let path = parsed.path().trim_end_matches('/');
    let suffix = format!("-episodio-{episode_number}");
    path.to_ascii_lowercase().ends_with(&suffix)
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let octets = ip.octets();
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_unspecified()
                || ip.is_multicast()
                || octets[0] == 0
                || (octets[0] == 100 && (64..=127).contains(&octets[1]))
                || (octets[0] == 192 && octets[1] == 0)
                || (octets[0] == 192 && octets[1] == 0 && octets[2] == 2)
                || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
                || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
                || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113)
                || octets[0] >= 240)
        }
        IpAddr::V6(ip) => {
            if let Some(mapped) = ip.to_ipv4_mapped() {
                return is_public_ip(IpAddr::V4(mapped));
            }
            let first = ip.segments()[0];
            (first & 0xe000) == 0x2000
                && !ip.is_loopback()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_unique_local()
                && !ip.is_unicast_link_local()
        }
    }
}

fn media_host_allowed(url: &str) -> bool {
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https" {
        return false;
    }
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let allowed = env::var("EMBED_ALLOWED_HOSTS").unwrap_or_default();
    allowed
        .split([',', ' ', '\n', '\t'])
        .filter(|entry| !entry.is_empty())
        .any(|entry| {
            if let Some(suffix) = entry.strip_prefix("*.") {
                host == suffix || host.ends_with(&format!(".{suffix}"))
            } else {
                host.eq_ignore_ascii_case(entry)
            }
        })
}

async fn media_is_live(url: &str) -> Option<bool> {
    if !media_host_allowed(url) {
        return None;
    }
    let parsed = Url::parse(url).ok()?;
    let host = parsed.host_str()?;
    let port = parsed.port_or_known_default()?;
    let resolved = tokio::net::lookup_host((host, port)).await.ok()?;
    let addresses: Vec<SocketAddr> = resolved.collect();
    if addresses.is_empty() || addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return None;
    }
    let address = *addresses.first()?;
    let http = HttpClient::builder()
        .timeout(Duration::from_secs(8))
        .redirect(Policy::none())
        .resolve(host, address)
        .build()
        .ok()?;
    let response = match http.get(url).header("Range", "bytes=0-0").send().await {
        Ok(response) => response,
        Err(_) => return None,
    };
    let status = response.status();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let media_type = content_type.starts_with("video/")
        || content_type.contains("mpegurl")
        || (content_type.contains("octet-stream")
            && (parsed.path().ends_with(".mp4") || parsed.path().ends_with(".m3u8")));
    match status {
        StatusCode::PARTIAL_CONTENT if media_type => Some(true),
        StatusCode::OK if media_type => Some(true),
        StatusCode::NOT_FOUND | StatusCode::GONE => Some(false),
        _ => None,
    }
}

async fn fetch_episode(
    client: &Client,
    job: &Job,
) -> Result<Option<Episode>, tokio_postgres::Error> {
    let anime_id = job
        .payload
        .get("animeId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let number = job
        .payload
        .get("episodeNumber")
        .and_then(Value::as_i64)
        .unwrap_or_default() as i32;
    let season = job
        .payload
        .get("season")
        .and_then(Value::as_i64)
        .unwrap_or(1) as i32;
    let row = client
        .query_opt(
            r#"
            SELECT e."id", a."audio"::text AS "audio",
                   e."videoUrl", e."videoBroken"
            FROM "Episode" e JOIN "Anime" a ON a."id" = e."animeId"
            WHERE e."animeId" = $1 AND e."season" = $2 AND e."number" = $3
            "#,
            &[&anime_id, &season, &number],
        )
        .await?;
    Ok(row.map(|row| Episode {
        id: row.get("id"),
        audio: row.get("audio"),
        video_url: row.get("videoUrl"),
        video_broken: row.get("videoBroken"),
    }))
}

async fn candidates(
    client: &Client,
    job: &Job,
    episode: &Episode,
) -> Result<Vec<Candidate>, tokio_postgres::Error> {
    let anime_id = job
        .payload
        .get("animeId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let number = job
        .payload
        .get("episodeNumber")
        .and_then(Value::as_i64)
        .unwrap_or_default() as i32;
    let season = job
        .payload
        .get("season")
        .and_then(Value::as_i64)
        .unwrap_or(1) as i32;
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let rows = client
        .query(
            r#"
            SELECT source."sourceId", source."pageUrl"
            FROM "EpisodeSource" source
            JOIN "Episode" episode ON episode."id" = source."episodeId"
            JOIN "Anime" anime ON anime."id" = episode."animeId"
            WHERE episode."animeId" = $1 AND episode."season" = $2 AND episode."number" = $3
              AND source."audio" = anime."audio"
              AND source."verifiedAt" IS NOT NULL
            ORDER BY source."verifiedAt" DESC NULLS LAST, source."updatedAt" DESC
            "#,
            &[&anime_id, &season, &number],
        )
        .await?;
    for row in rows {
        let source_id: String = row.get("sourceId");
        let page_url: String = row.get("pageUrl");
        if rust_source_host(&page_url)
            && source_matches_host(&source_id, &page_url)
            && episode_path_matches(&page_url, number)
            && seen.insert(page_url.clone())
        {
            out.push(Candidate {
                source_id,
                page_url,
            });
        }
    }
    let _ = episode;
    Ok(out)
}

async fn scrape_candidate(candidate: &Candidate) -> Result<ScrapeOutcome, ()> {
    let binary = env::var("WT_SCRAPER_BIN").unwrap_or_else(|_| "animefire-scraper".to_owned());
    let mut child = Command::new(binary)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| ())?;
    let input = json!({"episodeUrl": candidate.page_url, "ua": USER_AGENT});
    if child
        .stdin
        .as_mut()
        .ok_or(())?
        .write_all(input.to_string().as_bytes())
        .await
        .is_err()
    {
        let _ = child.kill().await;
        return Err(());
    }
    let output = timeout(Duration::from_secs(65), child.wait_with_output())
        .await
        .map_err(|_| ())?
        .map_err(|_| ())?;
    if !output.status.success() || output.stdout.len() > 5 * 1024 * 1024 {
        return Err(());
    }
    let parsed: ScrapeResult = serde_json::from_slice(&output.stdout).map_err(|_| ())?;
    let mut urls = parsed.videos;
    // Blogger tokens need a browser-bound IP and the Node Playwright resolver.
    // Keep this mapped episode for the legacy browser adapter instead.
    if urls.is_empty() && !parsed.player_tokens.is_empty() {
        return Ok(ScrapeOutcome::BrowserRequired);
    }
    urls.truncate(4);
    Ok(ScrapeOutcome::Videos(urls))
}

async fn enqueue_scan_and_complete(
    client: &mut Client,
    job: &Job,
) -> Result<(), tokio_postgres::Error> {
    let anime_id = job
        .payload
        .get("animeId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let tx = client.transaction().await?;
    let owned = tx
        .query_opt(
            r#"SELECT "id" FROM "WatchtowerJob"
               WHERE "id" = $1 AND "lockedBy" = $2 AND "status" = 'RUNNING'
                 AND "lockedAt" > NOW() - ($3 * INTERVAL '1 second') FOR UPDATE"#,
            &[&job.id, &job.locked_by, &LEASE_VALID_FOR_SECONDS],
        )
        .await?;
    if owned.is_none() {
        tx.rollback().await?;
        return Ok(());
    }
    let anime = tx
        .query_opt(
            r#"SELECT "slug" FROM "Anime" WHERE "id" = $1"#,
            &[&anime_id],
        )
        .await?;
    if let Some(anime) = anime {
        let slug: String = anime.get("slug");
        let payload = json!({"animeId": anime_id, "slug": slug});
        tx.execute(
            r#"
            INSERT INTO "WatchtowerJob"
                ("id", "type", "dedupeKey", "payload", "priority", "maxAttempts", "nextRunAt", "createdAt", "updatedAt")
            VALUES (gen_random_uuid()::text, 'SCAN_CATALOG', $1, $2, 75, 8, NOW(), NOW(), NOW())
            ON CONFLICT ("type", "dedupeKey") DO UPDATE SET
                "payload" = EXCLUDED."payload",
                "priority" = LEAST("WatchtowerJob"."priority", EXCLUDED."priority"),
                "status" = CASE WHEN "WatchtowerJob"."status" IN ('DONE', 'DEAD') THEN 'PENDING' ELSE "WatchtowerJob"."status" END,
                "attempts" = CASE WHEN "WatchtowerJob"."status" IN ('DONE', 'DEAD') THEN 0 ELSE "WatchtowerJob"."attempts" END,
                "nextRunAt" = CASE WHEN "WatchtowerJob"."status" IN ('DONE', 'DEAD') THEN NOW() ELSE "WatchtowerJob"."nextRunAt" END,
                "updatedAt" = NOW()
            "#,
            &[&format!("scan-catalog:{anime_id}"), &payload],
        )
        .await?;
    }
    tx.execute(
        r#"UPDATE "WatchtowerJob" SET "status" = 'DONE', "lockedBy" = NULL,
           "lockedAt" = NULL, "lastError" = NULL, "updatedAt" = NOW()
           WHERE "id" = $1 AND "lockedBy" = $2 AND "status" = 'RUNNING'
             AND "lockedAt" > NOW() - ($3 * INTERVAL '1 second')"#,
        &[&job.id, &job.locked_by, &LEASE_VALID_FOR_SECONDS],
    )
    .await?;
    tx.commit().await
}

async fn finish_healthy(
    client: &mut Client,
    job: &Job,
    episode: &Episode,
) -> Result<(), tokio_postgres::Error> {
    let tx = client.transaction().await?;
    let owned = tx
        .query_opt(
            r#"SELECT "id" FROM "WatchtowerJob"
               WHERE "id" = $1 AND "lockedBy" = $2 AND "status" = 'RUNNING'
                 AND "lockedAt" > NOW() - ($3 * INTERVAL '1 second') FOR UPDATE"#,
            &[&job.id, &job.locked_by, &LEASE_VALID_FOR_SECONDS],
        )
        .await?;
    if owned.is_none() {
        tx.rollback().await?;
        return Ok(());
    }
    tx.execute(
        r#"UPDATE "Episode" SET "videoBroken" = false, "videoCheckedAt" = NOW(), "repairQueuedAt" = NULL, "updatedAt" = NOW() WHERE "id" = $1"#,
        &[&episode.id],
    ).await?;
    tx.execute(
        r#"UPDATE "WatchtowerJob" SET "status" = 'DONE', "lockedBy" = NULL,
           "lockedAt" = NULL, "lastError" = NULL, "updatedAt" = NOW()
           WHERE "id" = $1 AND "lockedBy" = $2 AND "status" = 'RUNNING'"#,
        &[&job.id, &job.locked_by],
    )
    .await?;
    tx.commit().await
}

async fn publish_repair(
    client: &mut Client,
    job: &Job,
    episode: &Episode,
    candidate: &Candidate,
    video_url: &str,
) -> Result<(), tokio_postgres::Error> {
    let anime_id = job
        .payload
        .get("animeId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let number = job
        .payload
        .get("episodeNumber")
        .and_then(Value::as_i64)
        .unwrap_or_default() as i32;
    let season = job
        .payload
        .get("season")
        .and_then(Value::as_i64)
        .unwrap_or(1) as i32;
    let tx = client.transaction().await?;
    let owned = tx.query_opt(
        r#"SELECT "id" FROM "WatchtowerJob" WHERE "id" = $1 AND "lockedBy" = $2
           AND "status" = 'RUNNING' AND "lockedAt" > NOW() - ($3 * INTERVAL '1 second') FOR UPDATE"#,
        &[&job.id, &job.locked_by, &LEASE_VALID_FOR_SECONDS],
    ).await?;
    if owned.is_none() {
        tx.rollback().await?;
        return Ok(());
    }
    let updated = tx
        .execute(
            r#"UPDATE "Episode" SET "videoUrl" = $1, "embedUrl" = $2, "sourceId" = $3,
           "videoBroken" = false, "videoCheckedAt" = NOW(), "repairQueuedAt" = NULL,
           "dateModified" = NOW(), "updatedAt" = NOW()
           WHERE "id" = $4 AND "animeId" = $5 AND "season" = $6 AND "number" = $7
             AND "videoUrl" IS NOT DISTINCT FROM $8"#,
            &[
                &video_url,
                &candidate.page_url,
                &candidate.source_id,
                &episode.id,
                &anime_id,
                &season,
                &number,
                &episode.video_url,
            ],
        )
        .await?;
    if updated == 0 {
        let current = tx
            .query_opt(
                r#"SELECT "videoUrl", "videoBroken" FROM "Episode" WHERE "id" = $1 FOR UPDATE"#,
                &[&episode.id],
            )
            .await?;
        if current.as_ref().is_some_and(|row| {
            row.get::<_, Option<String>>("videoUrl").is_some() && !row.get::<_, bool>("videoBroken")
        }) {
            tx.execute(
                r#"UPDATE "WatchtowerJob" SET "status" = 'DONE', "lockedBy" = NULL,
                   "lockedAt" = NULL, "lastError" = NULL, "updatedAt" = NOW()
                   WHERE "id" = $1 AND "lockedBy" = $2 AND "status" = 'RUNNING'"#,
                &[&job.id, &job.locked_by],
            )
            .await?;
            return tx.commit().await;
        }
        tx.rollback().await?;
        return Ok(());
    }
    tx.execute(
        r#"INSERT INTO "EpisodeSource" ("id", "episodeId", "sourceId", "pageUrl", "audio", "verifiedAt", "createdAt", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4::"AudioType", NOW(), NOW(), NOW())
           ON CONFLICT ("episodeId", "sourceId") DO UPDATE SET
             "pageUrl" = EXCLUDED."pageUrl", "audio" = EXCLUDED."audio",
             "verifiedAt" = NOW(), "lastError" = NULL, "updatedAt" = NOW()"#,
        &[&episode.id, &candidate.source_id, &candidate.page_url, &episode.audio],
    ).await?;
    tx.execute(
        r#"UPDATE "WatchtowerJob" SET "status" = 'DONE', "lockedBy" = NULL, "lockedAt" = NULL,
           "lastError" = NULL, "updatedAt" = NOW() WHERE "id" = $1 AND "lockedBy" = $2 AND "status" = 'RUNNING'"#,
        &[&job.id, &job.locked_by],
    ).await?;
    tx.commit().await
}

async fn release_for_retry(client: &Client, job: &Job) -> Result<(), tokio_postgres::Error> {
    client
        .execute(
            r#"UPDATE "WatchtowerJob" SET
             "status" = 'PENDING', "nextRunAt" = NOW(), "lockedBy" = NULL, "lockedAt" = NULL,
             "lastError" = 'rust_shutdown_interrupted', "updatedAt" = NOW()
           WHERE "id" = $1 AND "lockedBy" = $2 AND "status" = 'RUNNING'
             AND "lockedAt" > NOW() - ($3 * INTERVAL '1 second')"#,
            &[&job.id, &job.locked_by, &LEASE_VALID_FOR_SECONDS],
        )
        .await?;
    Ok(())
}

async fn handoff_browser_required(
    client: &Client,
    job: &Job,
    candidate: &Candidate,
) -> Result<(), tokio_postgres::Error> {
    let fallback = json!({
        "rustFallbackAt": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs(),
        "rustFallbackReason": "browser_required",
        "rustFallbackUrl": candidate.page_url,
        "rustFallbackSourceId": candidate.source_id,
    });
    client
        .execute(
            r#"UPDATE "WatchtowerJob" SET
                 "payload" = jsonb_set("payload", '{rustEligible}', 'false'::jsonb, true) || $4,
                 "status" = 'PENDING', "nextRunAt" = NOW(), "lockedBy" = NULL,
                 "lockedAt" = NULL, "lastError" = 'rust_browser_required', "updatedAt" = NOW()
               WHERE "id" = $1 AND "lockedBy" = $2 AND "status" = 'RUNNING'
                 AND "lockedAt" > NOW() - ($3 * INTERVAL '1 second')"#,
            &[&job.id, &job.locked_by, &LEASE_VALID_FOR_SECONDS, &fallback],
        )
        .await?;
    Ok(())
}

async fn process_job(client: &mut Client, job: &Job) -> Result<(), tokio_postgres::Error> {
    let Some(episode) = fetch_episode(client, job).await? else {
        enqueue_scan_and_complete(client, job).await?;
        log_event(
            "repair_missing_episode_handed_to_catalog_scan",
            json!({"jobId": job.id}),
        );
        return Ok(());
    };
    if !episode.video_broken {
        if let Some(video_url) = &episode.video_url {
            match media_is_live(video_url).await {
                Some(true) => {
                    finish_healthy(client, job, &episode).await?;
                    log_event("repair_current_source_still_live", json!({"jobId": job.id}));
                    return Ok(());
                }
                None => {
                    // A timeout/403/429 is not evidence that the current URL is dead.
                    fail_job(client, job, "rust_current_media_probe_inconclusive").await?;
                    log_event("repair_probe_inconclusive_retry", json!({"jobId": job.id}));
                    return Ok(());
                }
                Some(false) => {}
            }
        }
    }
    let candidates = candidates(client, job, &episode).await?;
    if candidates.is_empty() {
        fail_job(client, job, "rust_no_verified_supported_episode_mapping").await?;
        return Ok(());
    }

    let mut browser_candidate = None;
    for candidate in candidates {
        let videos = match scrape_candidate(&candidate).await {
            Ok(ScrapeOutcome::Videos(videos)) => videos,
            Ok(ScrapeOutcome::BrowserRequired) => {
                browser_candidate = Some(candidate.clone());
                continue;
            }
            Err(()) => continue,
        };
        for video in videos {
            match media_is_live(&video).await {
                Some(true) => {
                    publish_repair(client, job, &episode, &candidate, &video).await?;
                    log_event(
                        "repair_source_replaced",
                        json!({"jobId": job.id, "sourceId": candidate.source_id}),
                    );
                    return Ok(());
                }
                _ => continue,
            }
        }
    }
    if let Some(candidate) = browser_candidate {
        // The EpisodeSource row, audio, host and episode number were checked
        // before delegating this exact page to the existing Playwright adapter.
        handoff_browser_required(client, job, &candidate).await?;
        log_event("repair_delegated_browser_source", json!({"jobId": job.id}));
        return Ok(());
    }
    fail_job(client, job, "rust_no_valid_alternative_source").await?;
    log_event("repair_alternatives_exhausted", json!({"jobId": job.id}));
    Ok(())
}

fn backoff_seconds(attempt: i32) -> i64 {
    [900, 3600, 21600, 86400, 172800]
        .get(attempt.clamp(0, 4) as usize)
        .copied()
        .unwrap_or(172800)
}

async fn fail_job(client: &Client, job: &Job, message: &str) -> Result<(), tokio_postgres::Error> {
    let next_attempt = job.attempts + 1;
    let dead = next_attempt >= job.max_attempts;
    let backoff = backoff_seconds(job.attempts);
    client.execute(
        r#"UPDATE "WatchtowerJob" SET "status" = $1, "attempts" = $2,
           "lastError" = $3, "nextRunAt" = CASE WHEN $1 = 'PENDING' THEN NOW() + ($4 * INTERVAL '1 second') ELSE "nextRunAt" END,
           "lockedBy" = NULL, "lockedAt" = NULL, "updatedAt" = NOW()
           WHERE "id" = $5 AND "lockedBy" = $6 AND "status" = 'RUNNING'
             AND "lockedAt" > NOW() - ($7 * INTERVAL '1 second')"#,
        &[&if dead { "DEAD" } else { "PENDING" }, &next_attempt, &message, &backoff, &job.id, &job.locked_by, &LEASE_VALID_FOR_SECONDS],
    ).await?;
    Ok(())
}

async fn write_heartbeat() {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let _ = tokio::fs::write(HEARTBEAT_FILE, now.to_string()).await;
}

async fn healthcheck() -> bool {
    let Ok(contents) = tokio::fs::read_to_string(HEARTBEAT_FILE).await else {
        return false;
    };
    let Ok(timestamp) = contents.parse::<u64>() else {
        return false;
    };
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .saturating_sub(timestamp)
        <= 45
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("registrar SIGTERM");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = terminate.recv() => {},
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

#[tokio::main]
async fn main() {
    if std::env::args().any(|arg| arg == "--healthcheck") {
        std::process::exit(if healthcheck().await { 0 } else { 1 });
    }
    let database_url = match env::var("DATABASE_URL") {
        Ok(url) => url,
        Err(_) => {
            eprintln!("{{\"event\":\"worker_start_failed\",\"reason\":\"DATABASE_URL ausente\"}}");
            std::process::exit(1);
        }
    };
    let enabled = env_bool("WT_RUST_REPAIR_ENABLED");
    log_event(
        "worker_started",
        json!({"enabled": enabled, "jobType": "REPAIR_EPISODE"}),
    );
    tokio::spawn(async {
        loop {
            write_heartbeat().await;
            sleep(Duration::from_secs(10)).await;
        }
    });
    let shutdown = shutdown_signal();
    tokio::pin!(shutdown);
    let mut client: Option<Client> = None;
    loop {
        if enabled {
            if client.is_none() {
                match connect(&database_url).await {
                    Ok(connection) => client = Some(connection),
                    Err(_) => {
                        log_event("postgres_reconnect_scheduled", json!({}));
                        sleep(Duration::from_secs(5)).await;
                        continue;
                    }
                }
            }
            if let Some(db) = client.as_ref() {
                match claim(db).await {
                    Ok(Some(job)) => {
                        let heartbeat_task = tokio::spawn(heartbeat(
                            database_url.clone(),
                            job.id.clone(),
                            job.locked_by.clone(),
                        ));
                        let outcome = tokio::select! {
                            result = timeout(
                                Duration::from_secs(180),
                                process_job(client.as_mut().expect("db connection exists"), &job),
                            ) => Some(result),
                            _ = &mut shutdown => None,
                        };
                        heartbeat_task.abort();
                        match outcome {
                            None => {
                                if let Some(db) = client.as_ref() {
                                    let _ = release_for_retry(db, &job).await;
                                }
                                log_event("worker_shutdown", json!({"jobId": job.id}));
                                break;
                            }
                            Some(Ok(Ok(()))) => {}
                            Some(Ok(Err(_))) | Some(Err(_)) => {
                                if let Some(db) = client.as_ref() {
                                    if fail_job(db, &job, "rust_repair_transient_failure")
                                        .await
                                        .is_err()
                                    {
                                        client = None;
                                    }
                                }
                                log_event("repair_attempt_failed", json!({"jobId": job.id}));
                            }
                        }
                    }
                    Ok(None) => sleep(Duration::from_secs(2)).await,
                    Err(_) => {
                        client = None;
                        sleep(Duration::from_secs(5)).await;
                    }
                }
            }
        } else {
            sleep(Duration::from_secs(5)).await;
        }
        tokio::select! {
            _ = &mut shutdown => {
                log_event("worker_shutdown", json!({}));
                break;
            }
            _ = sleep(Duration::from_millis(10)) => {}
        }
    }
}
