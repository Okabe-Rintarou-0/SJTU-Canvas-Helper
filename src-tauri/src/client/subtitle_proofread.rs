use super::{Client, LlmSnapshot};
use crate::{
    error::{AppError, Result},
    model::{
        builtin_subtitle_analysis_prompt, builtin_subtitle_proofread_prompt, CanvasVideoSubTitle,
        VideoProofreadOptions,
    },
};
use md5::{Digest, Md5};
use rig::{
    client::CompletionClient,
    completion::{AssistantContent, Completion},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

pub const POLICY: &str = "subtitle-proofread-v7";
pub const TOPIC_MAX_CHARS: usize = 24;
const SYSTEM_PROTOCOL: &str = r#"只输出JSON对象：{"complete":true,"edits":[{"id":整数,"text":"修改后的本句全文"}],"joinNext":[整数]}。
检查完本批全部待校对句子后complete才为true；edits仅列实际改动句子，joinNext仅列本批内相邻边界；没有则用空数组。禁止返回只读上下文id、时间戳、解释或其他字段。"#;

const TOPIC_INSTRUCTION: &str = r#"主题（已启用）
- topic概括本小节具体授课内容，纯文本、不超过24个字符，如“CNN：输出尺寸、池化”“LR：分析、项目集构造”；证据不足为null。
- 并列重点用“、：；”等标点，避免“与、及、和、and”串联；优先惯用英文缩写，不创造缩写。
- 不重复课程名、日期、教师或讲次，不输出Markdown、公式或解释。"#;

const PLAN_PROTOCOL: &str = r#"只输出JSON：{"topic":null,"terms":["术语"],"leadingChatterEndId":null,"trailingChatterStartId":null}。"#;

#[derive(Default)]
struct CacheState {
    generation: u64,
    results: HashMap<String, ProofreadResult>,
}

#[derive(Default)]
pub(super) struct ProofreadRuntime {
    state: Mutex<CacheState>,
    work: Mutex<()>,
}

impl ProofreadRuntime {
    pub(super) async fn clear(&self) {
        let mut state = self.state.lock().await;
        state.generation += 1;
        state.results.clear();
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofreadResult {
    #[serde(skip)]
    pub lines: Vec<CanvasVideoSubTitle>,
    pub model: String,
    pub source_hash: String,
    pub config_hash: String,
    pub policy: String,
    pub join_next: Vec<usize>,
    pub display_cues: usize,
    #[serde(default)]
    pub exclude_from_summary: Vec<SummaryExclusion>,
    #[serde(default)]
    pub glossary: Vec<String>,
    #[serde(default)]
    pub topic: Option<String>,
    pub line_count: usize,
    pub changed_lines: usize,
    pub batches: usize,
    pub elapsed_ms: u64,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cached: bool,
    pub mode: String,
    pub batch_metrics: Vec<BatchMetric>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryExclusion {
    pub id: usize,
    pub reason: ExclusionReason,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExclusionReason {
    Chatter,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchMetric {
    pub lines: usize,
    pub elapsed_ms: u64,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Edits {
    complete: bool,
    edits: Vec<Edit>,
    #[serde(default)]
    join_next: Vec<usize>,
}
#[derive(Deserialize)]
struct Edit {
    id: usize,
    text: String,
}

fn error(text: impl Into<String>) -> AppError {
    AppError::LLMError(text.into())
}
fn correction_system() -> String {
    format!(
        "{}\n{}",
        builtin_subtitle_proofread_prompt(),
        SYSTEM_PROTOCOL
    )
}
fn analysis_system(options: &VideoProofreadOptions) -> String {
    format!(
        "{}\n{}\n{}",
        builtin_subtitle_analysis_prompt(),
        if options.generate_topics {
            TOPIC_INSTRUCTION
        } else {
            "本次不生成课程主题，topic必须为null。"
        },
        PLAN_PROTOCOL
    )
}
pub fn config_hash(snapshot: &LlmSnapshot, options: &VideoProofreadOptions) -> String {
    format!(
        "{:x}",
        Md5::digest(
            serde_json::json!([
                POLICY,
                correction_system(),
                analysis_system(options),
                snapshot.base_url,
                snapshot.model,
                0.0
            ])
            .to_string()
        )
    )
}
pub fn source_hash(lines: &[CanvasVideoSubTitle]) -> String {
    format!(
        "{:x}",
        Md5::digest(serde_json::to_vec(lines).unwrap_or_default())
    )
}

// Small batches bound output and failure cost. IDs stay global; neighboring rows
// are read-only. No model-generated timing or resegmentation is ever accepted.
fn batches(lines: &[CanvasVideoSubTitle]) -> Vec<std::ops::Range<usize>> {
    let mut result = Vec::new();
    let mut start = 0;
    while start < lines.len() {
        let mut end = start;
        let mut chars = 0;
        while end < lines.len() && end - start < 120 {
            let next = lines[end].res.chars().count();
            if end > start && chars + next > 2400 {
                break;
            }
            chars += next;
            end += 1;
        }
        result.push(start..end);
        start = end;
    }
    result
}

fn prompt(
    title: &str,
    lines: &[CanvasVideoSubTitle],
    range: &std::ops::Range<usize>,
    glossary: &[String],
) -> String {
    let rows = |range: std::ops::Range<usize>| {
        range
            .map(|id| serde_json::json!({"id":id,"text":lines[id].res}))
            .collect::<Vec<_>>()
    };
    serde_json::json!({
        "title": title.chars().take(200).collect::<String>(),
        "terminologyCandidates": glossary,
        "contextBefore": lines[range.start.saturating_sub(3)..range.start].iter().map(|line|&line.res).collect::<Vec<_>>(),
        "rows": rows(range.clone()),
        "contextAfter": lines[range.end..(range.end+3).min(lines.len())].iter().map(|line|&line.res).collect::<Vec<_>>()
    })
    .to_string()
}

fn apply_edits(
    text: &str,
    lines: &mut [CanvasVideoSubTitle],
    range: &std::ops::Range<usize>,
) -> Result<Vec<usize>> {
    let response: Edits =
        serde_json::from_str(text).map_err(|_| error("精校返回的 JSON 无效，保留原字幕"))?;
    if !response.complete {
        return Err(error("模型未完成本批精校，保留原字幕"));
    }
    let mut seen = HashSet::new();
    let markup = regex::Regex::new(r"(?m)\*\*|__|`|\$[^$\n]+\$|\\[A-Za-z]+|\\[\[\]()]|</?[A-Za-z][^>]*>|\[[^\]]+\]\([^)]+\)|^#{1,6}\s").unwrap();
    let mut boundaries = HashSet::new();
    for id in &response.join_next {
        if !range.contains(id) || *id >= range.end.saturating_sub(1) || !boundaries.insert(*id) {
            return Err(error("精校返回无效的合并边界，保留原字幕"));
        }
    }
    // Validate the entire batch before touching any row.
    for edit in &response.edits {
        if !range.contains(&edit.id) || !seen.insert(edit.id) {
            return Err(error("精校返回重复或越界句子编号，保留原字幕"));
        }
        let count = edit.text.chars().count();
        if edit.text.contains(['\n', '\r'])
            || count > (lines[edit.id].res.chars().count() * 4).max(80)
        {
            return Err(error("精校返回异常字幕文字，保留原字幕"));
        }
        if markup.is_match(&edit.text) && !markup.is_match(&lines[edit.id].res) {
            return Err(error("精校新增了不支持的富文本或数学标记，保留原字幕"));
        }
    }
    for edit in response.edits {
        lines[edit.id].res = edit.text.trim().into();
    }
    Ok(response.join_next)
}

fn edge_exclusions(
    total: usize,
    leading_end: Option<usize>,
    trailing_start: Option<usize>,
) -> Result<Vec<SummaryExclusion>> {
    let start = match leading_end {
        Some(id) if id < total => id + 1,
        Some(_) => return Err(error("片头闲聊边界越界")),
        None => 0,
    };
    let end = trailing_start.unwrap_or(total);
    if trailing_start.is_some_and(|id| id >= total) || start >= end {
        return Err(error("闲聊边界无效或覆盖了全部授课"));
    }
    Ok((0..start)
        .chain(end..total)
        .map(|id| SummaryExclusion {
            id,
            reason: ExclusionReason::Chatter,
        })
        .collect())
}

pub fn valid_edge_exclusions(total: usize, excluded: &[SummaryExclusion]) -> bool {
    if excluded.is_empty() {
        return true;
    }
    let ids: HashSet<_> = excluded.iter().map(|item| item.id).collect();
    if ids.len() != excluded.len() || ids.len() >= total || ids.iter().any(|id| *id >= total) {
        return false;
    }
    let start = (0..total).find(|id| !ids.contains(id)).unwrap();
    let end = (0..total).rfind(|id| !ids.contains(id)).unwrap();
    !(start..=end).any(|id| ids.contains(&id))
}

// Filter by original IDs before any display merging or splitting; stored rows stay intact.
pub fn summary_subtitles(
    lines: &[CanvasVideoSubTitle],
    excluded: &[SummaryExclusion],
) -> Vec<CanvasVideoSubTitle> {
    if !valid_edge_exclusions(lines.len(), excluded) {
        return lines
            .iter()
            .filter(|line| !line.res.trim().is_empty())
            .cloned()
            .collect();
    }
    let ids: HashSet<_> = excluded.iter().map(|item| item.id).collect();
    lines
        .iter()
        .enumerate()
        .filter(|(id, line)| !ids.contains(id) && !line.res.trim().is_empty())
        .map(|(_, line)| line.clone())
        .collect()
}

fn display_units(text: &str) -> usize {
    text.chars().map(|c| if c.is_ascii() { 1 } else { 2 }).sum()
}

pub fn display_subtitles(
    lines: &[CanvasVideoSubTitle],
    join_next: &[usize],
) -> Vec<CanvasVideoSubTitle> {
    let boundaries: HashSet<_> = join_next.iter().copied().collect();
    let mut output = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let mut cue = lines[index].clone();
        if cue.res.trim().is_empty() {
            index += 1;
            continue;
        }
        let mut end = index;
        while end + 1 < lines.len() && end - index < 2 {
            let next = &lines[end + 1];
            let last = &lines[end];
            let a = cue.res.trim_end();
            let b = next.res.trim_start();
            if b.is_empty() {
                break;
            }
            let unfinished_short = last.ed.saturating_sub(last.bg) <= 2500
                && last.res.trim_end().ends_with(['，', ',', '、']);
            if !boundaries.contains(&end) && !unfinished_short {
                break;
            }
            if ["不对", "不是", "更正", "刚才"]
                .iter()
                .any(|prefix| b.starts_with(prefix))
            {
                break;
            }
            let separator = if a.chars().last().is_some_and(|c| c.is_ascii_alphanumeric())
                && b.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
            {
                " "
            } else {
                ""
            };
            let combined = format!("{a}{separator}{b}");
            if last.res.trim_end().ends_with(['。', '！', '？', '!', '?'])
                || next.bg < last.ed
                || next.bg - last.ed > 350
                || next.ed < cue.bg
                || next.ed - cue.bg > 7000
                || display_units(&combined) > 72
            {
                break;
            }
            cue.res = combined;
            cue.ed = next.ed;
            end += 1;
        }
        output.extend(split_display_cue(cue));
        index = end + 1;
    }
    output
}

// Long source cues have no word-level timestamps. Divide only inside their
// original interval, weighted by displayed text; never move source timing.
fn split_display_cue(cue: CanvasVideoSubTitle) -> Vec<CanvasVideoSubTitle> {
    const MAX_UNITS: usize = 72;
    if display_units(&cue.res) <= MAX_UNITS {
        return vec![cue];
    }
    let chars: Vec<_> = cue.res.chars().collect();
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < chars.len() {
        let mut units = 0;
        let mut end = start;
        let mut boundary = None;
        while end < chars.len() {
            let next = if chars[end].is_ascii() { 1 } else { 2 };
            if units + next > MAX_UNITS {
                break;
            }
            units += next;
            end += 1;
            if units >= MAX_UNITS / 2
                && (chars[end - 1].is_whitespace() || "，。！？；：,.!?;:".contains(chars[end - 1]))
            {
                boundary = Some(end);
            }
        }
        if end < chars.len() {
            end = boundary.unwrap_or(end);
        }
        chunks.push(chars[start..end].iter().collect::<String>());
        start = end;
    }
    let duration = cue.ed.saturating_sub(cue.bg);
    // A corrupted, millisecond-long source cannot support multiple valid cues.
    if duration < chunks.len() as u64 {
        return vec![cue];
    }
    let total: usize = chunks.iter().map(|text| display_units(text)).sum();
    let mut consumed = 0;
    let count = chunks.len();
    chunks
        .into_iter()
        .enumerate()
        .map(|(index, text)| {
            let bg = cue.bg
                + index as u64
                + (u128::from(duration - count as u64) * consumed as u128 / total as u128) as u64;
            consumed += display_units(&text);
            let ed = if index + 1 == count {
                cue.ed
            } else {
                cue.bg
                    + index as u64
                    + 1
                    + (u128::from(duration - count as u64) * consumed as u128 / total as u128)
                        as u64
            };
            CanvasVideoSubTitle {
                bg,
                ed,
                res: text.trim().into(),
                ..cue.clone()
            }
        })
        .collect()
}

pub fn playback_subtitles(
    report: &ProofreadResult,
    show_chatter: bool,
) -> Vec<CanvasVideoSubTitle> {
    let mut lines = report.lines.clone();
    if !show_chatter && valid_edge_exclusions(lines.len(), &report.exclude_from_summary) {
        for item in &report.exclude_from_summary {
            lines[item.id].res.clear();
        }
    }
    display_subtitles(&lines, &report.join_next)
}

// Show the whole typical lecture, or contiguous head/tail windows for very long
// transcripts. Keep global IDs so the model identifies recording-level edges.
fn plan_rows(source: &[CanvasVideoSubTitle]) -> Vec<usize> {
    if source
        .iter()
        .map(|line| line.res.chars().count())
        .sum::<usize>()
        <= 16000
    {
        return (0..source.len()).collect();
    }
    let mut ids = Vec::new();
    for direction in [false, true] {
        let mut chars = 0;
        for step in 0..source.len() {
            let id = if direction {
                source.len() - 1 - step
            } else {
                step
            };
            let next = source[id].res.chars().count();
            if chars + next > 8000 && chars > 0 {
                break;
            }
            chars += next;
            ids.push(id);
        }
    }
    ids.sort_unstable();
    ids.dedup();
    ids
}

async fn lecture_plan(
    snapshot: &LlmSnapshot,
    title: &str,
    source: &[CanvasVideoSubTitle],
    non_thinking: bool,
    options: &VideoProofreadOptions,
) -> Result<(
    Vec<String>,
    Vec<SummaryExclusion>,
    Option<String>,
    BatchMetric,
)> {
    let started = Instant::now();
    let shown = plan_rows(source);
    let rows: Vec<_> = shown
        .iter()
        .map(|id| serde_json::json!({"id":id,"text":source[*id].res}))
        .collect();
    let topic_context: Vec<_> = (0..24.min(source.len()))
        .map(|step| {
            let id = step * source.len() / 24.min(source.len());
            serde_json::json!({"id":id,"text":source[id].res.chars().take(160).collect::<String>()})
        })
        .collect();
    let input = serde_json::json!({"title":title.chars().take(200).collect::<String>(),"totalRows":source.len(),"rows":rows,"topicContext":topic_context}).to_string();
    let mut builder = snapshot
        .client
        .agent(&snapshot.model)
        .preamble(&analysis_system(options))
        .temperature(0.0)
        .max_tokens(1500);
    if non_thinking {
        builder = builder.additional_params(serde_json::json!({"thinking":{"type":"disabled"},"response_format":{"type":"json_object"}}));
    }
    let agent = builder.build();
    let completion = async {
        let request = agent
            .completion(&input, Vec::<rig::completion::Message>::new())
            .await
            .map_err(|_| error("术语整理请求失败"))?;
        request.send().await.map_err(|_| error("术语整理失败"))
    };
    let response = tokio::time::timeout(Duration::from_secs(45), completion)
        .await
        .map_err(|_| error("术语整理超时"))??;
    if response
        .raw_response
        .choices
        .first()
        .is_none_or(|choice| choice.finish_reason != "stop")
    {
        return Err(error("术语整理未完成"));
    }
    let text = response
        .choice
        .iter()
        .filter_map(|part| match part {
            AssistantContent::Text(text) => Some(text.text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("");
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Plan {
        terms: Vec<String>,
        #[serde(default)]
        topic: Option<String>,
        leading_chatter_end_id: Option<usize>,
        trailing_chatter_start_id: Option<usize>,
    }
    let plan: Plan = serde_json::from_str(&text).map_err(|_| error("全课分析无效"))?;
    let shown: HashSet<_> = shown.into_iter().collect();
    if plan
        .leading_chatter_end_id
        .is_some_and(|id| id >= source.len() || !(0..=id + 1).all(|i| shown.contains(&i)))
        || plan.trailing_chatter_start_id.is_some_and(|id| {
            id == 0 || id >= source.len() || !(id - 1..source.len()).all(|i| shown.contains(&i))
        })
    {
        return Err(error("闲聊边界缺少连续上下文证据"));
    }
    let excluded = edge_exclusions(
        source.len(),
        plan.leading_chatter_end_id,
        plan.trailing_chatter_start_id,
    )?;
    let terms = plan
        .terms
        .into_iter()
        .filter(|term| {
            !term.trim().is_empty()
                && term.chars().count() <= 60
                && !term.contains(['\n', '\r', '`', '\\', '$', '<', '>'])
        })
        .take(32)
        .collect();
    let usage = response.raw_response.usage.as_ref();
    Ok((
        terms,
        excluded,
        plan.topic.as_deref().and_then(valid_topic),
        BatchMetric {
            lines: 0,
            elapsed_ms: started.elapsed().as_millis() as u64,
            prompt_tokens: usage.map(|u| u.prompt_tokens as u64).unwrap_or(0),
            completion_tokens: usage
                .map(|u| u.total_tokens.saturating_sub(u.prompt_tokens) as u64)
                .unwrap_or(0),
        },
    ))
}

pub fn valid_topic(topic: &str) -> Option<String> {
    let topic = topic.trim();
    (!topic.is_empty()
        && topic.chars().count() <= TOPIC_MAX_CHARS
        && !topic.chars().any(char::is_control)
        && !topic.contains(['`', '#', '*', '\\', '$', '<', '>']))
    .then(|| topic.to_owned())
}

async fn run(
    snapshot: &LlmSnapshot,
    title: &str,
    source: &[CanvasVideoSubTitle],
    on_status: &(dyn Fn(String) + Send + Sync),
    options: &VideoProofreadOptions,
) -> Result<ProofreadResult> {
    if source.is_empty()
        || source.len() > 10_000
        || source.iter().any(|line| {
            line.ed <= line.bg || line.res.trim().is_empty() || line.res.chars().count() > 4000
        })
        || source.iter().map(|line| line.res.len()).sum::<usize>() > 600_000
    {
        return Err(error("精校需要有效的带时间戳字幕，或本次字幕过长"));
    }
    let started = Instant::now();
    let ranges = batches(source);
    let mut lines = source.to_vec();
    let mut metrics = Vec::new();
    let mut join_next = Vec::new();
    let mut exclude_from_summary = Vec::new();
    // DeepSeek Flash enables thinking by default. Proofreading uses its explicit
    // non-thinking mode so reasoning cannot exhaust the entire output allowance.
    // Do not send vendor parameters to arbitrary OpenAI-compatible providers.
    let non_thinking = reqwest::Url::parse(&snapshot.base_url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .as_deref()
        == Some("api.deepseek.com")
        && snapshot.model == "deepseek-flash";
    let mut glossary = Vec::new();
    let mut topic = None;
    {
        on_status("正在分析字幕".into());
        match lecture_plan(snapshot, title, source, non_thinking, options).await {
            Ok((terms, excluded, planned_topic, metric)) => {
                glossary = terms;
                topic = if options.generate_topics {
                    planned_topic
                } else {
                    None
                };
                exclude_from_summary = excluded;
                metrics.push(metric);
            }
            Err(_) => on_status("全课分析不可用，保留全部总结输入并继续精校字幕".into()),
        }
    }
    for (index, range) in ranges.iter().enumerate() {
        on_status(format!(
            "正在精校字幕 · {}/{} 批 · 已用 {} 秒",
            index + 1,
            ranges.len(),
            started.elapsed().as_secs()
        ));
        let batch_started = Instant::now();
        let mut builder = snapshot
            .client
            .agent(&snapshot.model)
            .preamble(&correction_system())
            .max_tokens(8192)
            .temperature(0.0);
        if non_thinking {
            builder = builder.additional_params(serde_json::json!({"thinking":{"type":"disabled"},"response_format":{"type":"json_object"}}));
        }
        let agent = builder.build();
        let input = prompt(title, source, range, &glossary);
        let completion = async {
            let request = agent
                .completion(&input, Vec::<rig::completion::Message>::new())
                .await
                .map_err(|_| error("精校模型请求失败，请检查模型配置"))?;
            request
                .send()
                .await
                .map_err(|_| error("精校模型调用失败，原字幕未替换"))
        };
        let response = tokio::time::timeout(Duration::from_secs(480), completion)
            .await
            .map_err(|_| error("本批精校超时，原字幕未替换"))??;
        let finish = response
            .raw_response
            .choices
            .first()
            .map(|choice| choice.finish_reason.as_str())
            .unwrap_or("unknown");
        if finish != "stop" {
            return Err(error(format!(
                "精校输出未正常结束（{finish}），原字幕未替换"
            )));
        }
        let text = response
            .choice
            .iter()
            .filter_map(|part| match part {
                AssistantContent::Text(text) => Some(text.text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("");
        let edits = apply_edits(&text, &mut lines, range);
        #[cfg(test)]
        if edits.is_err() {
            if let Ok(path) = std::env::var("SJTU_PROOFREAD_TEST_OUTPUT") {
                let _ = std::fs::write(format!("{path}.invalid-response.json"), &text);
            }
        }
        let joins = edits?;
        join_next.extend(joins);
        let usage = response.raw_response.usage.as_ref();
        metrics.push(BatchMetric {
            lines: range.len(),
            elapsed_ms: batch_started.elapsed().as_millis() as u64,
            prompt_tokens: usage.map(|u| u.prompt_tokens as u64).unwrap_or(0),
            completion_tokens: usage
                .map(|u| u.total_tokens.saturating_sub(u.prompt_tokens) as u64)
                .unwrap_or(0),
        });
    }
    if lines.iter().all(|line| line.res.trim().is_empty()) {
        return Err(error("精校移除了全部字幕，保留原字幕"));
    }
    let display_cues = display_subtitles(&lines, &join_next).len();
    Ok(ProofreadResult {
        changed_lines: lines
            .iter()
            .zip(source)
            .filter(|(a, b)| a.res != b.res)
            .count(),
        lines,
        model: snapshot.model.clone(),
        source_hash: source_hash(source),
        config_hash: config_hash(snapshot, options),
        policy: POLICY.into(),
        join_next,
        display_cues,
        exclude_from_summary,
        glossary,
        topic,
        line_count: source.len(),
        batches: ranges.len(),
        elapsed_ms: started.elapsed().as_millis() as u64,
        prompt_tokens: metrics.iter().map(|m| m.prompt_tokens).sum(),
        completion_tokens: metrics.iter().map(|m| m.completion_tokens).sum(),
        cached: false,
        mode: if non_thinking {
            "non-thinking"
        } else {
            "provider-default"
        }
        .into(),
        batch_metrics: metrics,
    })
}

impl Client {
    pub async fn subtitle_proofread_generation(&self) -> u64 {
        self.subtitle_proofread.state.lock().await.generation
    }
    pub async fn cached_proofread_subtitles(
        &self,
        source: &[CanvasVideoSubTitle],
    ) -> Option<ProofreadResult> {
        self.subtitle_proofread
            .state
            .lock()
            .await
            .results
            .get(&source_hash(source))
            .cloned()
    }

    pub async fn proofread_subtitles(
        &self,
        title: &str,
        source: &[CanvasVideoSubTitle],
        on_status: &(dyn Fn(String) + Send + Sync),
        generation: u64,
        options: &VideoProofreadOptions,
    ) -> Result<ProofreadResult> {
        let _work = self.subtitle_proofread.work.lock().await;
        let key = source_hash(source);
        let snapshot = self.llm_snapshot().await?;
        {
            let state = self.subtitle_proofread.state.lock().await;
            if state.generation != generation {
                return Err(error("账号已切换，请重新发起精校"));
            }
            if let Some(result) = state
                .results
                .get(&key)
                .filter(|r| r.config_hash == config_hash(&snapshot, options) && r.policy == POLICY)
            {
                let mut result = result.clone();
                result.cached = true;
                return Ok(result);
            }
        }
        let result = run(&snapshot, title, source, on_status, options).await?;
        let mut state = self.subtitle_proofread.state.lock().await;
        if state.generation != generation {
            return Err(error("账号已切换，已丢弃本次精校结果"));
        }
        if state.results.len() >= 12 {
            state.results.clear();
        }
        state.results.insert(key, result.clone());
        Ok(result)
    }

    pub async fn clear_video_ai_memory(&self) {
        self.subtitle_proofread.clear().await;
        self.transcription.clear_completed().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn line(text: &str) -> CanvasVideoSubTitle {
        CanvasVideoSubTitle {
            bg: 100,
            ed: 200,
            res: text.into(),
            ..Default::default()
        }
    }

    #[test]
    fn validates_edits_and_keeps_all_timing_and_metadata() {
        let original = vec![line("一路规约"), line("没有错误")];
        let mut lines = original.clone();
        apply_edits(
            r#"{"complete":true,"edits":[{"id":0,"text":"移入规约"}]}"#,
            &mut lines,
            &(0..2),
        )
        .unwrap();
        let mut expected = original.clone();
        expected[0].res = "移入规约".into();
        assert_eq!(lines, expected);
        for invalid in [
            r#"{"complete":false,"edits":[]}"#,
            r#"{"complete":true,"edits":[{"id":0,"text":"甲"},{"id":0,"text":"乙"}]}"#,
            r#"{"complete":true,"edits":[{"id":2,"text":"越界"}]}"#,
        ] {
            let mut unchanged = original.clone();
            assert!(apply_edits(invalid, &mut unchanged, &(0..2)).is_err());
            assert_eq!(unchanged, original);
        }
    }

    #[test]
    fn covers_each_row_once_and_keeps_neighboring_context_read_only() {
        let lines = vec![line(&"字".repeat(35)); 400];
        let chunks = batches(&lines);
        assert_eq!(
            chunks.iter().flat_map(Clone::clone).collect::<Vec<_>>(),
            (0..400).collect::<Vec<_>>()
        );
        let data: serde_json::Value =
            serde_json::from_str(&prompt("课程", &lines, &chunks[1], &[])).unwrap();
        assert_eq!(data["rows"][0]["id"], chunks[1].start);
        assert_eq!(data["contextBefore"].as_array().unwrap().len(), 3);
        assert!(data["rows"][0].get("bg").is_none());
    }

    #[test]
    fn removes_filler_rows_without_retiming_and_splits_long_display_cues() {
        let mut lines = vec![line("嗯，呃"), line("讲解内容，".repeat(30).as_str())];
        lines[1].ed = 10000;
        let source = lines.clone();
        apply_edits(
            r#"{"complete":true,"edits":[{"id":0,"text":""}]}"#,
            &mut lines,
            &(0..2),
        )
        .unwrap();
        assert_eq!((lines[0].bg, lines[0].ed), (source[0].bg, source[0].ed));
        let display = display_subtitles(&lines, &[]);
        assert!(display.len() > 1);
        assert!(display
            .iter()
            .all(|cue| display_units(&cue.res) <= 72 && cue.bg < cue.ed));
        assert_eq!(display.first().unwrap().bg, source[1].bg);
        assert_eq!(display.last().unwrap().ed, source[1].ed);
        assert!(display.windows(2).all(|pair| pair[0].ed == pair[1].bg));
        assert_eq!(
            display
                .iter()
                .map(|cue| cue.res.as_str())
                .collect::<String>(),
            source[1].res
        );
        assert_eq!(summary_subtitles(&lines, &[]).len(), 1);
    }

    #[test]
    fn playback_hides_only_marked_edges_and_can_show_the_full_version() {
        let lines = vec![line("片头"), line("授课内容"), line("片尾")];
        let mut report: ProofreadResult = serde_json::from_value(serde_json::json!({
            "model":"test","sourceHash":source_hash(&lines),"configHash":"test","policy":POLICY,
            "joinNext":[],"excludeFromSummary":[{"id":0,"reason":"chatter"},{"id":2,"reason":"chatter"}],
            "displayCues":3,"lineCount":3,"changedLines":0,"batches":1,"elapsedMs":1,"promptTokens":1,
            "completionTokens":1,"cached":false,"mode":"test","batchMetrics":[]
        })).unwrap();
        report.lines = lines.clone();
        assert_eq!(playback_subtitles(&report, false), vec![lines[1].clone()]);
        assert_eq!(playback_subtitles(&report, true), lines);
        assert_eq!(report.lines.len(), 3);
    }

    #[test]
    fn merges_only_requested_short_adjacent_fragments_without_changing_source() {
        let mut a = line("这是一个，");
        a.bg = 1000;
        a.ed = 2100;
        let mut b = line("偏序集。");
        b.bg = 2200;
        b.ed = 3200;
        let mut c = line("下一句话");
        c.bg = 3200;
        c.ed = 4000;
        let lines = vec![a, b, c];
        let result = display_subtitles(&lines, &[0, 1]);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].res, "这是一个，偏序集。");
        assert_eq!((result[0].bg, result[0].ed), (1000, 3200));
        assert_eq!(lines[0].ed, 2100);
        let mut far = lines.clone();
        far[1].bg = 2700;
        assert_eq!(display_subtitles(&far, &[0]).len(), 3);
        let mut long = lines.clone();
        long[1].res = "很长的文字".repeat(30);
        assert!(display_subtitles(&long, &[0]).len() > 3);
    }

    #[test]
    fn rejects_new_markdown_and_latex_but_allows_literal_source_code() {
        for text in ["**偏序集**", r"$f(x)$", r"\frac{a}{b}", "<b>术语</b>"] {
            let mut lines = vec![line("原文")];
            let response =
                serde_json::json!({"complete":true,"edits":[{"id":0,"text":text}],"joinNext":[]});
            assert!(apply_edits(&response.to_string(), &mut lines, &(0..1)).is_err());
        }
        let mut code = vec![line("vector<int> 小于 x")];
        assert!(apply_edits(
            r#"{"complete":true,"edits":[{"id":0,"text":"vector<int> 小于 x。"}],"joinNext":[]}"#,
            &mut code,
            &(0..1)
        )
        .is_ok());
    }

    #[test]
    fn ignores_extra_metadata_and_never_accepts_model_generated_timing() {
        let mut lines = vec![line("原文")];
        assert!(apply_edits(
            r#"{"type":"json_object","complete":true,"edits":[],"joinNext":[]}"#,
            &mut lines,
            &(0..1)
        )
        .is_ok());
        apply_edits(
            r#"{"complete":true,"edits":[{"id":0,"text":"修订","bg":999,"ed":888,"joinNext":[]}]}"#,
            &mut lines,
            &(0..1),
        )
        .unwrap();
        assert_eq!((lines[0].bg, lines[0].ed), (100, 200));
        let client = Client::default();
        let gap = vec![
            CanvasVideoSubTitle {
                bg: 1000,
                ed: 2000,
                res: "甲".into(),
                ..Default::default()
            },
            CanvasVideoSubTitle {
                bg: 5000,
                ed: 6000,
                res: "乙".into(),
                ..Default::default()
            },
        ];
        assert!(client
            .convert_to_srt(&gap)
            .unwrap()
            .contains("00:00:01,000 --> 00:00:02,000"));
    }

    #[test]
    fn excludes_only_contiguous_recording_edges_and_keeps_interior_asides() {
        let lines: Vec<_> = [
            "片头闲聊",
            "古怪转录",
            "课程介绍",
            "请关门并高亮这一段",
            "作业与考试安排",
            "片尾闲聊",
            "古怪转录",
        ]
        .into_iter()
        .map(line)
        .collect();
        let excluded = edge_exclusions(lines.len(), Some(1), Some(5)).unwrap();
        assert_eq!(
            excluded.iter().map(|x| x.id).collect::<Vec<_>>(),
            vec![0, 1, 5, 6]
        );
        let summary = summary_subtitles(&lines, &excluded);
        assert_eq!(summary, lines[2..5]);
        assert_eq!(display_subtitles(&lines, &[]).len(), lines.len());
        assert!(edge_exclusions(7, Some(6), None).is_err());
        assert!(edge_exclusions(7, Some(4), Some(4)).is_err());
        assert!(edge_exclusions(7, None, Some(7)).is_err());
        assert!(edge_exclusions(7, None, None).unwrap().is_empty());
        for ids in [
            vec![3],
            vec![0, 3, 6],
            vec![0, 0],
            vec![7],
            (0..7).collect(),
        ] {
            let invalid: Vec<_> = ids
                .into_iter()
                .map(|id| SummaryExclusion {
                    id,
                    reason: ExclusionReason::Chatter,
                })
                .collect();
            assert!(!valid_edge_exclusions(7, &invalid));
            assert_eq!(summary_subtitles(&lines, &invalid), lines);
        }
        // Batch outputs cannot exclude isolated lines, even if the model emits
        // the obsolete field. Only the independent recording-level plan can.
        let mut corrected = lines.clone();
        apply_edits(
            r#"{"complete":true,"edits":[],"excludeFromSummary":[{"id":3,"reason":"chatter"}]}"#,
            &mut corrected,
            &(0..7),
        )
        .unwrap();
        assert_eq!(corrected, lines);
    }

    #[test]
    fn long_lecture_planning_keeps_both_edges_with_original_ids() {
        let source = vec![line(&"字".repeat(40)); 1000];
        let ids = plan_rows(&source);
        assert_eq!(ids.first(), Some(&0));
        assert_eq!(ids.last(), Some(&999));
        assert!(!ids.contains(&500));
        assert!(ids.contains(&199) && ids.contains(&800));
        assert_eq!(plan_rows(&source[..10]), (0..10).collect::<Vec<_>>());
    }

    #[test]
    fn topic_is_short_plain_text_and_counts_unicode_characters() {
        assert_eq!(valid_topic(" 线程同步 ").as_deref(), Some("线程同步"));
        assert!(valid_topic(&"𠮷".repeat(24)).is_some());
        for value in ["", "   ", "**主题**", "$x$", "主题\n正文", "<主题>"] {
            assert!(valid_topic(value).is_none());
        }
        assert!(valid_topic(&"字".repeat(25)).is_none());
    }

    #[tokio::test]
    async fn caches_only_complete_results_and_clears_them_on_account_change() {
        use httpmock::{Method::POST, MockServer};
        let server = MockServer::start();
        let request = server.mock(|when,then| {
            when.method(POST).path("/chat/completions").body_contains("terminologyCandidates");
            then.status(200).json_body(serde_json::json!({"id":"test","object":"chat.completion","created":1,"model":"test",
                "choices":[{"index":0,"message":{"role":"assistant","content":r#"{"complete":true,"edits":[{"id":1,"text":"移入规约"}]}"#},"finish_reason":"stop"}],
                "usage":{"prompt_tokens":100,"completion_tokens":30,"total_tokens":130}}));
        });
        let client = Client::new_without_proxy(
            "https://oc.sjtu.edu.cn",
            "test-key",
            &server.base_url(),
            "test",
            None,
        );
        let plan_request = server.mock(|when,then| {
            when.method(POST).path("/chat/completions").body_contains("totalRows");
            then.status(200).json_body(serde_json::json!({"id":"plan","object":"chat.completion","created":1,"model":"test",
                "choices":[{"index":0,"message":{"role":"assistant","content":r#"{"topic":"移入规约与语法分析","terms":[],"leadingChatterEndId":0,"trailingChatterStartId":2}"#},"finish_reason":"stop"}],
                "usage":{"prompt_tokens":20,"completion_tokens":5,"total_tokens":25}}));
        });
        let lines = vec![line("片头闲聊"), line("一路规约"), line("片尾闲聊")];
        let options = VideoProofreadOptions {
            generate_topics: true,
        };
        let result = client
            .proofread_subtitles("课程", &lines, &|_| {}, 0, &options)
            .await
            .unwrap();
        assert_eq!(result.lines[1].res, "移入规约");
        assert_eq!(result.topic.as_deref(), Some("移入规约与语法分析"));
        assert_eq!(
            summary_subtitles(&result.lines, &result.exclude_from_summary).len(),
            1
        );
        assert_eq!(result.completion_tokens, 35);
        assert!(
            client
                .proofread_subtitles("课程", &lines, &|_| {}, 0, &options)
                .await
                .unwrap()
                .cached
        );
        request.assert_hits(1);
        plan_request.assert_hits(1);
        client
            .configure_video_auth("another-account", "", false)
            .await;
        assert!(client.cached_proofread_subtitles(&lines).await.is_none());
        assert!(client
            .proofread_subtitles("课程", &lines, &|_| {}, 0, &options)
            .await
            .is_err());
        // The second batch's invalid ID must prevent even the valid first batch
        // from replacing any source material or entering the shared cache.
        let many = vec![line("一路规约"); 121];
        assert!(client
            .proofread_subtitles("课程", &many, &|_| {}, 1, &options)
            .await
            .is_err());
        assert!(client.cached_proofread_subtitles(&many).await.is_none());
    }

    #[tokio::test]
    async fn disabled_topics_are_discarded_and_cache_respects_topic_setting() {
        use httpmock::prelude::*;
        let server = MockServer::start();
        let plan = server.mock(|when, then| {
            when.method(POST).path("/chat/completions").body_contains("totalRows");
            then.json_body(serde_json::json!({"id":"plan","object":"chat.completion","created":1,"model":"test",
                "choices":[{"index":0,"message":{"role":"assistant","content":r#"{"topic":"应被忽略的主题","terms":[],"leadingChatterEndId":null,"trailingChatterStartId":null}"#},"finish_reason":"stop"}]}));
        });
        let edits = server.mock(|when, then| {
            when.method(POST).path("/chat/completions").body_contains("joinNext");
            then.json_body(serde_json::json!({"id":"edits","object":"chat.completion","created":1,"model":"test",
                "choices":[{"index":0,"message":{"role":"assistant","content":r#"{"complete":true,"edits":[],"joinNext":[]}"#},"finish_reason":"stop"}]}));
        });
        let client = Client::new_without_proxy(
            "https://oc.sjtu.edu.cn",
            "test-key",
            server.base_url().as_str(),
            "test",
            None,
        );
        let options = VideoProofreadOptions::default();
        let snapshot = client.llm_snapshot().await.unwrap();
        let original = config_hash(&snapshot, &options);
        assert_ne!(
            original,
            config_hash(
                &snapshot,
                &VideoProofreadOptions {
                    generate_topics: true
                }
            )
        );
        let source = vec![line("课堂正文")];
        let result = client
            .proofread_subtitles("课程", &source, &|_| {}, 0, &options)
            .await
            .unwrap();
        assert!(result.topic.is_none());
        assert_eq!(result.config_hash, original);
        assert!(
            client
                .proofread_subtitles("课程", &source, &|_| {}, 0, &options)
                .await
                .unwrap()
                .cached
        );
        plan.assert_hits(1);
        edits.assert_hits(1);
    }

    #[tokio::test]
    #[ignore = "requires configured model credentials; sends real classroom subtitles"]
    async fn live_subtitle_proofread_benchmark() {
        let config_path = std::env::var("SJTU_PROOFREAD_TEST_CONFIG").unwrap();
        let input_path = std::env::var("SJTU_PROOFREAD_TEST_INPUT").unwrap();
        let output_path = std::env::var("SJTU_PROOFREAD_TEST_OUTPUT").unwrap();
        let config: crate::model::AppConfig =
            serde_json::from_str(&std::fs::read_to_string(config_path).unwrap()).unwrap();
        let input: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(input_path).unwrap()).unwrap();
        let lines: Vec<CanvasVideoSubTitle> =
            serde_json::from_value(input["lines"].clone()).unwrap();
        let runtime = super::super::llm::chat::LlmRuntime::new(
            super::super::EffectiveLlmConfig::from_app_config(&config),
        )
        .unwrap();
        let snapshot = runtime.snapshot().await.unwrap();
        let result = run(
            &snapshot,
            input["title"].as_str().unwrap(),
            &lines,
            &|message| println!("{message}"),
            &VideoProofreadOptions::from(&config),
        )
        .await
        .unwrap();
        assert_eq!(result.lines.len(), lines.len());
        for (before, after) in lines.iter().zip(&result.lines) {
            let mut expected = before.clone();
            expected.res = after.res.clone();
            assert_eq!(expected, *after);
        }
        let mut report = serde_json::to_value(&result).unwrap();
        report["inputCharacters"] = lines
            .iter()
            .map(|l| l.res.chars().count())
            .sum::<usize>()
            .into();
        report["lastSubtitleMs"] = lines.iter().map(|l| l.ed).max().unwrap_or(0).into();
        std::fs::write(&output_path, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
        // Lecture text stays in the local ignored audit directory, never in logs.
        std::fs::write(
            format!("{output_path}.lines.json"),
            serde_json::to_vec(&result.lines).unwrap(),
        )
        .unwrap();
        println!("BENCHMARK {}", report);
    }
}
