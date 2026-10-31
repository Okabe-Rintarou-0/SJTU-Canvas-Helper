import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import type { PlaybackProxyError } from "../lib/playback_proxy";
import PlaybackProxySettingsLink from "./playback_proxy_settings_link";

export default function PlaybackProxyAlert({ error, onRetry, retryLabel = "重试" }: {
  error: PlaybackProxyError; onRetry: () => void; retryLabel?: string;
}) {
  return <Alert severity="error" sx={{ "& .MuiAlert-message": { minWidth: 0, width: "100%" } }}>
    {error.message}
    <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 1 }}>
      <PlaybackProxySettingsLink />
      <Button size="small" onClick={onRetry}>{retryLabel}</Button>
    </Stack>
    <Box component="details" sx={{ mt: 1 }}>
      <Box component="summary" sx={{ cursor: "pointer", typography: "caption" }}>技术详情</Box>
      <Typography component="pre" variant="caption" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", mb: 0 }}>
        {error.details}
      </Typography>
    </Box>
  </Alert>;
}
