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

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::{Method::GET, MockServer};
    use std::time::Duration;

    fn scoped_client(server: &MockServer) -> reqwest::Client {
        client_for_cookie_scope("session=synthetic-secret", Url::parse(&server.url("/app")).unwrap())
            .unwrap()
    }

    async fn get(client: &reqwest::Client, url: &str) {
        client.get(url).timeout(Duration::from_secs(5)).send().await.unwrap()
            .error_for_status().unwrap();
    }

    #[tokio::test]
    async fn saved_cookies_are_sent_only_inside_the_exact_origin_and_path_boundary() {
        let origin = MockServer::start();
        let foreign = MockServer::start();
        let client = scoped_client(&origin);
        for path in ["/app", "/app/", "/app/info"] {
            let expected = origin.mock(|when, then| {
                when.method(GET).path(path).header("cookie", "session=synthetic-secret");
                then.status(200);
            });
            get(&client, &origin.url(path)).await;
            expected.assert();
        }
        for path in ["/", "/outside", "/application", "/app-other"] {
            let expected = origin.mock(|when, then| {
                when.method(GET).path(path).header("cookie", "");
                then.status(200);
            });
            get(&client, &origin.url(path)).await;
            expected.assert();
        }
        let expected = foreign.mock(|when, then| {
            when.method(GET).path("/app/info").header("cookie", "");
            then.status(200);
        });
        get(&client, &foreign.url("/app/info")).await;
        expected.assert();
    }

    #[tokio::test]
    async fn redirects_clear_credentials_outside_scope_and_restore_only_at_the_admitted_origin() {
        let origin = MockServer::start();
        let foreign = MockServer::start();
        let start = origin.mock(|when, then| {
            when.method(GET).path("/app/start").header("cookie", "session=synthetic-secret");
            then.status(302).header("location", "/outside");
        });
        let outside = origin.mock(|when, then| {
            when.method(GET).path("/outside").header("cookie", "");
            then.status(302).header("location", foreign.url("/app/hop"));
        });
        let hop = foreign.mock(|when, then| {
            when.method(GET).path("/app/hop").header("cookie", "");
            then.status(302).header("location", origin.url("/app/finish"));
        });
        let finish = origin.mock(|when, then| {
            when.method(GET).path("/app/finish").header("cookie", "session=synthetic-secret");
            then.status(200);
        });
        get(&scoped_client(&origin), &origin.url("/app/start")).await;
        for expected in [&start, &outside, &hop, &finish] {
            expected.assert();
        }
    }

    #[tokio::test]
    async fn broad_response_cookie_cannot_expand_scope_and_outside_responses_cannot_poison_it() {
        let origin = MockServer::start();
        let seed = origin.mock(|when, then| {
            when.method(GET).path("/app/seed").header("cookie", "session=synthetic-secret");
            then.status(302).header("set-cookie", "broad=inside-only; Path=/")
                .header("location", "/outside");
        });
        let outside = origin.mock(|when, then| {
            when.method(GET).path("/outside").header("cookie", "");
            then.status(302).header("set-cookie", "session=poison; Path=/app")
                .header("location", "/app/finish");
        });
        // Jar cookie order is unspecified, so verify the resulting values at the
        // store boundary below as well as the empty header at the unsafe hop.
        let finish = origin.mock(|when, then| {
            when.method(GET).path("/app/finish");
            then.status(200);
        });
        get(&scoped_client(&origin), &origin.url("/app/seed")).await;
        seed.assert(); outside.assert(); finish.assert();

        let scope = Url::parse(&origin.url("/app")).unwrap();
        let jar = ScopedJar { jar: Jar::default(), scope: scope.clone() };
        let good = HeaderValue::from_static("session=synthetic-secret; Path=/");
        jar.set_cookies(&mut [&good].into_iter(), &scope);
        let bad = HeaderValue::from_static("session=poison; Path=/");
        jar.set_cookies(&mut [&bad].into_iter(), &Url::parse(&origin.url("/outside")).unwrap());
        assert_eq!(jar.cookies(&scope).unwrap(), "session=synthetic-secret");
        assert_eq!(jar.cookies(&Url::parse(&origin.url("/outside")).unwrap()).unwrap(), "");
    }

    #[tokio::test]
    async fn scoped_clients_do_not_share_response_cookies() {
        let origin = MockServer::start();
        let first = client_for_cookie_scope("session=first", Url::parse(&origin.url("/app")).unwrap()).unwrap();
        let second = client_for_cookie_scope("session=second", Url::parse(&origin.url("/app")).unwrap()).unwrap();
        let seed = origin.mock(|when, then| {
            when.method(GET).path("/app/seed").header("cookie", "session=first");
            then.status(200).header("set-cookie", "session=rotated; Path=/app");
        });
        let first_read = origin.mock(|when, then| {
            when.method(GET).path("/app/first").header("cookie", "session=rotated");
            then.status(200);
        });
        let second_read = origin.mock(|when, then| {
            when.method(GET).path("/app/second").header("cookie", "session=second");
            then.status(200);
        });
        get(&first, &origin.url("/app/seed")).await;
        get(&first, &origin.url("/app/first")).await;
        get(&second, &origin.url("/app/second")).await;
        seed.assert(); first_read.assert(); second_read.assert();
    }
}
