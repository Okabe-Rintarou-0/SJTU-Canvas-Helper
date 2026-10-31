export interface SummaryScopeSection {
  key: string;
  time: string;
  included: boolean;
}

/** The summary always gets the full selection, regardless of existing topics. */
export function summaryScopeInstructions(sections: SummaryScopeSection[], generateTopics: boolean): string {
  const instructions = [
    `本次总结的完整范围：${JSON.stringify(sections)}`,
    "正文必须综合上述 included=true 的所有小节；included=false 表示未取得可用资料，说明缺失，不推测其内容。",
    "小节标识与课堂资料中的标识一一对应，各小节拥有独立时间轴。",
  ];
  if (generateTopics) instructions.push(
    "以下是正文完成后的附加主题索引任务，不改变上述完整总结范围。",
    "为每个有资料的小节提炼不超过24个字符的具体主题，不重复课程名或日期，不用Markdown或公式。",
    "并列重点优先用标点（、：；），避免用与、及、和、and串联；优先用惯用英文缩写，如CNN：输出尺寸、池化，不创造缩写。",
    "正文后追加<video-topics>JSON数组</video-topics>内部索引；正文不提及索引、模板或录像key，也不将索引模板当作总结范围。",
    "逐项使用模板的key，每个有资料的小节一条记录；topic替换为该小节主题，证据不足保留null。不要将整堂课主题机械复制到各小节。",
    `附加索引模板：${JSON.stringify(sections.filter((item) => item.included).map(({ key }) => ({ key, topic: null })))}`,
  );
  return instructions.join("\n");
}
