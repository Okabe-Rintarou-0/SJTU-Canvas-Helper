import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  Typography,
} from "@mui/material";

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
  return (
    <Alert severity="warning" sx={{ borderRadius: "24px" }}>
      <Stack spacing={2}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          检测到您未登录，登录后才能继续使用这个功能
        </Typography>
        <Card variant="outlined" sx={{ borderRadius: "24px", bgcolor: "background.paper" }}>
          <CardContent>
            <Stack spacing={2} alignItems="center">
              <Box
                component="img"
                src={createQRCodePreview(qrcode)}
                alt="登录二维码"
                sx={{ width: 250, height: 250, borderRadius: "20px", bgcolor: "#fff", p: 1.5 }}
              />
              <Button
                variant="outlined"
                startIcon={<RefreshRoundedIcon />}
                onClick={refreshQRCode}
              >
                刷新
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Alert>
  );
}
