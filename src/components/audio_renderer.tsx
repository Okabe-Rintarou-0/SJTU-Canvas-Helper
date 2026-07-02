import AudioFileRoundedIcon from "@mui/icons-material/AudioFileRounded";
import { Box, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { DocRendererProps } from "@cyntler/react-doc-viewer";

const mimeMap: Record<string, string> = {
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  flac: "audio/flac",
  aac: "audio/aac",
  m4a: "audio/mp4",
  wma: "audio/x-ms-wma",
};

export default function AudioRenderer({
  mainState: { currentDocument },
}: DocRendererProps) {
  const theme = useTheme();
  if (!currentDocument?.uri) return null;

  const ext = currentDocument.fileType?.toLowerCase() ?? "";
  const mimeType = mimeMap[ext] ?? "audio/mpeg";

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        display: "grid",
        placeItems: "center",
        p: { xs: 2, md: 3 },
        minHeight: 260,
        background:
          theme.palette.mode === "dark"
            ? "linear-gradient(180deg, rgba(2,6,23,0.96) 0%, rgba(15,23,42,0.88) 100%)"
            : "linear-gradient(180deg, rgba(241,245,249,0.9) 0%, rgba(226,232,240,0.82) 100%)",
      }}
    >
      <Box
        sx={{
          width: "100%",
          maxWidth: 480,
          p: 3,
          borderRadius: "28px",
          border: "1px solid",
          borderColor: alpha(theme.palette.divider, 0.5),
          background: alpha(theme.palette.background.paper, 0.6),
          backdropFilter: "blur(8px)",
          textAlign: "center",
        }}
      >
        <AudioFileRoundedIcon
          sx={{ fontSize: 48, color: "primary.main", mb: 1.5 }}
        />
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }} noWrap>
          {currentDocument.fileName}
        </Typography>
        <Box
          component="audio"
          controls
          preload="metadata"
          sx={{ width: "100%", borderRadius: "14px" }}
        >
          <source src={currentDocument.uri} type={mimeType} />
          您的浏览器暂不支持此音频格式预览。
        </Box>
      </Box>
    </Box>
  );
}

AudioRenderer.fileTypes = Object.keys(mimeMap);
AudioRenderer.weight = 1;
