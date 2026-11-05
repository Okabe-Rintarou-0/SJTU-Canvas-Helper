//! Bounded, session-local recording JWTs. Course launches must not replace the
//! video-space credential used by unrelated recordings or in-flight requests.
use std::{
    collections::{HashMap, VecDeque},
    sync::Arc,
};

use super::Client;

const MAX_RECORDING_TOKENS: usize = 4096;

#[derive(Clone, Copy)]
pub(super) struct RecordingLaunch {
    generation: u64,
    sequence: u64,
}

#[derive(Clone, Copy)]
pub(super) struct VideoTokenVersion {
    reset_epoch: u64,
    generation: u64,
}

struct RecordingToken {
    value: Arc<str>,
    sequence: u64,
}

#[derive(Default)]
pub(super) struct RecordingTokens {
    reset_epoch: u64,
    generation: u64,
    sequence: u64,
    // An evicted newer binding must not be reintroduced by an older list that
    // was still in flight. This floor is bounded metadata, not a second cache.
    evicted_through: u64,
    values: HashMap<String, RecordingToken>,
    order: VecDeque<String>,
}

impl RecordingTokens {
    pub(super) fn begin_launch(&mut self) -> RecordingLaunch {
        if self.sequence == u64::MAX {
            self.clear();
            self.sequence = 0;
            self.evicted_through = 0;
        }
        self.sequence += 1;
        RecordingLaunch {
            generation: self.generation,
            sequence: self.sequence,
        }
    }

    pub(super) fn clear(&mut self) {
        self.reset_epoch = self.reset_epoch.wrapping_add(1);
        self.generation = self.generation.wrapping_add(1);
        self.values.clear();
        self.order.clear();
    }

    pub(super) fn get(&self, id: &str) -> Option<String> {
        self.values.get(id).map(|value| value.value.to_string())
    }

    pub(super) fn remember<'a>(
        &mut self,
        launch: RecordingLaunch,
        ids: impl IntoIterator<Item = &'a str>,
        token: &str,
    ) {
        if launch.generation != self.generation
            || launch.sequence <= self.evicted_through
            || token.is_empty()
        {
            return;
        }
        let token: Arc<str> = token.into();
        for id in ids.into_iter().filter(|id| !id.is_empty()) {
            if let Some(existing) = self.values.get(id) {
                if existing.sequence > launch.sequence {
                    continue;
                }
                self.order.retain(|entry| entry != id);
            } else if self.values.len() == MAX_RECORDING_TOKENS {
                if let Some(oldest) = self.order.front() {
                    // Do not evict a newer binding just to publish an old list.
                    if self.values[oldest].sequence > launch.sequence {
                        continue;
                    }
                }
                if let Some(oldest) = self.order.pop_front() {
                    if let Some(old) = self.values.remove(&oldest) {
                        self.evicted_through = self.evicted_through.max(old.sequence);
                    }
                }
            }
            self.order.push_back(id.into());
            self.values.insert(
                id.into(),
                RecordingToken {
                    value: token.clone(),
                    sequence: launch.sequence,
                },
            );
        }
    }

    fn invalidate_shared_token(&mut self, token: &str) {
        self.generation = self.generation.wrapping_add(1);
        self.values.retain(|_, entry| entry.value.as_ref() != token);
        self.order.retain(|id| self.values.contains_key(id));
    }
}

impl Client {
    // All publication acquires the recording lock before the default-token
    // lock. No HTTP or other external work runs under either lock.
    pub(super) async fn reset_video_tokens(&self, token: String) {
        let mut recordings = self.recording_tokens.write().await;
        *self.token.write().await = token;
        recordings.clear();
    }

    pub(super) async fn recording_token_snapshot(&self, id: &str) -> (String, VideoTokenVersion) {
        let recordings = self.recording_tokens.read().await;
        let token = match recordings.get(id) {
            Some(token) => token,
            None => self.token.read().await.clone(),
        };
        (
            token,
            VideoTokenVersion {
                reset_epoch: recordings.reset_epoch,
                generation: recordings.generation,
            },
        )
    }

    pub(super) async fn recording_token(&self, id: &str) -> String {
        self.recording_token_snapshot(id).await.0
    }

    pub(super) async fn publish_recording_refresh(
        &self,
        version: VideoTokenVersion,
        previous: &str,
        token: String,
    ) -> bool {
        let mut recordings = self.recording_tokens.write().await;
        if recordings.reset_epoch != version.reset_epoch {
            return false;
        }
        if recordings.generation == version.generation {
            *self.token.write().await = token;
        }
        // Another recording may have renewed the account-wide credential first.
        // Keep that newer publication, but still remove this successful request's
        // expired bindings. Only an explicit login/reset revokes this authority.
        // Sibling recordings from the same expired launch must use the fresh
        // video-space credential too. Unrelated course credentials stay bound.
        // Advancing generation also rejects lists begun before this renewal.
        recordings.invalidate_shared_token(previous);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recording_tokens_are_bounded_and_keep_other_courses_separate() {
        let mut tokens = RecordingTokens::default();
        let first = tokens.begin_launch();
        tokens.remember(first, ["a", "b"], "course-one");
        let second = tokens.begin_launch();
        tokens.remember(second, ["c"], "course-two");
        assert_eq!(tokens.get("a").as_deref(), Some("course-one"));
        assert_eq!(tokens.get("c").as_deref(), Some("course-two"));
        for id in 0..MAX_RECORDING_TOKENS {
            let launch = tokens.begin_launch();
            tokens.remember(launch, [id.to_string().as_str()], "another-course");
        }
        assert_eq!(tokens.values.len(), MAX_RECORDING_TOKENS);
        assert_eq!(tokens.order.len(), MAX_RECORDING_TOKENS);
        assert!(tokens.get("a").is_none());
        let launch = tokens.begin_launch();
        tokens.remember(launch, ["0"], "refreshed");
        let launch = tokens.begin_launch();
        tokens.remember(launch, ["new"], "new-course");
        assert_eq!(tokens.get("0").as_deref(), Some("refreshed"));
        assert!(tokens.get("1").is_none());
        assert_eq!(tokens.values.len(), MAX_RECORDING_TOKENS);
        tokens.remember(first, ["a"], "late-evicted");
        assert!(tokens.get("a").is_none());
    }

    #[test]
    fn later_list_wins_even_when_an_older_response_arrives_last() {
        let mut tokens = RecordingTokens::default();
        let old = tokens.begin_launch();
        let fresh = tokens.begin_launch();
        tokens.remember(fresh, ["a"], "fresh");
        tokens.remember(old, ["a", "other"], "old");
        assert_eq!(tokens.get("a").as_deref(), Some("fresh"));
        assert_eq!(tokens.get("other").as_deref(), Some("old"));
        tokens.clear();
        tokens.remember(fresh, ["a"], "late");
        assert!(tokens.get("a").is_none());
    }

    #[tokio::test]
    async fn concurrent_refreshes_for_different_courses_both_invalidate_their_old_bindings() {
        for (first, second) in [("a", "b"), ("b", "a")] {
            let client = Client::default();
            client.reset_video_tokens("initial-space".into()).await;
            let launch = client.recording_tokens.write().await.begin_launch();
            client
                .recording_tokens
                .write()
                .await
                .remember(launch, ["a", "a-sibling"], "old-a");
            client
                .recording_tokens
                .write()
                .await
                .remember(launch, ["b", "b-sibling"], "old-b");
            client
                .recording_tokens
                .write()
                .await
                .remember(launch, ["c"], "unrelated-course");
            let (first_token, first_version) = client.recording_token_snapshot(first).await;
            let (second_token, second_version) = client.recording_token_snapshot(second).await;
            assert!(
                client
                    .publish_recording_refresh(
                        first_version,
                        &first_token,
                        "first-fresh-space".into()
                    )
                    .await
            );
            assert!(
                client
                    .publish_recording_refresh(
                        second_version,
                        &second_token,
                        "later-response".into()
                    )
                    .await
            );
            for id in ["a", "a-sibling", "b", "b-sibling"] {
                assert_eq!(client.recording_token(id).await, "first-fresh-space");
            }
            assert_eq!(client.recording_token("c").await, "unrelated-course");
            assert_eq!(*client.token.read().await, "first-fresh-space");
            client.reset_video_tokens("explicit-login".into()).await;
            assert!(
                !client
                    .publish_recording_refresh(
                        second_version,
                        &second_token,
                        "late-after-login".into()
                    )
                    .await
            );
            assert_eq!(client.recording_token("b").await, "explicit-login");
        }
    }

    #[tokio::test]
    async fn refresh_invalidates_siblings_but_keeps_other_courses_and_rejects_late_publication() {
        let client = Client::default();
        client.reset_video_tokens("initial-space".into()).await;
        let launch = client.recording_tokens.write().await.begin_launch();
        client
            .recording_tokens
            .write()
            .await
            .remember(launch, ["a", "b"], "expired");
        client
            .recording_tokens
            .write()
            .await
            .remember(launch, ["c"], "unrelated-course");
        let (old, generation) = client.recording_token_snapshot("a").await;
        assert!(
            client
                .publish_recording_refresh(generation, &old, "fresh-space".into())
                .await
        );
        assert_eq!(client.recording_token("a").await, "fresh-space");
        assert_eq!(client.recording_token("b").await, "fresh-space");
        assert_eq!(client.recording_token("c").await, "unrelated-course");
        client
            .recording_tokens
            .write()
            .await
            .remember(launch, ["a"], "late-list");
        assert_eq!(client.recording_token("a").await, "fresh-space");
        client.reset_video_tokens("explicit-login".into()).await;
        assert!(
            !client
                .publish_recording_refresh(generation, &old, "late-refresh".into())
                .await
        );
        assert_eq!(client.recording_token("a").await, "explicit-login");
        assert_eq!(*client.token.read().await, "explicit-login");
    }

    #[tokio::test]
    async fn reset_blocks_late_refresh_even_when_a_binding_reuses_the_same_token() {
        let client = Client::default();
        client.reset_video_tokens("old-space".into()).await;
        let launch = client.recording_tokens.write().await.begin_launch();
        client
            .recording_tokens
            .write()
            .await
            .remember(launch, ["a"], "old-course");
        let (old, snapshot) = client.recording_token_snapshot("a").await;
        client.reset_video_tokens("new-login".into()).await;
        let new_launch = client.recording_tokens.write().await.begin_launch();
        // Deliberately reuse the same opaque value across reset to exercise ABA.
        client
            .recording_tokens
            .write()
            .await
            .remember(new_launch, ["a"], "old-course");
        assert!(
            !client
                .publish_recording_refresh(snapshot, &old, "late-old-space".into())
                .await
        );
        assert_eq!(client.recording_token("a").await, "old-course");
        assert_eq!(client.recording_token("unbound").await, "new-login");
    }
    #[tokio::test]
    async fn refresh_does_not_discard_a_later_course_binding() {
        let client = Client::default();
        client.reset_video_tokens("initial-space".into()).await;
        let first = client.recording_tokens.write().await.begin_launch();
        client
            .recording_tokens
            .write()
            .await
            .remember(first, ["a", "b"], "expired");
        let (old, snapshot) = client.recording_token_snapshot("a").await;
        let newer = client.recording_tokens.write().await.begin_launch();
        client
            .recording_tokens
            .write()
            .await
            .remember(newer, ["a"], "newer-course");
        client
            .publish_recording_refresh(snapshot, &old, "fresh-space".into())
            .await;
        assert_eq!(client.recording_token("a").await, "newer-course");
        assert_eq!(client.recording_token("b").await, "fresh-space");
    }
}
