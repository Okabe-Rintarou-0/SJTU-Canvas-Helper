use super::{
    data::{Category, DataRequest},
    video_library::RecordingRequest,
    App,
};
use crate::{
    client::subtitle_proofread::{self, ProofreadResult},
    error::{AppError, Result},
    model::CanvasVideoSubTitle,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;

const VERSION: u32 = 1;
const PROOFREADS: &str = "video-subtitle-proofreads";
const TRANSCRIPTS: &str = "video-transcripts";
const TOPICS: &str = "video-recording-topics";

fn failure(message: impl Into<String>) -> AppError {
    AppError::LLMError(message.into())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SavedProofread {
    pub source: Vec<CanvasVideoSubTitle>,
    pub refined: Vec<CanvasVideoSubTitle>,
    pub report: ProofreadResult,
}
impl SavedProofread {
    pub fn restore(mut self, source: &[CanvasVideoSubTitle]) -> Result<ProofreadResult> {
        if self.source != source
            || self.report.policy != subtitle_proofread::POLICY
            || self.report.source_hash != subtitle_proofread::source_hash(source)
            || self.refined.len() != source.len()
            || self.report.line_count != source.len()
            || self.refined.iter().zip(source).any(|(a, b)| {
                let mut expected = b.clone();
                expected.res = a.res.clone();
                *a != expected
            })
            || self
                .report
                .join_next
                .iter()
                .any(|id| id.checked_add(1).is_none_or(|next| next >= source.len()))
            || !subtitle_proofread::valid_edge_exclusions(
                source.len(),
                &self.report.exclude_from_summary,
            )
            || self.report.topic.as_deref().is_some_and(|topic| {
                subtitle_proofread::valid_topic(topic).as_deref() != Some(topic)
            })
        {
            return Err(failure(
                "本地精校成果与源字幕不匹配，请在应用数据中检查，原文件已保留",
            ));
        }
        self.report.lines = self.refined;
        self.report.cached = true;
        Ok(self.report)
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedTranscript {
    key: String,
    source: String,
    text: String,
}

fn proofread_key(key: &str, lines: &[CanvasVideoSubTitle]) -> String {
    format!(
        "{}:{key}:{}",
        subtitle_proofread::POLICY,
        subtitle_proofread::source_hash(lines)
    )
}

impl App {
    pub(super) async fn video_data_account(&self) -> Result<String> {
        serde_json::to_value(&*self.current_account.read().await)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .ok_or_else(|| failure("无法读取当前数据账号"))
    }

    async fn read_video_artifact<T: DeserializeOwned>(
        &self,
        account: &str,
        collection: &str,
        key: String,
    ) -> Result<Option<T>> {
        let record = self
            .application_data(
                account.into(),
                DataRequest::Get {
                    category: Category::History,
                    collection: collection.into(),
                    key,
                },
            )
            .await
            .map_err(failure)?;
        if record.is_null() {
            return Ok(None);
        }
        if record["version"] != VERSION {
            return Err(failure(
                "本地AI成果版本不兼容，原文件已保留，请升级应用或检查应用数据",
            ));
        }
        serde_json::from_value(record["value"].clone())
            .map(Some)
            .map_err(|_| failure("本地AI成果数据无效，原文件已保留"))
    }

    async fn write_video_artifact(
        &self,
        account: &str,
        collection: &str,
        key: String,
        value: Value,
    ) -> Result<()> {
        self.application_data(
            account.into(),
            DataRequest::Put {
                category: Category::History,
                collection: collection.into(),
                key,
                version: VERSION,
                value,
                if_absent: false,
            },
        )
        .await
        .map_err(failure)?;
        Ok(())
    }

    pub(super) async fn saved_video_proofread(
        &self,
        account: &str,
        key: &str,
        lines: &[CanvasVideoSubTitle],
    ) -> Result<Option<ProofreadResult>> {
        match self
            .read_video_artifact::<SavedProofread>(account, PROOFREADS, proofread_key(key, lines))
            .await?
        {
            Some(saved) => saved.restore(lines).map(Some),
            None => Ok(None),
        }
    }

    pub(super) async fn save_video_proofread(
        &self,
        account: &str,
        key: &str,
        source: Vec<CanvasVideoSubTitle>,
        report: &ProofreadResult,
    ) -> Result<()> {
        let artifact_key = proofread_key(key, &source);
        let saved = SavedProofread {
            source,
            refined: report.lines.clone(),
            report: report.clone(),
        };
        self.write_video_artifact(
            account,
            PROOFREADS,
            artifact_key,
            serde_json::to_value(saved)?,
        )
        .await?;
        let generate_topics = self.config.read().await.experimental_video_topics;
        if let Some(topic) = report.topic.as_ref().filter(|_| generate_topics) {
            self.write_video_artifact(
                account,
                TOPICS,
                key.into(),
                serde_json::json!({
                    "topic":topic,"sourceHash":report.source_hash,"policy":report.policy
                }),
            )
            .await?;
        }
        Ok(())
    }

    pub(super) async fn remove_video_proofread(
        &self,
        account: &str,
        key: &str,
        source: &[CanvasVideoSubTitle],
    ) -> Result<()> {
        self.application_data(
            account.into(),
            DataRequest::Delete {
                category: Category::History,
                collection: PROOFREADS.into(),
                key: proofread_key(key, source),
            },
        )
        .await
        .map_err(failure)?;
        self.client.clear_video_ai_memory().await;
        Ok(())
    }

    pub(super) async fn saved_video_transcript(
        &self,
        account: &str,
        request: &RecordingRequest,
    ) -> Result<Option<String>> {
        let Some(saved) = self
            .read_video_artifact::<SavedTranscript>(account, TRANSCRIPTS, request.key.clone())
            .await?
        else {
            return Ok(None);
        };
        if saved.key != request.key
            || saved.source != "sjtu-audio-video-v1"
            || saved.text.trim().is_empty()
        {
            return Err(failure("本地转录成果数据无效，原文件已保留"));
        }
        Ok(Some(saved.text))
    }

    pub(super) async fn save_video_transcript(
        &self,
        account: &str,
        request: &RecordingRequest,
        text: String,
    ) -> Result<()> {
        self.write_video_artifact(
            account,
            TRANSCRIPTS,
            request.key.clone(),
            serde_json::to_value(SavedTranscript {
                key: request.key.clone(),
                source: "sjtu-audio-video-v1".into(),
                text,
            })?,
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_a_changed_source_or_modified_timing_in_saved_results() {
        let source = vec![
            CanvasVideoSubTitle {
                bg: 100,
                ed: 200,
                res: "原文".into(),
                ..Default::default()
            };
            3
        ];
        let result: ProofreadResult = serde_json::from_value(serde_json::json!({"model":"test","sourceHash":subtitle_proofread::source_hash(&source),"configHash":"test","policy":subtitle_proofread::POLICY,"joinNext":[],"displayCues":3,"lineCount":3,"changedLines":1,"batches":1,"elapsedMs":10,"promptTokens":10,"completionTokens":5,"cached":false,"mode":"test","batchMetrics":[]})).unwrap();
        let mut refined = source.clone();
        refined[0].res = "修订".into();
        let value = serde_json::to_value(SavedProofread {
            source: source.clone(),
            refined,
            report: result,
        })
        .unwrap();
        let saved: SavedProofread = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(saved.restore(&source).unwrap().lines[0].res, "修订");
        let mut titled = value.clone();
        titled["report"]["topic"] = "语法分析".into();
        assert_eq!(
            serde_json::from_value::<SavedProofread>(titled.clone())
                .unwrap()
                .restore(&source)
                .unwrap()
                .topic
                .as_deref(),
            Some("语法分析")
        );
        titled["report"]["topic"] = "字".repeat(25).into();
        assert!(serde_json::from_value::<SavedProofread>(titled)
            .unwrap()
            .restore(&source)
            .is_err());
        let mut changed = source.clone();
        changed[0].res = "新Canvas字幕".into();
        assert!(serde_json::from_value::<SavedProofread>(value.clone())
            .unwrap()
            .restore(&changed)
            .is_err());
        let mut bad = value.clone();
        bad["refined"][0]["ed"] = 500.into();
        assert!(serde_json::from_value::<SavedProofread>(bad)
            .unwrap()
            .restore(&source)
            .is_err());
        let mut annotated = value.clone();
        annotated["report"]["excludeFromSummary"] =
            serde_json::json!([{"id":0,"reason":"chatter"}]);
        let restored = serde_json::from_value::<SavedProofread>(annotated.clone())
            .unwrap()
            .restore(&source)
            .unwrap();
        assert_eq!(restored.exclude_from_summary.len(), 1);
        assert_eq!(restored.lines[0].res, "修订");
        annotated["report"]["excludeFromSummary"][0]["id"] = 1.into();
        assert!(serde_json::from_value::<SavedProofread>(annotated)
            .unwrap()
            .restore(&source)
            .is_err());
    }

    #[tokio::test]
    #[ignore = "writes temporary audit records using the configured application-data directory"]
    async fn live_video_artifact_storage_roundtrip() {
        let input: Value = serde_json::from_str(
            &std::fs::read_to_string(std::env::var("SJTU_PROOFREAD_TEST_INPUT").unwrap()).unwrap(),
        )
        .unwrap();
        let path = std::env::var("SJTU_PROOFREAD_TEST_OUTPUT").unwrap();
        let source: Vec<CanvasVideoSubTitle> =
            serde_json::from_value(input["lines"].clone()).unwrap();
        let mut report: ProofreadResult =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        report.lines =
            serde_json::from_str(&std::fs::read_to_string(format!("{path}.lines.json")).unwrap())
                .unwrap();
        let request = RecordingRequest {
            key: format!("audit:{}", uuid::Uuid::new_v4()),
            title: "持久化回归测试".into(),
            candidates: vec![],
        };
        let first = App::new();
        let account = first.video_data_account().await.unwrap();
        first
            .save_video_proofread(&account, &request.key, source.clone(), &report)
            .await
            .unwrap();
        first
            .save_video_transcript(&account, &request, "UTF-8 中文转录原文，没有时间戳".into())
            .await
            .unwrap();
        drop(first);
        let reopened = App::new();
        let loaded = reopened
            .saved_video_proofread(&account, &request.key, &source)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(loaded.lines, report.lines);
        assert_eq!(loaded.config_hash, report.config_hash);
        assert_eq!(
            serde_json::to_value(&loaded.exclude_from_summary).unwrap(),
            serde_json::to_value(&report.exclude_from_summary).unwrap()
        );
        assert_eq!(
            subtitle_proofread::summary_subtitles(&loaded.lines, &loaded.exclude_from_summary)
                .len(),
            loaded.lines.len() - loaded.exclude_from_summary.len()
        );
        assert!(loaded.cached);
        assert_eq!(
            reopened
                .saved_video_transcript(&account, &request)
                .await
                .unwrap()
                .unwrap(),
            "UTF-8 中文转录原文，没有时间戳"
        );
        reopened
            .remove_video_proofread(&account, &request.key, &source)
            .await
            .unwrap();
        reopened
            .application_data(
                account.clone(),
                DataRequest::Delete {
                    category: Category::History,
                    collection: TRANSCRIPTS.into(),
                    key: request.key.clone(),
                },
            )
            .await
            .unwrap();
        assert!(reopened
            .saved_video_proofread(&account, &request.key, &source)
            .await
            .unwrap()
            .is_none());
        assert!(reopened
            .saved_video_transcript(&account, &request)
            .await
            .unwrap()
            .is_none());
        println!("Persisted transcript and source/refined subtitles survived a new App instance; temporary audit records deleted.");
    }
}
