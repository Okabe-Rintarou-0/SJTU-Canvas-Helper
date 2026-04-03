import MovieRoundedIcon from "@mui/icons-material/MovieRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import { DocRendererProps } from "@cyntler/react-doc-viewer";
import { Box, Button, Stack, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import RendererShell from "./renderer_shell";

const supportedMimeMap: Record<string, string> = {
  mov: "video/quicktime",
  qt: "video/quicktime",
  "video/quicktime": "video/quicktime",
  "video/mov": "video/quicktime",
  mp4: "video/mp4",
  m4v: "video/mp4",
};

export default function MovRenderer({
  mainState: { currentDocument },
}: DocRendererProps) {
  const theme = useTheme();

  if (!currentDocument?.uri) {
    return null;
  }

  const fileType = currentDocument.fileType?.toLowerCase() ?? "mov";
  const mimeType = supportedMimeMap[fileType] ?? "video/quicktime";

  return (
    <RendererShell
      title={currentDocument.fileName ?? "Video"}
      subtitle="MOV video preview"
      fileType={fileType}
      icon={<MovieRoundedIcon />}
      actions={
        <Button
          size="small"
          variant="outlined"
          startIcon={<OpenInNewRoundedIcon />}
          component="a"
          href={currentDocument.uri}
          target="_blank"
          rel="noreferrer"
        >
          新窗口打开
        </Button>
      }
      contentSx={{
        display: "grid",
        placeItems: "center",
        p: { xs: 1.5, md: 2.5 },
        minHeight: 420,
        background:
          theme.palette.mode === "dark"
            ? "linear-gradient(180deg, rgba(2,6,23,0.96) 0%, rgba(15,23,42,0.88) 100%)"
            : "linear-gradient(180deg, rgba(241,245,249,0.9) 0%, rgba(226,232,240,0.82) 100%)",
      }}
    >
      <Stack spacing={2} sx={{ width: "100%", height: "100%" }}>
        <Box
          sx={{
            flex: 1,
            minHeight: 360,
            borderRadius: "22px",
            overflow: "hidden",
            border: "1px solid",
            borderColor: alpha(theme.palette.common.white, theme.palette.mode === "dark" ? 0.08 : 0.72),
            background:
              theme.palette.mode === "dark"
                ? "radial-gradient(circle at top, rgba(37,99,235,0.12), transparent 40%), #020617"
                : "radial-gradient(circle at top, rgba(37,99,235,0.08), transparent 42%), #ffffff",
            boxShadow:
              theme.palette.mode === "dark"
                ? "0 24px 60px rgba(2,8,23,0.45)"
                : "0 24px 60px rgba(15,23,42,0.12)",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Box
            component="video"
            controls
            preload="metadata"
            sx={{
              width: "100%",
              height: "100%",
              bgcolor: "#000",
              objectFit: "contain",
            }}
          >
            <source src={currentDocument.uri} type={mimeType} />
            您的浏览器暂不支持此视频格式预览，请尝试下载后打开。
          </Box>
        </Box>

        <Typography variant="body2" color="text.secondary">
          支持直接播放 `.mov` 文件；如果系统编解码器不兼容，也可以使用右上角按钮在新窗口中打开。
        </Typography>
      </Stack>
    </RendererShell>
  );
}

MovRenderer.fileTypes = ["mov", "qt", "video/quicktime", "video/mov", "mp4", "m4v"];
MovRenderer.weight = 1;
