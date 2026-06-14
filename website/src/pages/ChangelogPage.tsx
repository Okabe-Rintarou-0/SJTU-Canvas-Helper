import { Box, Container, Typography, Paper, Chip, IconButton } from "@mui/material"
import type { SxProps, Theme } from "@mui/material"
import { useNavigate } from "react-router-dom"
import ArrowBackIcon from "@mui/icons-material/ArrowBack"
import ScrollReveal from "../components/ScrollReveal"

const styles: Record<string, SxProps<Theme>> = {
  page: {
    minHeight: "100vh",
    bgcolor: "#f0f2f5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    py: { xs: 4, md: 6 },
  },
  modal: {
    width: "100%",
    maxWidth: 680,
    mx: "auto",
    bgcolor: "background.paper",
    borderRadius: "20px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.12)",
    overflow: "hidden",
    position: "relative",
  },
  header: {
    px: { xs: 3, md: 5 },
    pt: { xs: 3, md: 5 },
    pb: 3,
    borderBottom: "1px solid",
    borderColor: "divider",
  },
  body: {
    px: { xs: 3, md: 5 },
    py: 4,
    maxHeight: { xs: "auto", md: 520 },
    overflowY: "auto",
  },
  card: {
    p: 3,
    borderRadius: "14px",
    border: "1px solid",
    borderColor: "divider",
    bgcolor: "background.paper",
  },
}

const releases = [
  {
    version: "v3.0.3",
    tag: "最新",
    color: "primary" as const,
    changes: [
      "支持多 API Key 管理：可添加多个 LLM 服务商 Key，自动识别提供商并拉取可用模型列表",
      "支持 SSE 协议 MCP Server，将 Canvas 数据通过标准 MCP 协议开放给 AI 客户端",
      "多项稳定性修复与优化",
    ],
  },
  {
    version: "v3.0.2",
    tag: "增强",
    color: "secondary" as const,
    changes: [
      "完善 MCP Server 功能",
      "优化登录流程，修复登录相关问题",
      "改进日志写入机制，防止 release 下日志被静默丢弃",
    ],
  },
  {
    version: "v3.0.1",
    tag: "优化",
    color: "info" as const,
    changes: [
      "持续优化代码质量",
      "添加 Rust 覆盖率 CI/CD",
      "多项依赖更新与 bug 修复",
    ],
  },
  {
    version: "v3.0.0",
    tag: "大版本",
    color: "success" as const,
    changes: [
      "全面 UI 重构：使用 MUI 组件库重写前端界面",
      "重构设置页面，优化用户体验",
      "多项底层架构优化",
    ],
  },
  {
    version: "v2.x",
    tag: "历史",
    color: "default" as const,
    changes: [
      "文件免下载预览 / PDF & PPTX 混合合并",
      "一键上传交大云盘",
      "DDL 日历、人员名单导出",
      "课程录屏播放/下载/字幕",
      "视频截图抓取合成 PDF",
      "查看/提交/批改作业、修改 DDL",
      "支持密院和本部 Canvas 系统",
      "自动更新机制",
    ],
  },
]

export default function ChangelogPage() {
  const navigate = useNavigate()

  return (
    <Box sx={styles.page}>
      <Container maxWidth="md" sx={{ px: { xs: 2, md: 0 } }}>
        <Box sx={styles.modal}>
          {/* Header */}
          <Box sx={styles.header}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
              <IconButton onClick={() => navigate("/")} size="small" sx={{ color: "text.secondary" }}>
                <ArrowBackIcon />
              </IconButton>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                更新日志
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ ml: 5 }}>
              从 v3.0 开始，Canvas Helper 的每一次改进
            </Typography>
          </Box>

          {/* Body */}
          <Box sx={styles.body}>
            <Box sx={{ position: "relative" }}>
              {/* Timeline line */}
              <Box
                sx={{
                  position: "absolute",
                  left: 15,
                  top: 12,
                  bottom: 12,
                  width: 2,
                  bgcolor: "primary.light",
                  opacity: 0.2,
                }}
              />

              {releases.map((release, i) => (
                <ScrollReveal key={release.version} delay={i * 60}>
                  <Box sx={{ display: "flex", gap: 2.5, mb: 3.5, position: "relative" }}>
                    {/* Dot */}
                    <Box
                      sx={{
                        mt: 0.5,
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        bgcolor: `${release.color}.main` as any,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        flexShrink: 0,
                        zIndex: 1,
                        boxShadow: "0 2px 8px rgba(26,115,232,0.2)",
                      }}
                    >
                      {releases.length - i}
                    </Box>

                    {/* Card */}
                    <Paper elevation={0} sx={styles.card}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.5, flexWrap: "wrap" }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700, color: `${release.color}.main` as any }}>
                          {release.version}
                        </Typography>
                        <Chip label={release.tag} size="small" color={release.color === "default" ? undefined : release.color} sx={{ fontWeight: 600, fontSize: "0.7rem" }} />
                      </Box>
                      <Box
                        component="ul"
                        sx={{
                          m: 0,
                          pl: 2,
                          "& li": { mb: 0.7, lineHeight: 1.5, color: "text.secondary", fontSize: "0.875rem" },
                        }}
                      >
                        {release.changes.map((c) => (
                          <Box component="li" key={c}>{c}</Box>
                        ))}
                      </Box>
                    </Paper>
                  </Box>
                </ScrollReveal>
              ))}
            </Box>
          </Box>
        </Box>
      </Container>
    </Box>
  )
}
