import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import { BASE_URL, JI_BASE_URL } from "../lib/constants";
import type { AppConfig } from "../lib/model";

type AccountType = AppConfig["account_type"];

export function CanvasTokenGuideContent({ accountType = "Default" }: { accountType?: AccountType }) {
  const settingsUrl = `${accountType === "JI" ? JI_BASE_URL : BASE_URL}/profile/settings`;
  return (
    <Stack spacing={2}>
      <Box component="ol" sx={{ m: 0, pl: 3, "& > li": { pl: 0.5, mb: 2 }, "& > li:last-child": { mb: 0 }, "& > li::marker": { color: "primary.main", fontWeight: 700 } }}>
        <li>
          <Typography fontWeight={700}>打开 Canvas 个人设置</Typography>
          <Typography variant="body2" color="text.secondary">
            点击下方按钮并登录。若进入了 Canvas 首页，点击左侧的“账号 → 设置”（Account → Settings）。
          </Typography>
          <Button component="a" href={settingsUrl} target="_blank" rel="noreferrer" variant="outlined" size="small"
            endIcon={<OpenInNewRoundedIcon />} sx={{ mt: 1 }}>
            打开 Canvas 个人设置
          </Button>
        </li>
        <li>
          <Typography fontWeight={700}>点击“创建新访问许可证”</Typography>
          <Typography variant="body2" color="text.secondary">
            向下滚动至“允许融入使用的外部软件”（Approved Integrations），点击“+ 创建新访问许可证”（New Access Token）。
          </Typography>
        </li>
        <li>
          <Typography fontWeight={700}>填写用途并生成 Token</Typography>
          <Typography variant="body2" color="text.secondary">
            在“用途”（Purpose）中填写 SJTU Canvas Helper，按页面要求设置过期时间，然后点击生成按钮（Generate Token）。
          </Typography>
        </li>
        <li>
          <Typography fontWeight={700}>复制 Token，返回应用填写</Typography>
          <Typography variant="body2" color="text.secondary">
            生成后立即复制完整的 Token，粘贴到本页的“Canvas Token”输入框。点击“测试 Canvas Token”确认连接，再点击“保存全部设置”。
          </Typography>
        </li>
      </Box>
      <Box component="details" sx={{ color: "text.secondary", fontSize: "0.875rem", "& > summary": { cursor: "pointer", color: "primary.main" } }}>
        <summary>查看创建按钮的位置示意</summary>
        <Box component="img" src="/help.png" alt="Canvas 个人设置页面下方的“创建新访问许可证”按钮，已用红框标出"
          sx={{ display: "block", width: "100%", mt: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }} />
      </Box>
      <Typography variant="caption" color="text.secondary">
        Token 可用于访问你的 Canvas 数据，请勿将它发到聊天、截图或公开的 Issue 中。
      </Typography>
    </Stack>
  );
}

export default function CanvasTokenGuideDialog({ open, accountType, onClose, onExited }: {
  open: boolean;
  accountType?: AccountType;
  onClose: () => void;
  onExited: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="canvas-token-guide-title"
      slotProps={{ transition: { onExited } }}>
      <DialogTitle id="canvas-token-guide-title">获取 Canvas Token</DialogTitle>
      <DialogContent dividers><CanvasTokenGuideContent accountType={accountType} /></DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button variant="contained" onClick={onClose}>返回填写 Token</Button>
      </DialogActions>
    </Dialog>
  );
}
