import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import MenuBookRoundedIcon from "@mui/icons-material/MenuBookRounded";
import UpdateRoundedIcon from "@mui/icons-material/UpdateRounded";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Link as MuiLink,
  Stack,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";

const changeLogs = [
  { version: "v2.0.5", date: "2025/12/6", items: ["修复 pdf 渲染"] },
  { version: "v2.0.3", date: "2025/10/18", items: ["修复字幕下载", "支持外部文件"] },
  { version: "v2.0.2", date: "2025/10/15", items: ["修复作业评分"] },
  { version: "v2.0.1", date: "2025/10/12", items: ["修复视频功能"] },
  { version: "v2.0.0", date: "2025/10/2", items: ["迁移至 Tauri v2"] },
  { version: "v1.3.33", date: "2025/6/19", items: ["支持字幕加载和副屏透明度调节与拖动"] },
  { version: "v1.3.32", date: "2025/6/17", items: ["修复视频无法正常回放的问题"] },
  { version: "v1.3.31", date: "2025/5/11", items: ["一些小补丁"] },
  { version: "v1.3.30", date: "2025/5/11", items: ["支持切换前端主题，见设置"] },
  {
    version: "v1.3.29",
    date: "2025/5/11",
    items: [
      "AI 解释文档（WIP）",
      <>
        优化 PDF renderer（见 issue{" "}
        <MuiLink
          href="https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/issues/19"
          target="_blank"
          rel="noreferrer"
        >
          #19
        </MuiLink>
        ）
      </>,
    ],
  },
  { version: "v1.3.28", date: "2025/5/4", items: ["修复字幕下载中字段为空时解析出错的问题"] },
  { version: "v1.3.27", date: "2025/4/5", items: ["新增 PDF 课件下载功能"] },
  { version: "v1.3.26", date: "2025/4/5", items: ["新增 SRT 字幕下载功能"] },
  { version: "v1.3.25", date: "2025/2/20", items: ["采用新版课堂视频下载 API"] },
  { version: "v1.3.24", date: "2025/1/15", items: ["修复视频下载，感谢 xeonliu"] },
  { version: "v1.3.23", date: "2024/12/28", items: ["支持 Jupiter Notebook 文件预览"] },
  { version: "v1.3.22", date: "2024/12/24", items: ["新增年度总结板块", "Merry Xmas!"] },
  { version: "v1.3.21", date: "2024/11/4", items: ["优化作业批改图片显示"] },
  { version: "v1.3.20", date: "2024/11/4", items: ["修复作业提交的路径问题", "优化部分 UI"] },
  {
    version: "v1.3.19",
    date: "2024/10/1",
    items: [
      "优化日志相关的 UI 和操作，目前前后端日志都会定向到一个日志文件",
      "提升视频下载速度",
      "各位国庆快乐",
    ],
  },
  {
    version: "v1.3.18",
    date: "2024/9/28",
    items: ["新增更详细的操作提示", "支持合并视频（需预先安装 ffmpeg）", "支持以 JSON 格式查看配置文件"],
  },
  { version: "v1.3.17", date: "2024/9/27", items: ["恢复 canvas 视频下载功能，支持检查更新"] },
  { version: "v1.3.16", date: "2024/9/27", items: ["支持密院 canvas"] },
  { version: "v1.3.15", date: "2024/9/26", items: ["新增人际关系图板块"] },
  {
    version: "v1.3.13",
    date: "2024/8/21",
    items: [
      <>
        [Enhancement] 优化“作业批改”中选择学生的方式（源自 PR:{" "}
        <MuiLink
          href="https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/pull/33"
          target="_blank"
          rel="noreferrer"
        >
          #33
        </MuiLink>
        ）
      </>,
    ],
  },
  {
    version: "v1.3.12",
    date: "2024/6/25",
    items: [
      <>
        [Enhancement] 支持按 `ctrl`(`command`) + `=` 和 `ctrl`(`command`) + `-` 缩放（源自 Issue:{" "}
        <MuiLink
          href="https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/issues/31"
          target="_blank"
          rel="noreferrer"
        >
          #31
        </MuiLink>
        ）
      </>,
    ],
  },
  {
    version: "v1.3.11",
    date: "2024/6/18",
    items: [
      <>
        [Enhancement] 支持调整 PPTX/PDF 合并顺序（源自 Issue:{" "}
        <MuiLink
          href="https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/issues/29"
          target="_blank"
          rel="noreferrer"
        >
          #29
        </MuiLink>
        ）
      </>,
    ],
  },
  { version: "v1.3.10", date: "2024/6/12", items: ["[Enhancement] 支持所有课程的视频播放下载"] },
  {
    version: "v1.3.8, v1.3.9",
    date: "2024/6/11",
    items: ["[Fix] 修复视频播放重名课程导致的 UI bug", "[Enhancement] 增加作业板块均分/最高分/最低分显示"],
  },
  {
    version: "v1.3.7",
    date: "2024/5/26",
    items: ["[Enhancement] 支持显示评论附件", "[Enhancement] 评分册横向滚动时学生名字保持在左侧", "[Enhancement] 文件页进入目录时自动滚动到页面顶部"],
  },
  {
    version: "v1.3.6",
    date: "2024/5/20",
    items: [
      <>
        [Feature] 支持查看
        <MuiLink href="https://oc.sjtu.edu.cn/files" target="_blank" rel="noreferrer" sx={{ ml: 0.5 }}>
          我的文件
        </MuiLink>
      </>,
      "祝各位 520 快乐，早日找到另一半",
    ],
  },
  { version: "v1.3.5", date: "2024/5/16", items: ["[Fix] 修复老师无法正常使用批改作业功能", "[Fix] 修复课程无老师时无法正确显示"] },
  { version: "v1.3.4", date: "2024/5/15", items: ["[Feature] 新增成绩册页面，支持多种视图、导出成绩为 excel 表格"] },
  { version: "v1.3.3", date: "2024/5/11", items: ["[Feature] 可以给课程作业绑定多个文件，便于预览作业要求"] },
  { version: "v1.3.2", date: "2024/5/10", items: ["[Fix] 修复主副屏播放速度不同步", "[Feature] 新增 CHANGE LOG 板块"] },
];

export function ChangeLogModal({
  open,
  onCancel,
  onOk,
}: {
  open: boolean;
  onCancel: () => void;
  onOk: () => void;
}) {
  const theme = useTheme();
  const latest = changeLogs[0];

  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="lg">
      <DialogTitle sx={{ pb: 0 }}>
        <Stack spacing={2}>
          <Box
            sx={{
              p: { xs: 2, md: 2.5 },
              borderRadius: "24px",
              background:
                theme.palette.mode === "dark"
                  ? `linear-gradient(135deg, ${alpha(
                      theme.palette.primary.main,
                      0.18
                    )}, ${alpha("#0f172a", 0.92)})`
                  : `linear-gradient(135deg, ${alpha(
                      theme.palette.primary.main,
                      0.12
                    )}, rgba(255,255,255,0.96))`,
              border: "1px solid",
              borderColor: alpha(theme.palette.primary.main, 0.12),
            }}
          >
            <Stack spacing={1.25}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Chip
                  icon={<MenuBookRoundedIcon />}
                  label="Product Journal"
                  color="primary"
                  variant="outlined"
                />
                <Chip
                  icon={<UpdateRoundedIcon />}
                  label={`${changeLogs.length} 次记录`}
                  variant="outlined"
                />
              </Stack>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>
                更新日志
              </Typography>
              <Typography variant="body2" color="text.secondary">
                这里按时间线记录 Canvas Helper 的功能演进、修复和体验改进。
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                <Card
                  sx={{
                    minWidth: 0,
                    flex: 1,
                    borderRadius: "20px",
                    border: "1px solid",
                    borderColor: alpha(theme.palette.divider, 0.5),
                    boxShadow: "none",
                    backgroundColor: alpha(theme.palette.background.paper, 0.82),
                  }}
                >
                  <CardContent sx={{ p: 2 }}>
                    <Typography variant="overline" color="text.secondary">
                      最新版本
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800, mt: 0.75 }}>
                      {latest.version}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {latest.date}
                    </Typography>
                  </CardContent>
                </Card>
                <Card
                  sx={{
                    minWidth: 0,
                    flex: 1,
                    borderRadius: "20px",
                    border: "1px solid",
                    borderColor: alpha(theme.palette.divider, 0.5),
                    boxShadow: "none",
                    backgroundColor: alpha(theme.palette.background.paper, 0.82),
                  }}
                >
                  <CardContent sx={{ p: 2 }}>
                    <Typography variant="overline" color="text.secondary">
                      本期导读
                    </Typography>
                    <Stack spacing={0.5} sx={{ mt: 0.75 }}>
                      {latest.items.slice(0, 2).map((item, index) => (
                        <Typography key={index} variant="body2">
                          {typeof item === "string" ? item : item}
                        </Typography>
                      ))}
                    </Stack>
                  </CardContent>
                </Card>
              </Stack>
            </Stack>
          </Box>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ pt: 3 }}>
        <Stack spacing={2}>
          {changeLogs.map((log, index) => (
            <Card
              key={`${log.version}-${log.date}`}
              sx={{
                borderRadius: "24px",
                border: "1px solid",
                borderColor:
                  index === 0
                    ? alpha(theme.palette.primary.main, 0.2)
                    : alpha(theme.palette.divider, 0.6),
                boxShadow:
                  index === 0
                    ? `0 18px 40px ${alpha(theme.palette.primary.main, 0.12)}`
                    : "none",
                backgroundImage: "none",
              }}
            >
              <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
                <Stack spacing={1.5}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    justifyContent="space-between"
                    spacing={1}
                  >
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="h6" sx={{ fontWeight: 800 }}>
                        {log.version}
                      </Typography>
                      {index === 0 ? (
                        <Chip
                          size="small"
                          color="primary"
                          icon={<AutoAwesomeRoundedIcon />}
                          label="Latest"
                        />
                      ) : null}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {log.date}
                    </Typography>
                  </Stack>

                  <Divider />

                  <Stack component="ul" spacing={1.15} sx={{ m: 0, pl: 2.5 }}>
                    {log.items.map((item, itemIndex) => (
                      <Typography
                        key={itemIndex}
                        component="li"
                        variant="body2"
                        sx={{ color: "text.secondary", lineHeight: 1.8 }}
                      >
                        {item}
                      </Typography>
                    ))}
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={onCancel}>关闭</Button>
        <Button variant="contained" onClick={onOk}>
          我知道了
        </Button>
      </DialogActions>
    </Dialog>
  );
}
