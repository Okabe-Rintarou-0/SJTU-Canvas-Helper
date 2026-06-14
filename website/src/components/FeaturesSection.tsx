import { Box, Container, Typography, Grid, Paper, Chip } from "@mui/material"
import type { SxProps, Theme } from "@mui/material"
import ScrollReveal from "./ScrollReveal"

const styles: Record<string, SxProps<Theme>> = {
  section: {
    py: { xs: 8, md: 12 },
    bgcolor: "background.default",
  },
  card: {
    p: 3,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    border: "1px solid",
    borderColor: "divider",
    borderRadius: "16px",
    transition: "all 0.3s ease",
    "&:hover": {
      borderColor: "primary.light",
      boxShadow: "0 8px 30px rgba(26,115,232,0.1)",
      transform: "translateY(-4px)",
    },
  },
  cardContent: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
  },
  cardDesc: {
    flex: 1,
    lineHeight: 1.6,
  },
}

const features = [
  {
    icon: "📂",
    title: "文件免下载预览",
    desc: "按下空格即刻预览，再次空格关闭。支持 PDF、DOCX、XLSX、Markdown、代码、图片、IPYNB 等多种格式",
    tag: "仿 MacOS Quick Look",
  },
  {
    icon: "🗜️",
    title: "压缩包直接浏览",
    desc: "无需解压即可浏览 ZIP、RAR、7Z 等主流压缩包内的文件内容",
    tag: "省时省力",
  },
  {
    icon: "📄",
    title: "PDF & PPTX 混合合并",
    desc: "在线合并 PDF 和 PPTX 文件，无需下载到本地再处理",
    tag: "免下载",
  },
  {
    icon: "☁️",
    title: "一键上传交大云盘",
    desc: "直接在应用内将文件一键上传至交大云盘（新），省去手动下载再上传的繁琐步骤",
    tag: "快捷存储",
  },
  {
    icon: "📅",
    title: "DDL 日历",
    desc: "自动同步课程截止日期，不再错过任何作业提交",
    tag: "不再拖延",
  },
  {
    icon: "👥",
    title: "人员名单导出",
    desc: "一键导出课程成员名单，方便教务管理",
    tag: "教务神器",
  },
  {
    icon: "📝",
    title: "查看 / 提交 / 批改作业",
    desc: "完整支持作业的查看、提交、批改和 DDL 修改流程",
    tag: "全流程覆盖",
  },
  {
    icon: "🎬",
    title: "课程录屏处理",
    desc: "视频下载、播放、字幕下载、截图抓取并合成 PDF",
    tag: "学习利器",
  },
  {
    icon: "🤖",
    title: "多 API Key 管理",
    desc: "支持添加多个 LLM 服务商 Key，自动识别提供商并拉取可用模型列表",
    tag: "AI 赋能",
  },
  {
    icon: "🔌",
    title: "MCP Server",
    desc: "将 Canvas 课程、作业、文件等数据通过标准 MCP 协议开放，接入 Claude、Cursor 等 AI 客户端，让 AI 直接操作您的 Canvas 数据",
    tag: "开发者友好",
  },
  {
    icon: "🧠",
    title: "AI Agent 集成",
    desc: "通过内置 AI 助手实现智能问答、文件内容分析、字幕总结、视频截图合成等自动化工作流",
    tag: "智能助手",
  },
  {
    icon: "🔄",
    title: "自动更新",
    desc: "一次安装，后续主版本自动更新，无需重复下载",
    tag: "省心",
  },
  {
    icon: "🏫",
    title: "双系统支持",
    desc: "完美支持密西根学院和本部 Canvas 系统",
    tag: "全覆盖",
  },
]

export default function FeaturesSection() {
  return (
    <Box id="features" sx={styles.section}>
      <Container maxWidth="lg">
        <ScrollReveal>
          <Box sx={{ textAlign: "center", mb: 6 }}>
            <Typography variant="h3" sx={{ fontWeight: 700 }}>
              功能特性
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mt: 1, maxWidth: 500, mx: "auto" }}>
              一个工具，搞定所有 Canvas 日常操作
            </Typography>
          </Box>
        </ScrollReveal>

        <Grid container spacing={3}>
          {features.map((f, i) => (
            <Grid key={f.title} size={{ xs: 12, sm: 6, md: 4 }}>
              <ScrollReveal delay={i * 50}>
                <Paper elevation={0} sx={styles.card}>
                  <Typography variant="h4" sx={{ mb: 1, fontSize: "2rem" }}>{f.icon}</Typography>
                  <Chip label={f.tag} size="small" color="primary" variant="outlined" sx={{ fontWeight: 500, fontSize: "0.7rem", mb: 1 }} />
                  <Box sx={styles.cardContent}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>{f.title}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={styles.cardDesc}>{f.desc}</Typography>
                  </Box>
                </Paper>
              </ScrollReveal>
            </Grid>
          ))}
        </Grid>
      </Container>
    </Box>
  )
}
