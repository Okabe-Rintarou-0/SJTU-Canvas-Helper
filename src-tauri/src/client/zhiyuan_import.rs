use std::{
    sync::{Arc, LazyLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use regex::Regex;

use reqwest::{cookie::Jar, redirect, Client, Response, StatusCode, Url};
use serde::{de::DeserializeOwned, Deserialize, Serialize};

const PORTAL: &str = "my.sjtu.edu.cn";
const COMPLETED_PATH: &str = "/ui/task/done";
const COMPLETED_PAGE: &str = "https://my.sjtu.edu.cn/ui/task/done";
const AUTH: &str = "jaccount.sjtu.edu.cn";
const FORM: &str = "form.sjtu.edu.cn";
const FORM_ORIGIN: &str = "https://form.sjtu.edu.cn";
const SEARCH_KEYWORD: &str = "致远一号";
const APPLICATION: &str = "致远一号AI模型API申请";
const MAX_RESPONSE: usize = 2 * 1024 * 1024;

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ZhiyuanKeyResult {
    Imported { key: String },
    NoLogin,
    NotFound,
    Unavailable,
}

#[derive(Deserialize)]
struct Envelope<T> {
    errno: u32,
    #[serde(default = "Vec::new")]
    entities: Vec<T>,
}

#[derive(Deserialize)]
struct Process {
    name: String,
    uri: Option<String>,
    app: Option<ProcessApp>,
}

#[derive(Deserialize)]
struct ProcessApp {
    name: Option<String>,
}

#[derive(Deserialize)]
struct RenderedForm {
    app: ProcessApp,
    data: RenderedFormData,
}

#[derive(Deserialize)]
struct RenderedFormData {
    #[serde(rename = "fieldAddBusinessApiKey")]
    issued_key: Option<String>,
}

fn allowed_redirect(url: &Url) -> bool {
    if url.scheme() != "https"
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return false;
    }
    match url.host_str() {
        Some(PORTAL) => matches!(url.path(), COMPLETED_PATH | "/ui/app/"),
        Some(FORM) => url.path() == "/infoplus/login" || form_identifier(url).is_some(),
        Some(AUTH) => matches!(url.path(), "/oauth2/authorize" | "/jaccount/jalogin"),
        _ => false,
    }
}

fn form_identifier(url: &Url) -> Option<&str> {
    if url.scheme() != "https"
        || url.host_str() != Some(FORM)
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    let id = url
        .path()
        .strip_prefix("/infoplus/form/")?
        .strip_suffix("/render")?;
    (is_step_id(id) || (id.len() == 36 && uuid::Uuid::try_parse(id).is_ok())).then_some(id)
}

fn is_step_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 20 && id.bytes().all(|c| c.is_ascii_digit())
}

fn form_url(uri: &str) -> Option<Url> {
    let url = Url::parse(uri.trim()).ok()?;
    let id = form_identifier(&url)?;
    Url::parse(&format!("{FORM_ORIGIN}/infoplus/form/{id}/render")).ok()
}

fn is_target_application(name: &str) -> bool {
    let normalized: String = name
        .chars()
        .filter(|c| !c.is_whitespace() && !matches!(c, '“' | '”' | '"'))
        .map(|c| match c {
            '(' => '（',
            ')' => '）',
            c => c,
        })
        .collect();
    normalized == format!("{APPLICATION}（测试）")
}

async fn read_response(mut response: Response) -> Result<Vec<u8>, ZhiyuanKeyResult> {
    if response.url().host_str() == Some(AUTH)
        || matches!(
            response.status(),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
        )
    {
        return Err(ZhiyuanKeyResult::NoLogin);
    }
    if !response.status().is_success() {
        return Err(ZhiyuanKeyResult::Unavailable);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| ZhiyuanKeyResult::Unavailable)?
    {
        if body.len() + chunk.len() > MAX_RESPONSE {
            return Err(ZhiyuanKeyResult::Unavailable);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

async fn read_json<T: DeserializeOwned>(response: Response) -> Result<T, ZhiyuanKeyResult> {
    serde_json::from_slice(&read_response(response).await?)
        .map_err(|_| ZhiyuanKeyResult::Unavailable)
}

fn csrf_token(html: &str) -> Option<&str> {
    static META_TAG: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)<meta\b[^>]*>").expect("fixed meta tag expression"));
    static NAME: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"(?i)\bitemscope\s*=\s*["']csrfToken["']"#)
            .expect("fixed CSRF name expression")
    });
    static CONTENT: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"(?i)\bcontent\s*=\s*["']([a-z0-9_.~+/=-]{8,512})["']"#)
            .expect("fixed CSRF content expression")
    });
    META_TAG
        .find_iter(html)
        .map(|tag| tag.as_str())
        .find_map(|tag| {
            if !NAME.is_match(tag) {
                return None;
            }
            CONTENT.captures(tag)?.get(1).map(|value| value.as_str())
        })
}

fn key_from_form(response: Envelope<RenderedForm>) -> Option<String> {
    response.entities.into_iter().find_map(|form| {
        if !form.app.name.as_deref().is_some_and(is_target_application) {
            return None;
        }
        let key = form.data.issued_key?;
        let key = key.trim();
        ((12..=512).contains(&key.len())
            && key
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"-_.~+/=".contains(&c)))
        .then(|| key.to_owned())
    })
}

async fn read_form_key(client: &Client, url: &Url) -> Result<Option<String>, ZhiyuanKeyResult> {
    let page = client
        .get(url.clone())
        .send()
        .await
        .map_err(|_| ZhiyuanKeyResult::Unavailable)?;
    let rendered_url = page.url().clone();
    let body = read_response(page).await?;
    // The completed list links to a workflow UUID. InfoPlus redirects it to the
    // numeric step whose data is loaded by the render request.
    let step_id = form_identifier(&rendered_url)
        .filter(|id| is_step_id(id))
        .ok_or(ZhiyuanKeyResult::Unavailable)?;
    let html = std::str::from_utf8(&body).map_err(|_| ZhiyuanKeyResult::Unavailable)?;
    let csrf = csrf_token(html).ok_or(ZhiyuanKeyResult::Unavailable)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let rand = format!("0.{:09}", timestamp.subsec_nanos());
    let response = client
        .post(format!("{FORM_ORIGIN}/infoplus/interface/render"))
        .header("Accept", "application/json, text/json, */*")
        .header("X-Requested-With", "XMLHttpRequest")
        .header("Origin", FORM_ORIGIN)
        .header("Referer", rendered_url.as_str())
        .form(&[
            ("stepId", step_id),
            ("instanceId", ""),
            ("admin", "false"),
            ("rand", &rand),
            ("width", "960"),
            ("lang", "zh"),
            ("csrfToken", csrf),
        ])
        .send()
        .await
        .map_err(|_| ZhiyuanKeyResult::Unavailable)?;
    let data: Envelope<RenderedForm> = read_json(response).await?;
    match data.errno {
        0 => Ok(key_from_form(data)),
        16005 => Err(ZhiyuanKeyResult::NoLogin),
        _ => Err(ZhiyuanKeyResult::Unavailable),
    }
}

async fn request_key(cookie: &str) -> Result<String, ZhiyuanKeyResult> {
    let cookie = cookie.trim();
    if cookie.is_empty()
        || cookie
            .bytes()
            .any(|c| !c.is_ascii_graphic() || b";,".contains(&c))
    {
        return Err(ZhiyuanKeyResult::NoLogin);
    }
    let jar = Arc::new(Jar::default());
    let auth =
        Url::parse("https://jaccount.sjtu.edu.cn/jaccount/jalogin").expect("fixed jAccount URL");
    jar.add_cookie_str(
        &format!("JAAuthCookie={cookie}; Secure; HttpOnly; Path=/jaccount/jalogin"),
        &auth,
    );
    // Keep the jAccount and portal session out of the normal request logger and Canvas jar.
    let client = Client::builder()
        .cookie_provider(jar)
        .referer(false)
        .timeout(Duration::from_secs(10))
        .redirect(redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 10 && allowed_redirect(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|_| ZhiyuanKeyResult::Unavailable)?;
    let mut callback = client
        .get(COMPLETED_PAGE)
        .send()
        .await
        .map_err(|_| ZhiyuanKeyResult::Unavailable)?;
    // The portal may set its session cookie, then redirect away from the OAuth callback.
    // Reload the same first-party entry in that case, without following the new destination.
    if callback.status().is_redirection()
        && callback.url().host_str() == Some(PORTAL)
        && matches!(callback.url().path(), COMPLETED_PATH | "/ui/app/")
        && callback.url().query_pairs().any(|(name, _)| name == "code")
    {
        callback = client
            .get(COMPLETED_PAGE)
            .send()
            .await
            .map_err(|_| ZhiyuanKeyResult::Unavailable)?;
    }
    if callback.url().host_str() == Some(AUTH)
        || matches!(
            callback.status(),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
        )
    {
        return Err(ZhiyuanKeyResult::NoLogin);
    }
    if !callback.status().is_success() || callback.url().host_str() != Some(PORTAL) {
        return Err(ZhiyuanKeyResult::Unavailable);
    }

    let mut start = 0;
    let mut visited = std::collections::HashSet::new();
    let mut form_error = None;
    const PAGE_SIZE: usize = 20;
    while start < 100 {
        let response = client
            .get(format!("https://{PORTAL}/api/task/me/processes/completed"))
            .header("Accept", "application/json, text/plain, */*")
            .header("X-Requested-With", "XMLHttpRequest")
            .header("Referer", COMPLETED_PAGE)
            .query(&[
                ("keyword", SEARCH_KEYWORD.to_owned()),
                ("order", "auto".to_owned()),
                ("start", start.to_string()),
                ("limit", PAGE_SIZE.to_string()),
            ])
            .send()
            .await
            .map_err(|_| ZhiyuanKeyResult::Unavailable)?;
        let page: Envelope<Process> = read_json(response).await?;
        if page.errno != 0 {
            return Err(ZhiyuanKeyResult::Unavailable);
        }
        let count = page.entities.len();
        for process in page.entities.into_iter().filter(|process| {
            is_target_application(&process.name)
                || process
                    .app
                    .as_ref()
                    .and_then(|app| app.name.as_deref())
                    .is_some_and(is_target_application)
        }) {
            let Some(url) = process.uri.as_deref().and_then(form_url) else {
                continue;
            };
            if visited.insert(url.clone()) {
                match read_form_key(&client, &url).await {
                    Ok(Some(key)) => return Ok(key),
                    Ok(None) => {}
                    Err(status) => form_error = Some(status),
                }
            }
        }
        if count < PAGE_SIZE {
            return Err(form_error.unwrap_or(ZhiyuanKeyResult::NotFound));
        }
        start += count;
    }
    Err(ZhiyuanKeyResult::Unavailable)
}

pub async fn read_zhiyuan_key(cookie: &str) -> ZhiyuanKeyResult {
    match tokio::time::timeout(Duration::from_secs(35), request_key(cookie)).await {
        Ok(Ok(key)) => ZhiyuanKeyResult::Imported { key },
        Ok(Err(status)) => status,
        Err(_) => ZhiyuanKeyResult::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn completed_workflow_and_numeric_step_links_are_accepted() {
        let uri =
            "https://form.sjtu.edu.cn/infoplus/form/11111111-2222-4333-8444-555555555555/render";
        let workflow = form_url(&format!("{uri}?from=portal#section")).unwrap();
        assert_eq!(workflow.as_str(), uri);
        assert!(allowed_redirect(&workflow));
        assert!(!is_step_id(form_identifier(&workflow).unwrap()));
        let step = form_url("https://form.sjtu.edu.cn/infoplus/form/123456/render").unwrap();
        assert!(allowed_redirect(&step));
        assert_eq!(
            form_identifier(&step).filter(|id| is_step_id(id)),
            Some("123456")
        );
    }

    #[test]
    fn rendered_application_uses_issued_key_instead_of_key_code() {
        let envelope = |name: &str| -> Envelope<RenderedForm> {
            serde_json::from_value(serde_json::json!({
                "errno": 0,
                "entities": [{
                    "app": {"name": name},
                    "data": {
                        "fieldApiKeyCode": "synthetic-key-reference",
                        "fieldAddBusinessApiKey": "synthetic-issued-key",
                        "fieldBusinessApiKey": ""
                    }
                }]
            }))
            .unwrap()
        };
        assert_eq!(
            key_from_form(envelope("“致远一号”AI模型API申请（测试）")).as_deref(),
            Some("synthetic-issued-key")
        );
        assert!(key_from_form(envelope("其他服务申请")).is_none());
        assert_eq!(
            csrf_token(r#"<meta itemscope="csrfToken" content="synthetic-csrf"/>"#),
            Some("synthetic-csrf")
        );
    }

    #[test]
    fn permits_only_https_redirects_to_the_first_party_login_and_portal_pages() {
        for target in [
            "https://example.org/jaccount/jalogin",
            "https://jaccount.sjtu.edu.cn.example.org/jaccount/jalogin",
            "http://jaccount.sjtu.edu.cn/jaccount/jalogin",
            "https://my.sjtu.edu.cn/api/task/me/processes/doing",
        ] {
            assert!(!allowed_redirect(&Url::parse(target).unwrap()));
        }
        for target in [
            "https://jaccount.sjtu.edu.cn/jaccount/jalogin",
            "https://my.sjtu.edu.cn/ui/app/?code=demo&state=demo",
            "https://my.sjtu.edu.cn/ui/task/done?code=demo&state=demo",
        ] {
            assert!(allowed_redirect(&Url::parse(target).unwrap()));
        }
    }
}
