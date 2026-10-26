//! A private media credential store derived only from an admitted config snapshot.
//! Never copies the mutable live login Jar or expands a saved Cookie header's scope.
use std::sync::Arc;
use reqwest::{cookie::{CookieStore, Jar}, header::HeaderValue, redirect::Policy, Url};
use crate::error::Result;

struct ScopedJar {
    jar: Jar,
    scope: Url,
}

impl ScopedJar {
    fn admits(&self, url: &Url) -> bool {
        let path = self.scope.path().trim_end_matches('/');
        url.origin() == self.scope.origin()
            && (url.path() == path || url.path().starts_with(&format!("{path}/")))
    }
}

impl CookieStore for ScopedJar {
    fn set_cookies(&self, cookies: &mut dyn Iterator<Item = &HeaderValue>, url: &Url) {
        if self.admits(url) {
            self.jar.set_cookies(cookies, url);
        }
    }
    fn cookies(&self, url: &Url) -> Option<HeaderValue> {
        // reqwest0.11 retains previous Cookie on None during redirects; explicit empty header clears it outside scope or after expiration.
        Some(if self.admits(url) {
            self.jar.cookies(url).unwrap_or_else(|| HeaderValue::from_static(""))
        } else {
            HeaderValue::from_static("")
        })
    }
}

pub(super) fn client_for_cookie_scope(cookies: &str, scope: Url) -> Result<reqwest::Client> {
    // Production passes the fixed HTTPS VIDEO_BASE_URL. Tests may supply an
    // owned loopback origin; no caller-controlled download URL defines scope.
    let jar = Jar::default();
    for pair in cookies.split(';').map(str::trim).filter(|pair| !pair.is_empty()) {
        let (name, value) = pair.split_once('=').ok_or_else(|| std::io::Error::new(
            std::io::ErrorKind::InvalidInput, "Invalid saved media cookie"))?;
        if name.is_empty() || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
            || value.bytes().any(|b| b < 0x20 || b == 0x7f) {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "Invalid saved media cookie").into());
        }
        let secure = if scope.scheme() == "https" { "; Secure" } else { "" };
        jar.add_cookie_str(&format!("{name}={value}; Path={}{secure}", scope.path()), &scope);
    }
    let provider = Arc::new(ScopedJar { jar, scope });
    Ok(reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36")
        .cookie_provider(provider)
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() >= 10 {
                return attempt.error("Media redirect limit reached");
            }
            if attempt.url().scheme() == "http" && attempt.previous().iter().any(|url| url.scheme() == "https") {
                return attempt.error("Media HTTPS downgrade rejected");
            }
            attempt.follow()
        }))
        .build()?)
}
