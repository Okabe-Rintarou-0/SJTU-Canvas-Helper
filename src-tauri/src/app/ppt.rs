use crate::model::{CanvasVideoPPT, CanvasVideoSubTitle};

pub(super) fn citation_time(seconds: u64) -> String {
    format!(
        "{:02}:{:02}:{:02}",
        seconds / 3600,
        seconds / 60 % 60,
        seconds % 60
    )
}

/// Service timestamps are seconds (occasionally HH:MM:SS), never subtitle milliseconds.
pub fn slide_seconds(value: &str) -> Option<u64> {
    let parts: Vec<_> = value.trim().split(':').collect();
    if parts.iter().any(|part| {
        part.is_empty()
            || part.starts_with('.')
            || part.ends_with('.')
            || part.chars().any(|c| !(c.is_ascii_digit() || c == '.'))
    }) {
        return None;
    }
    let seconds = match parts.as_slice() {
        [seconds] => seconds.parse::<f64>().ok()?,
        [minutes, seconds] => {
            let seconds = seconds.parse::<f64>().ok()?;
            if !(0.0..60.0).contains(&seconds) {
                return None;
            }
            minutes.parse::<u64>().ok()? as f64 * 60.0 + seconds
        }
        [hours, minutes, seconds] => {
            let minutes = minutes.parse::<u64>().ok()?;
            let seconds = seconds.parse::<f64>().ok()?;
            if minutes >= 60 || !(0.0..60.0).contains(&seconds) {
                return None;
            }
            hours.parse::<u64>().ok()? as f64 * 3600.0 + minutes as f64 * 60.0 + seconds
        }
        _ => return None,
    };
    (seconds.is_finite() && (0.0..=9_007_199_254_740_991.0).contains(&seconds))
        .then(|| seconds.floor() as u64)
}

pub fn ocr_words(slide: &CanvasVideoPPT) -> Vec<String> {
    let mut words = Vec::new();
    for item in &slide.ocr {
        let word = item.word.trim();
        if !word.is_empty() && !words.iter().any(|prior| prior == word) {
            words.push(word.to_owned());
        }
    }
    words
}

fn ocr_evidence(slide: &CanvasVideoPPT) -> Option<String> {
    let text = slide.ocr_text.trim();
    if !text.is_empty() {
        return Some(text.to_owned());
    }
    let keywords = ocr_words(slide).join(" · ");
    (!keywords.is_empty()).then(|| format!("[仅关键词] {keywords}"))
}

/// Only remove pages dominated by multiple explicit UI signals. Sparse or ambiguous OCR stays.
pub fn irrelevant_slide_reason(slide: &CanvasVideoPPT) -> Option<&'static str> {
    let full_text = slide.ocr_text.trim();
    if !full_text.is_empty() {
        // A browser tab titled 点名签到 also appears during teaching. Require the live
        // attendance controls and counts together, rather than trusting its keywords.
        if ["点名签到", "微信扫一扫", "应签", "已签", "结束签到"]
            .iter()
            .all(|marker| full_text.contains(marker))
        {
            return Some("签到页面");
        }
        let desktop_icons = ["回收站", "此电脑", "我的电脑", "recycle bin", "this pc"];
        let lower = full_text.to_lowercase();
        if full_text.chars().count() <= 180
            && desktop_icons
                .iter()
                .filter(|marker| lower.contains(**marker))
                .count()
                >= 2
        {
            let search_controls = ["在此键入进行搜索", "键入以搜索", "控制面板"]
                .iter()
                .any(|marker| lower.contains(marker));
            // Icon-only taskbars have no search-box text. Require several distinct
            // launchers as alternate evidence, while retaining teaching/open windows.
            let compact: String = lower.chars().filter(|c| !c.is_whitespace()).collect();
            let launchers = [
                "googlechrome",
                "microsoftedge",
                "vlcmediaplayer",
                "腾讯会议",
                "微信",
                "codeblocks",
                "pycharm",
                "cygwin64terminal",
                "adobeacrobat",
                "adobereader",
                "norwiipresenter",
            ];
            let content_or_window = [
                "课程",
                "知识点",
                "说明",
                "示例",
                "算法",
                "代码",
                "定理",
                "证明",
                "公式",
                "文件管理",
                "文件主页",
                "文件编辑",
                "编辑视图",
                "名称修改日期",
                "名称类型大小",
                ".pdf",
                ".pptx",
                "http://",
                "https://",
                "#include",
                "intmain(",
            ]
            .iter()
            .any(|marker| compact.contains(marker));
            let launcher_desktop = launchers
                .iter()
                .filter(|marker| compact.contains(**marker))
                .count()
                >= 4
                && !content_or_window;
            if search_controls || launcher_desktop {
                return Some("Windows 桌面");
            }
        }
        // Full text overrides sparse keywords, which may omit actual teaching content.
        return None;
    }
    let words = ocr_words(slide);
    if words.len() < 3 || words.iter().map(|w| w.chars().count()).sum::<usize>() < 8 {
        return None;
    }
    let normalized: Vec<_> = words.iter().map(|w| w.to_lowercase()).collect();
    let desktop = [
        "回收站",
        "此电脑",
        "我的电脑",
        "网络",
        "控制面板",
        "recycle bin",
        "this pc",
        "计算机",
        "在此键入进行搜索",
        "键入以搜索",
    ];
    let attendance = [
        "课堂签到",
        "扫码签到",
        "签到二维码",
        "考勤签到",
        "签到码",
        "二维码",
        "请扫码",
        "刷新二维码",
        "签到成功",
        "未签到",
        "已签到",
        "剩余时间",
        "姓名",
        "学号",
        "签到人数",
        "签到",
        "考勤",
    ];
    let strong_attendance = ["课堂签到", "扫码签到", "签到二维码", "考勤签到", "签到码"];
    let count = |markers: &[&str]| {
        normalized
            .iter()
            .filter(|w| markers.contains(&w.as_str()))
            .count()
    };
    let dominated = |markers: &[&str]| {
        let recognized: usize = normalized
            .iter()
            .filter(|w| markers.contains(&w.as_str()))
            .map(|w| w.chars().count())
            .sum();
        count(markers) * 4 >= words.len() * 3
            && recognized * 4 >= normalized.iter().map(|w| w.chars().count()).sum::<usize>() * 3
    };
    // A PDF reader's Login button or a lecture mentioning Windows is insufficient.
    if count(&desktop) >= 3 && dominated(&desktop) {
        return Some("Windows 桌面");
    }
    if count(&strong_attendance) >= 1 && count(&attendance) >= 3 && dominated(&attendance) {
        return Some("签到页面");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::CanvasVideoPPTOcr;

    fn slide(time: &str, words: &[&str]) -> CanvasVideoPPT {
        CanvasVideoPPT {
            create_sec: time.into(),
            ocr: words
                .iter()
                .map(|word| CanvasVideoPPTOcr {
                    word: (*word).into(),
                })
                .collect(),
            ppt_img_url: Some("https://example.test/ppt.png".into()),
            ocr_text: String::new(),
            animation_start_sec: None,
            related_slide_secs: Vec::new(),
        }
    }

    #[test]
    fn timestamps_use_seconds_and_reject_invalid_times() {
        assert_eq!(slide_seconds("356.9"), Some(356));
        assert_eq!(slide_seconds("00:05:56"), Some(356));
        assert_eq!(slide_seconds("05:56"), Some(356));
        for invalid in ["", "-1", "NaN", "Infinity", "00:60:00", "01:99", "unknown"] {
            assert_eq!(slide_seconds(invalid), None);
        }
    }

    #[test]
    fn merges_independent_evidence_without_duplicating_slides_or_inventing_links() {
        let lines = vec![
            CanvasVideoSubTitle {
                bg: 12500,
                res: "教师讲解一".into(),
                ..Default::default()
            },
            CanvasVideoSubTitle {
                bg: 17000,
                res: "教师讲解二".into(),
                ..Default::default()
            },
        ];
        let slides = vec![
            slide("20", &["规约"]),
            slide("10", &["语法分析", "语法分析"]),
            slide("bad", &["时间未知内容"]),
        ];
        let (text, available, untimed) = material_timeline("videoSpace:a", &lines, &slides);
        assert!(available);
        assert_eq!(untimed, 1);
        assert_eq!(text.matches("语法分析").count(), 1);
        assert!(text.find("&t=10)").unwrap() < text.find("&t=12)").unwrap());
        assert!(text.find("&t=17)").unwrap() < text.find("&t=20)").unwrap());
        assert!(text.contains("#video=videoSpace%3Aa&t=10"));
        assert!(text.contains("[字幕] 教师讲解一"));
        assert!(!text.contains("下一切片"));
        assert!(!text.contains("&t=0)"));
        assert!(text.contains("时间未知，不能跳转"));
    }

    #[test]
    fn concise_ocr_keeps_full_text_and_surrounding_subtitle_context() {
        let subtitles = vec![
            CanvasVideoSubTitle {
                bg: 9000,
                res: "接下来解释条件概率".into(),
                ..Default::default()
            },
            CanvasVideoSubTitle {
                bg: 10000,
                res: "这里的条件是事件乙发生".into(),
                ..Default::default()
            },
            CanvasVideoSubTitle {
                bg: 12000,
                res: "分母为事件乙的概率".into(),
                ..Default::default()
            },
        ];
        let mut full = slide("10", &["条件概率", "冗余摘要"]);
        full.ocr_text = "  条件概率\nP(甲|乙)=P(甲∩乙)/P(乙)  ".into();
        full.animation_start_sec = Some("5".into());
        full.related_slide_secs = vec!["5".into()];
        let keyword_only = slide("15", &["独立事件", "独立事件"]);
        let blank = slide("18", &[" "]);
        let (text, available, untimed) =
            material_timeline("canvas:test", &subtitles, &[full, keyword_only, blank]);
        assert!(available);
        assert_eq!(untimed, 0);
        assert_eq!(
            text,
            concat!(
            "[00:00:09](#video=canvas%3Atest&t=9) [字幕] 接下来解释条件概率\n",
            "[00:00:10](#video=canvas%3Atest&t=10) [PPT OCR] 条件概率\nP(甲|乙)=P(甲∩乙)/P(乙)\n",
            "[00:00:10](#video=canvas%3Atest&t=10) [字幕] 这里的条件是事件乙发生\n",
            "[00:00:12](#video=canvas%3Atest&t=12) [字幕] 分母为事件乙的概率\n",
            "[00:00:15](#video=canvas%3Atest&t=15) [PPT OCR] [仅关键词] 独立事件\n",
        )
        );
    }

    #[test]
    fn ocr_only_and_revisited_slides_keep_their_evidence() {
        let slides = vec![slide("1", &["解析树"]), slide("8", &["解析树"])];
        let (text, available, _) = material_timeline("canvas:b", &[], &slides);
        assert!(available);
        assert_eq!(text.matches("解析树").count(), 2);
        assert!(text.contains("&t=8)"));
        assert!(!material_timeline("canvas:b", &[], &[slide("1", &[" "])]).1);
    }

    #[test]
    fn animation_simplification_preserves_sparse_changed_and_revisited_pages() {
        let text = "动画例子：模型训练需要考虑上下文窗口和输入层隐层输出层之间的连接关系，并使用梯度下降算法更新全部参数";
        let mut first = slide("10", &["模型"]);
        first.ocr_text = text.into();
        let mut second = first.clone();
        second.create_sec = "20".into();
        second.ocr_text += "学习率需要根据验证数据的训练结果逐步调整";
        let mut final_slide = second.clone();
        final_slide.create_sec = "30".into();
        final_slide.ocr_text += "最后检查收敛并分析可能的过拟合现象";
        let (kept, _) =
            simplify_animation_slides(vec![first.clone(), second, final_slide.clone()], true);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].create_sec, "30");
        assert_eq!(kept[0].animation_start_sec.as_deref(), Some("10"));
        let sparse = slide("35", &["模型"]);
        let mut revisited = final_slide.clone();
        revisited.create_sec = "50".into();
        assert_eq!(
            simplify_animation_slides(vec![final_slide, sparse.clone(), revisited], true)
                .0
                .len(),
            3
        );
        let mut formula = first.clone();
        formula.ocr_text += "学习率=0.1，验证集准确率95%";
        let mut replaced = formula.clone();
        replaced.create_sec = "60".into();
        replaced.ocr_text =
            replaced.ocr_text.replace("0.1", "0.2") + "补充说明训练与验证阶段的参数变化和评估指标";
        assert_eq!(
            simplify_animation_slides(vec![formula, replaced], true)
                .0
                .len(),
            2
        );
        let mut fraction = first.clone();
        fraction.ocr_text += "学习率=1/2";
        let mut different_fraction = fraction.clone();
        different_fraction.create_sec = "70".into();
        different_fraction.ocr_text = different_fraction.ocr_text.replace("=1/2", "=1/3");
        assert_eq!(
            simplify_animation_slides(vec![fraction, different_fraction], true)
                .0
                .len(),
            2
        );
        let mut untimed = first.clone();
        untimed.create_sec = "bad".into();
        assert_eq!(
            simplify_animation_slides(vec![untimed, first, sparse], true)
                .0
                .len(),
            3
        );
    }

    #[test]
    fn same_page_revisits_stay_separate_after_any_intervening_page() {
        let base = "词向量模型的优化：我们需要分析输入层和输出层之间的连接关系，并在训练过程中更新参数以降低预测误差";
        let mut partial = slide("10", &["词向量"]);
        partial.ocr_text = format!("{base}SJTU 35/49");
        let mut complete = partial.clone();
        complete.create_sec = "20".into();
        complete.ocr_text =
            format!("{base}补充内容：分层柔性最大化和负采样可以降低计算开销SJTU 35/49");
        let mut another = slide("30", &["新内容"]);
        another.ocr_text = format!("其他页面：{base}SJTU 36/49");
        let mut partial_revisit = partial.clone();
        partial_revisit.create_sec = "40".into();
        let (kept, _) =
            simplify_animation_slides(vec![partial, complete, another, partial_revisit], true);
        assert_eq!(kept.len(), 3);
        let full = kept.iter().find(|slide| slide.create_sec == "20").unwrap();
        assert_eq!(full.related_slide_secs, vec!["10"]);
        let revisit = kept.iter().find(|slide| slide.create_sec == "40").unwrap();
        assert!(revisit.related_slide_secs.is_empty());
        assert!(revisit.animation_start_sec.is_none());
        assert!(!revisit.ocr_text.contains("负采样"));
        assert!(full.ocr_text.contains("负采样"));
        let (text, _, _) = material_timeline("videoSpace:test", &[], &kept);
        for time in [20, 30, 40] {
            assert!(text.contains(&format!("&t={time})")));
        }
        assert!(!text.contains("&t=10)"));
        assert_eq!(text.matches("[PPT OCR]").count(), 3);
    }

    #[test]
    fn numeric_formula_changes_and_different_page_numbers_are_not_duplicates() {
        let base = "模型训练参数：输入层和输出层之间的连接关系用于学习上下文，并根据验证集上的预测误差更新参数";
        for (old, new) in [
            ("学习率=0.1", "学习率=01"),
            ("概率=1/2", "概率=1/3"),
            ("迭代次数=20", "迭代次数=30"),
        ] {
            let mut a = slide("10", &["参数"]);
            a.ocr_text = format!("{base}{old}SJTU 35/49");
            let mut b = a.clone();
            b.create_sec = "20".into();
            b.ocr_text = format!("{base}{new}补充内容：额外的参数设置和验证结果SJTU 35/49");
            assert_eq!(simplify_animation_slides(vec![a, b], true).0.len(), 2);
        }
        let mut a = slide("10", &["目录"]);
        a.ocr_text = format!("{base}SJTU 35/49");
        let mut b = a.clone();
        b.create_sec = "20".into();
        b.ocr_text = format!("{base}SJTU 36/49");
        assert_eq!(simplify_animation_slides(vec![a, b], true).0.len(), 2);
    }

    #[test]
    fn unified_cleanup_filters_without_bridging_revisits_and_defaults_to_off() {
        let mut a = slide("10", &["词向量"]);
        a.ocr_text = "词向量模型训练：我们需要分析输入层和输出层之间的连接关系，并在训练过程中更新参数以降低预测误差SJTU 35/49".into();
        let desktop = slide("20", &["回收站", "此电脑", "网络", "控制面板"]);
        let mut revisit = a.clone();
        revisit.create_sec = "30".into();
        let input = vec![a, desktop, revisit];
        assert_eq!(
            clean_up_slides(input.clone(), false),
            (input.clone(), vec![])
        );
        let (kept, notes) = clean_up_slides(input, true);
        assert_eq!(kept.len(), 2);
        assert_eq!(kept[0].create_sec, "10");
        assert_eq!(kept[1].create_sec, "30");
        assert!(kept.iter().all(|page| page.related_slide_secs.is_empty()));
        assert!(notes.iter().any(|note| note.contains("Windows 桌面")));
        assert!(!crate::model::AppConfig::default().experimental_ppt_cleanup);
        let subtitles = vec![CanvasVideoSubTitle {
            bg: 20000,
            res: "现在回到教学页面".into(),
            ..Default::default()
        }];
        let (text, _, _) = material_timeline("test", &subtitles, &kept);
        assert!(!text.contains("回收站"));
        assert!(text.contains("现在回到教学页面"));
    }

    #[test]
    fn full_text_filter_requires_attendance_controls_and_preserves_teaching_with_signin_tabs() {
        let mut attendance = slide("1", &["canvas", "sjtu", "点名签到", "课程大纲", "评分标准"]);
        // Live Canvas attendance controls, with student names omitted.
        attendance.ocr_text = "canvas sjtu 点名签到2026-2027 Fall微信扫一扫刷新帐户主页公告应签：55已签：26控制面板作业课程大纲评分标准结束签到".into();
        let mut lecture = slide("16", &["canvas", "点名签到", "课堂签到", "二维码", "学号"]);
        lecture.ocr_text = "canvas sjtu 搜索×点名签到×PowerPoint 图书标识号 国际标准书号 ISBN 校验码 在此键入进行搜索".into();
        assert_eq!(irrelevant_slide_reason(&attendance), Some("签到页面"));
        assert_eq!(irrelevant_slide_reason(&lecture), None);
        let mut desktop = slide("3", &["Windows"]);
        desktop.ocr_text = "回收站 此电脑 网络 在此键入进行搜索 2026/9/29".into();
        assert_eq!(irrelevant_slide_reason(&desktop), Some("Windows 桌面"));
        assert_eq!(
            filter_export_slides(
                vec![attendance.clone(), lecture.clone(), desktop.clone()],
                false
            )
            .0
            .len(),
            3
        );
        let (kept, notes) = filter_export_slides(vec![attendance, lecture, desktop], true);
        assert_eq!(kept.len(), 1);
        assert_eq!(notes.len(), 2);
    }

    #[test]
    fn desktop_with_icon_only_search_is_removed_but_teaching_and_windows_stay() {
        // Anonymous desktop OCR: sparse service keywords need not describe the screen.
        let mut desktop = slide("1", &["WELCOME", "CAMPUS"]);
        desktop.ocr_text = "此电脑 Cygwin64\nTerminal CodeBlocks PyCharm Free Deskt... 回收站 VLC media\nplayer 腾讯会议 Google\nChrome 微信 新学期新气象 欢迎回到教学楼".into();
        assert_eq!(irrelevant_slide_reason(&desktop), Some("Windows 桌面"));

        let mut lesson = desktop.clone();
        lesson.create_sec = "15".into();
        lesson.ocr_text += " 桌面操作示例：介绍文件管理";
        let mut explorer = desktop.clone();
        explorer.create_sec = "20".into();
        explorer.ocr_text += " 文件 主页 共享 查看 名称 修改日期 类型 大小";
        let mut code = desktop.clone();
        code.create_sec = "25".into();
        code.ocr_text += " #include <stdio.h> int main() { return 0; }";
        let mut few_launchers = desktop.clone();
        few_launchers.ocr_text = "此电脑 回收站 腾讯会议 腾讯会议 微信 微信 Google Chrome".into();
        let mut missing_icon = desktop.clone();
        missing_icon.ocr_text = missing_icon.ocr_text.replace("回收站", "");
        let mut long_content = desktop.clone();
        long_content.ocr_text += &"额外内容".repeat(50);
        for kept in [
            &lesson,
            &explorer,
            &code,
            &few_launchers,
            &missing_icon,
            &long_content,
        ] {
            assert_eq!(irrelevant_slide_reason(kept), None);
        }
        let original = vec![desktop, lesson, explorer, code];
        assert_eq!(
            clean_up_slides(original.clone(), false),
            (original.clone(), vec![])
        );
        let (kept, notes) = filter_export_slides(original, true);
        assert_eq!(
            kept.iter()
                .map(|s| s.create_sec.as_str())
                .collect::<Vec<_>>(),
            vec!["15", "20", "25"]
        );
        assert!(notes.iter().any(|note| note.contains("识别为Windows 桌面")));
        let mut lecture = slide("40", &["语法分析"]);
        lecture.ocr_text =
            "语法分析示例：使用产生式和分析表判断输入串是否符合给定文法，并说明冲突的处理过程"
                .into();
        let (kept, notes) = clean_up_slides(vec![long_content, lecture.clone()], true);
        assert_eq!(kept.len(), 2);
        assert!(notes.is_empty());
        let (kept, notes) = clean_up_slides(vec![missing_icon.clone(), lecture.clone()], true);
        assert_eq!(kept.len(), 2);
        assert!(notes.is_empty());
        missing_icon.ocr_text += " 回收站";
        let (kept, notes) = clean_up_slides(vec![missing_icon, lecture.clone()], true);
        assert_eq!(kept, vec![lecture]);
        assert!(notes.iter().any(|note| note.contains("识别为Windows 桌面")));
    }

    #[test]
    fn experimental_filter_is_opt_in_and_keeps_ambiguous_or_sparse_ocr() {
        assert!(!crate::model::AppConfig::default().experimental_ppt_cleanup);
        let desktop = slide("1", &["回收站", "此电脑", "网络"]);
        let attendance = slide("2", &["课堂签到", "二维码", "学号", "姓名"]);
        assert_eq!(irrelevant_slide_reason(&desktop), Some("Windows 桌面"));
        assert_eq!(irrelevant_slide_reason(&attendance), Some("签到页面"));
        let lesson = slide("3", &["Parser", "登录", "电子签名", "语法分析", "解析树"]);
        let mixed = slide(
            "4",
            &[
                "回收站",
                "此电脑",
                "网络",
                "教学中的文件管理与进程调度知识点",
            ],
        );
        let sparse = slide("5", &["课堂签到"]);
        for slide in [&lesson, &mixed, &sparse] {
            assert_eq!(irrelevant_slide_reason(slide), None);
        }
        let slides = vec![desktop, attendance, lesson, mixed, sparse];
        assert_eq!(
            filter_export_slides(slides.clone(), false),
            (slides.clone(), vec![])
        );
        let (kept, notes) = filter_export_slides(slides, true);
        assert_eq!(kept.len(), 3);
        assert_eq!(notes.len(), 2);
    }
}

pub fn filter_export_slides(
    slides: Vec<CanvasVideoPPT>,
    enabled: bool,
) -> (Vec<CanvasVideoPPT>, Vec<String>) {
    if !enabled {
        return (slides, Vec::new());
    }
    let mut kept = Vec::new();
    let mut notes = Vec::new();
    for (index, slide) in slides.into_iter().enumerate() {
        if let Some(reason) = irrelevant_slide_reason(&slide) {
            notes.push(format!(
                "实验性过滤：第 {} 张切片（{}）识别为{reason}，已从 PPT 资料中排除",
                index + 1,
                slide.create_sec
            ));
        } else {
            kept.push(slide);
        }
    }
    (kept, notes)
}

fn animation_text(value: &str) -> (Vec<char>, Option<(u16, u16)>) {
    static PAGE_NUMBER: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let pattern =
        PAGE_NUMBER.get_or_init(|| regex::Regex::new(r"(\d{1,3})\s*/\s*(\d{1,3})\s*$").unwrap());
    let value = value.trim();
    let footer = pattern.captures(value).filter(|m| {
        let preceding = &value[..m.get(0).unwrap().start()];
        let tail: String = preceding
            .chars()
            .rev()
            .take(60)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        let lower = tail.to_lowercase();
        // A trailing formula fraction is not a slide counter.
        !preceding.trim_end().ends_with(['=', '+', '-', '∂'])
            && (lower.contains("sjtu")
                || lower.contains("copyright")
                || preceding.trim_end().ends_with('第'))
    });
    let page = footer
        .as_ref()
        .and_then(|m| Some((m[1].parse().ok()?, m[2].parse().ok()?)));
    let body = footer
        .as_ref()
        .map(|m| &value[..m.get(0).unwrap().start()])
        .unwrap_or(value);
    let text = body
        .to_lowercase()
        .chars()
        .map(|c| match c {
            '∑' => 'σ',
            '−' | '–' => '-',
            '₀' | '⁰' => '0',
            '₁' | '¹' => '1',
            '₂' | '²' => '2',
            '₃' | '³' => '3',
            '₄' | '⁴' => '4',
            '₅' | '⁵' => '5',
            '₆' | '⁶' => '6',
            '₇' | '⁷' => '7',
            '₈' | '⁸' => '8',
            '₉' | '⁹' => '9',
            'ᵀ' => 't',
            other => other,
        })
        .filter(|c| !c.is_whitespace() && !".,，。:：;；'\"“”‘’()（）[]【】".contains(*c))
        .collect();
    (text, page)
}

/// Coverage of the older page in the newer page, preserving character order and math symbols.
fn subsequence_length(old: &[char], new: &[char]) -> usize {
    let mut row = vec![0; new.len() + 1];
    for a in old {
        let mut diagonal = 0;
        for (index, b) in new.iter().enumerate() {
            let above = row[index + 1];
            row[index + 1] = if a == b {
                diagonal + 1
            } else {
                row[index + 1].max(row[index])
            };
            diagonal = above;
        }
    }
    row[new.len()]
}

#[derive(Clone, Copy)]
enum SlideRelation {
    Duplicate,
    NewMoreComplete,
    OldMoreComplete,
}

fn ngram_coverage(old: &[char], new: &[char], size: usize) -> f64 {
    let mut remaining = std::collections::HashMap::<Vec<char>, usize>::new();
    for gram in new.windows(size) {
        *remaining.entry(gram.to_vec()).or_default() += 1;
    }
    let mut matched = 0;
    for gram in old.windows(size) {
        if let Some(count) = remaining.get_mut(gram) {
            if *count > 0 {
                matched += 1;
                *count -= 1;
            }
        }
    }
    matched as f64 / (old.len() - size + 1) as f64
}

fn numbers_preserved(old: &str, new: &str) -> bool {
    static NUMBERS: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let regex = NUMBERS.get_or_init(|| {
        regex::Regex::new(
            r"\d+\s*/\s*\d+|[=<>≤≥]\s*[-−]?\d+(?:\.\d+)?(?:\s*/\s*\d+)?|\d+(?:\.\d+)?",
        )
        .unwrap()
    });
    let values = |text: &str| {
        let mut counts = std::collections::HashMap::<String, usize>::new();
        for value in regex.find_iter(text) {
            let value: String = value
                .as_str()
                .chars()
                .filter(|c| !c.is_whitespace())
                .map(|c| if c == '−' { '-' } else { c })
                .collect();
            if value.contains('.')
                || value.contains('/')
                || value.chars().filter(|c| c.is_ascii_digit()).count() > 1
                || value.starts_with(['=', '<', '>', '≤', '≥'])
            {
                *counts.entry(value).or_default() += 1;
            }
        }
        counts
    };
    let new = values(new);
    values(old)
        .iter()
        .all(|(number, count)| new.get(number).copied().unwrap_or(0) >= *count)
}

fn slide_relation(old: &CanvasVideoPPT, new: &CanvasVideoPPT) -> Option<SlideRelation> {
    let (Some(old_time), Some(new_time)) = (
        slide_seconds(&old.create_sec),
        slide_seconds(&new.create_sec),
    ) else {
        return None;
    };
    if new_time < old_time || (old.ppt_img_url.is_some() && new.ppt_img_url.is_none()) {
        return None;
    }
    let (a, old_page) = animation_text(&old.ocr_text);
    let (b, new_page) = animation_text(&new.ocr_text);
    let same_page = old_page.is_some() && old_page == new_page;
    if a.len().min(b.len()) < 45
        || a.len().max(b.len()) > 2000
        || a.iter().take(16).ne(b.iter().take(16))
        || matches!((old_page, new_page), (Some(x), Some(y)) if x != y)
    {
        return None;
    }
    let preserved = numbers_preserved(&old.ocr_text, &new.ocr_text);
    let reverse_preserved = numbers_preserved(&new.ocr_text, &old.ocr_text);
    if a == b && preserved && reverse_preserved {
        return Some(SlideRelation::Duplicate);
    }
    if same_page
        && preserved
        && reverse_preserved
        && a.len().min(b.len()) * 100 >= a.len().max(b.len()) * 93
        && ngram_coverage(&a, &b, 2) >= 0.97
        && ngram_coverage(&b, &a, 2) >= 0.97
        && ngram_coverage(&a, &b, 3) >= 0.94
        && ngram_coverage(&b, &a, 3) >= 0.94
    {
        return Some(SlideRelation::Duplicate);
    }
    let covers = |partial: &[char], full: &[char]| {
        if full.len() < partial.len() + 8 || full.len() * 10 < partial.len() * 11 {
            return false;
        }
        let ordered = subsequence_length(partial, full);
        if same_page {
            // OCR often moves an existing formula's characters when annotations appear.
            // Combine ordered evidence and counted local fragments rather than demanding
            // one exact reading order. Both the slide number and title must agree.
            ngram_coverage(partial, full, 2) >= 0.95
                && ngram_coverage(partial, full, 3) >= 0.90
                && ordered * 100 >= partial.len() * 70
        } else {
            ordered == partial.len()
        }
    };
    if preserved && covers(&a, &b) {
        return Some(SlideRelation::NewMoreComplete);
    }
    if reverse_preserved && covers(&b, &a) {
        return Some(SlideRelation::OldMoreComplete);
    }
    None
}

fn merge_slide_times(chosen: &mut CanvasVideoPPT, other: &CanvasVideoPPT) {
    chosen.related_slide_secs.push(other.create_sec.clone());
    chosen
        .related_slide_secs
        .extend(other.related_slide_secs.iter().cloned());
    chosen
        .related_slide_secs
        .retain(|time| time != &chosen.create_sec);
    chosen
        .related_slide_secs
        .sort_by_key(|time| slide_seconds(time).unwrap_or(u64::MAX));
    chosen.related_slide_secs.dedup();
}

/// Only reduce consecutive original slices. A different page always ends a group;
/// returning to an earlier page must remain a separate occurrence.
pub fn simplify_animation_slides(
    slides: Vec<CanvasVideoPPT>,
    enabled: bool,
) -> (Vec<CanvasVideoPPT>, Vec<String>) {
    if !enabled {
        return (slides, Vec::new());
    }
    let total = slides.len();
    let mut kept: Vec<CanvasVideoPPT> = Vec::with_capacity(total);
    let mut group_evidence: Vec<Vec<CanvasVideoPPT>> = Vec::new();
    let mut notes = Vec::new();
    for mut slide in slides {
        let match_group = kept.last().and_then(|previous| {
            let index = kept.len() - 1;
            let relation = slide_relation(previous, &slide)?;
            if !matches!(relation, SlideRelation::OldMoreComplete)
                && group_evidence[index].iter().any(|source| {
                    !matches!(
                        slide_relation(source, &slide),
                        Some(SlideRelation::Duplicate | SlideRelation::NewMoreComplete)
                    )
                })
            {
                return None;
            }
            Some((index, relation))
        });
        if let Some((index, relation)) = match_group {
            group_evidence[index].push(slide.clone());
            let previous = &kept[index];
            let previous_time = previous.create_sec.clone();
            let incoming_time = slide.create_sec.clone();
            match relation {
                SlideRelation::Duplicate | SlideRelation::NewMoreComplete => {
                    slide.animation_start_sec = Some(
                        previous
                            .animation_start_sec
                            .as_ref()
                            .unwrap_or(&previous.create_sec)
                            .clone(),
                    );
                    merge_slide_times(&mut slide, previous);
                    kept[index] = slide;
                }
                SlideRelation::OldMoreComplete => {
                    merge_slide_times(&mut kept[index], &slide);
                }
            }
            notes.push(format!("实验性精简：合并 {previous_time} 与 {incoming_time} 的同页动画/重复切片，保留 {} 的完整画面及真实时间", kept[index].create_sec));
        } else {
            group_evidence.push(vec![slide.clone()]);
            kept.push(slide);
        }
    }
    kept.sort_by_key(|slide| slide_seconds(&slide.create_sec).unwrap_or(u64::MAX));
    if kept.len() < total {
        notes.insert(
            0,
            format!(
                "实验性 PPT 精简：{total} 张 → {} 张（减少 {} 张）",
                kept.len(),
                total - kept.len()
            ),
        );
    }
    (kept, notes)
}

/// Apply the same experimental policy to AI evidence and PDF export. Simplify
/// before filtering so an excluded desktop/sign-in cannot bridge two occurrences.
pub fn clean_up_slides(
    slides: Vec<CanvasVideoPPT>,
    enabled: bool,
) -> (Vec<CanvasVideoPPT>, Vec<String>) {
    let (slides, mut notes) = simplify_animation_slides(slides, enabled);
    let (slides, filter_notes) = filter_export_slides(slides, enabled);
    notes.extend(filter_notes);
    (slides, notes)
}

/// Merge two independent timelines without assigning a whole slide to every subtitle line.
/// Interleave evidence at its own timestamp; retained complete slides use their actual time.
pub fn material_timeline(
    key: &str,
    subtitles: &[CanvasVideoSubTitle],
    slides: &[CanvasVideoPPT],
) -> (String, bool, usize) {
    let key = urlencoding::encode(key);
    let link = |seconds| format!("[{}](#video={key}&t={seconds})", citation_time(seconds));
    let mut events: Vec<(u64, u8, String)> = subtitles
        .iter()
        .map(|line| {
            let seconds = line.bg / 1000;
            (
                seconds,
                1,
                format!("{} [字幕] {}\n", link(seconds), line.res),
            )
        })
        .collect();
    let mut timed_slides: Vec<_> = slides
        .iter()
        .filter_map(|slide| slide_seconds(&slide.create_sec).map(|time| (time, slide)))
        .collect();
    timed_slides.sort_by_key(|(time, _)| *time);
    let mut ocr_available = false;
    let mut untimed = 0;
    let mut previous: Option<(u64, String)> = None;
    for (seconds, slide) in &timed_slides {
        let Some(evidence) = ocr_evidence(slide) else {
            continue;
        };
        ocr_available = true;
        // Only identical evidence at the same instant is redundant; later revisits keep their links.
        if previous
            .as_ref()
            .is_some_and(|(prior, text)| prior == seconds && text == &evidence)
        {
            continue;
        }
        previous = Some((*seconds, evidence.clone()));
        events.push((
            *seconds,
            0,
            format!("{} [PPT OCR] {}\n", link(*seconds), evidence),
        ));
    }
    events.sort_by_key(|(seconds, source, _)| (*seconds, *source));
    let mut text: String = events.into_iter().map(|(_, _, text)| text).collect();
    // Unknown timestamps must not fabricate a t=0 link or disappear from the material.
    // This section deliberately has no jump links.
    for slide in slides
        .iter()
        .filter(|slide| slide_seconds(&slide.create_sec).is_none())
    {
        if let Some(evidence) = ocr_evidence(slide) {
            ocr_available = true;
            untimed += 1;
            text.push_str(&format!("[PPT OCR；时间未知，不能跳转] {}\n", evidence));
        }
    }
    (text, ocr_available, untimed)
}
