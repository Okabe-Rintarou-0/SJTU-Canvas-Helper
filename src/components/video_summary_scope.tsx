import { Box, Stack, Typography } from "@mui/material";
import type { VideoSession } from "../lib/video_library";
import { recordingKey } from "../lib/video_library";

/** Use the saved recordings, not their positions in a potentially partial selection. */
export default function VideoSummaryScope({ scopes }: { scopes: VideoSession[] }) {
  return <Stack spacing={1} aria-label="总结小节范围">
    {scopes.map((scope) => <Box key={scope.id}>
      <Typography variant="body2" fontWeight={600} sx={{ overflowWrap: "anywhere" }}>{scope.title}</Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {scope.videos.map((video) => <Box component="li" key={recordingKey(video)}>
          <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>{video.videoName || `录像 ${video.videoId}`}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
            {video.courseBeginTime || "开始时间待确认"} — {video.courseEndTime || "结束时间待确认"}
          </Typography>
        </Box>)}
      </Box>
    </Box>)}
  </Stack>;
}
