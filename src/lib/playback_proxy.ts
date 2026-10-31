import { invoke } from "@tauri-apps/api/core";

export const PLAYBACK_PROXY_SETTINGS_URL = "/settings?focus=proxy-port";

export class PlaybackProxyError extends Error {
  constructor(port: number, public readonly details: string) {
    super(`播放代理端口 ${port} 无法使用，请更换端口后重试。`);
  }
}

export async function preparePlaybackProxy(port: number): Promise<void> {
  try {
    if (!await invoke<boolean>("prepare_proxy")) {
      throw new Error("播放代理启动检查未通过");
    }
  } catch (error) {
    throw new PlaybackProxyError(port, String(error));
  }
}
