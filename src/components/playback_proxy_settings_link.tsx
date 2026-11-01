import { Button } from "@mui/material";
import { Link } from "react-router-dom";
import { PLAYBACK_PROXY_SETTINGS_URL } from "../lib/playback_proxy";

export default function PlaybackProxySettingsLink() {
  return <Button size="small" component={Link} to={PLAYBACK_PROXY_SETTINGS_URL}>配置播放代理端口</Button>;
}
