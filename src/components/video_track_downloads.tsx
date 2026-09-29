import { useEffect, useState } from "react";
import { Alert, Button, CircularProgress, Dialog, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import { enqueueVideoTrack, resolveRecording } from "../lib/video_library_tasks";
import type { CanvasVideo, VideoPlayInfo } from "../lib/model";

export default function VideoTrackDownloads({ video, onClose }: { video: CanvasVideo; onClose: () => void }) {
  const [tracks, setTracks] = useState<VideoPlayInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    void resolveRecording(video).then(({ info }) => { if (!cancelled) setTracks(info.videoPlayResponseVoList); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [video, retry]);
  return <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
    <DialogTitle><Stack direction="row" justifyContent="space-between" alignItems="center">选择机位下载<Button onClick={onClose}>关闭</Button></Stack></DialogTitle>
    <DialogContent><Stack spacing={2}>
      <Typography>{video.videoName}</Typography>
      <Typography variant="body2" color="text.secondary">保存到设置中的默认下载目录，可在下载任务中查看进度。</Typography>
      {loading && <CircularProgress size={24} />}
      {error && <Alert severity="error" action={<Button onClick={() => setRetry((value) => value + 1)}>重试</Button>}>{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}
      {tracks.map((track, index) => <Stack key={track.id} direction="row" justifyContent="space-between" alignItems="center"><Typography>机位 {index + 1}</Typography><Button variant="outlined" onClick={() => { enqueueVideoTrack(video, track, index); setNotice(`机位 ${index + 1} 已加入下载任务`); }}>下载机位 {index + 1}</Button></Stack>)}
    </Stack></DialogContent>
  </Dialog>;
}
