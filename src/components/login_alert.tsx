import QrCode2RoundedIcon from "@mui/icons-material/QrCode2Rounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";

function createQRCodePreview(value: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(value)}`;
}

export function LoginAlert({
  qrcode,
  refreshQRCode,
}: {
  qrcode: string;
  refreshQRCode: () => void;
}) {
  const theme = useTheme();

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: "24px",
        borderColor: alpha(theme.palette.primary.main, 0.16),
        bgcolor: alpha(theme.palette.background.paper, 0.86),
      }}
    >
      <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={{ xs: 2.5, md: 3 }}
          alignItems={{ xs: "stretch", md: "center" }}
        >
          <Stack
            spacing={1.5}
            sx={{ flex: 1, minWidth: 0, justifyContent: "center" }}
          >
            <Stack direction="row" spacing={1.25} alignItems="center">
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: "14px",
                  display: "grid",
                  placeItems: "center",
                  bgcolor: alpha(theme.palette.primary.main, 0.12),
                  color: "primary.main",
                }}
              >
                <QrCode2RoundedIcon />
              </Box>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                  使用手机扫码登录
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  登录后即可使用依赖额外登录态的视频等功能。
                </Typography>
              </Box>
            </Stack>

            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <Chip size="small" label="1. 打开手机微信" />
              <Chip size="small" label="2. 扫码确认" />
              <Chip size="small" label="3. 自动完成绑定" />
            </Stack>

            <Box>
              <Button
                variant="outlined"
                startIcon={<RefreshRoundedIcon />}
                onClick={refreshQRCode}
              >
                刷新二维码
              </Button>
            </Box>
          </Stack>

          <Box
            sx={{
              width: { xs: "100%", md: 300 },
              display: "flex",
              justifyContent: "center",
            }}
          >
            <Box
              sx={{
                p: 1.5,
                borderRadius: "28px",
                bgcolor: "#fff",
                boxShadow: "0 24px 56px rgba(15, 23, 42, 0.12)",
                border: "1px solid rgba(148, 163, 184, 0.18)",
              }}
            >
              <Box
                component="img"
                src={createQRCodePreview(qrcode)}
                alt="登录二维码"
                sx={{
                  width: { xs: "100%", md: 268 },
                  maxWidth: 320,
                  aspectRatio: "1 / 1",
                  display: "block",
                  borderRadius: "20px",
                  bgcolor: "#fff",
                }}
              />
            </Box>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
