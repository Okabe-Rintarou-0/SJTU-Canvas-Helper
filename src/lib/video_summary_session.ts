import { Channel, invoke } from "@tauri-apps/api/core";
import { AISessionStore, aiMessage, aiPayload } from "./ai_session_store";
import { isAccountTransitioning } from "./account_transition";
import type { CanvasAgentChatMessage, LLMChatMessage } from "./model";
import { hasVideoMaterial, recordingKey, type VideoMaterial, type VideoSession } from "./video_library";
import { recordingRequest } from "./video_library_tasks";
import { deleteSummaryCache, readSummaryCache, summaryCacheKey, writeSummaryCache, PPT_CLEANUP_POLICY, type VideoSummaryCache, type VideoPreparedContext, type VideoChatResponse } from "./video_summary_cache";
import { videoSummaryOptions, type VideoSummaryOptions } from "./video_summary_config";

import { currentDataAccount } from "./app_data";

interface SummaryState {
  open: boolean;
  title: string;
  scopes: VideoSession[];
  messages: CanvasAgentChatMessage[];
  loading: boolean;
  progress: string;
  coverage: string;
  input: string;
  text: string;
  namespace: string;
  organization: string;
  cacheEntry?: VideoSummaryCache;
  cacheNotice: string;
  summaryOptions: VideoSummaryOptions;
  preparedContext?: VideoPreparedContext;
}

interface SummaryRequest {
  scopes: VideoSession[];
  organization: string;
  namespace: string;
  title: string;
  cleanUpPpt: boolean;
  force?: boolean;
  summaryOptions?: VideoSummaryOptions;
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("请求超时，请刷新重试")), 30_000);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

export class VideoSummarySession extends AISessionStore<SummaryState> {
  private materialCache = new Map<string, VideoMaterial>();
  private storageAccount?: string;

  constructor() {
    super(() => ({ open: false, title: "", scopes: [], messages: [], loading: false, progress: "", coverage: "",
      input: "", text: "", namespace: "", organization: "sessions", cacheNotice: "", summaryOptions: videoSummaryOptions() }));
  }

  clearMaterials = () => { this.materialCache.clear(); };
  override reset() {
    this.clearMaterials();
    this.storageAccount = undefined;
    super.reset();
  }

  restore = (entry: VideoSummaryCache, scopes = entry.scopes, account?: string) => {
    if (this.state.loading) return;
    this.storageAccount = account;
    this.generation++;
    this.update({ cacheEntry: { ...entry, scopes }, namespace: entry.namespace, title: entry.title, scopes,
      messages: entry.messages, organization: entry.organization, text: entry.text, coverage: entry.coverage,
      summaryOptions: entry.summaryOptions ?? videoSummaryOptions(), preparedContext: entry.preparedContext,
      input: "", open: true, progress: "", cacheNotice: `已读取本地历史 · ${new Date(entry.savedAt).toLocaleString("zh-CN")}` });
  };

  deleteCache = async () => {
    if (this.state.loading || !this.state.cacheEntry) return false;
    const key = this.state.cacheEntry.key;
    const generation = ++this.generation;
    this.update({ loading: true, progress: "正在删除本地历史" });
    try {
      if (!await deleteSummaryCache(key, this.storageAccount)) return false;
      if (generation === this.generation) this.update({ cacheEntry: undefined, cacheNotice: "本地历史已删除，当前会话仍可阅读" });
      return true;
    } finally {
      if (generation === this.generation) this.update({ loading: false, progress: "" });
    }
  };

  private async persist(entry: VideoSummaryCache, generation: number) {
    const saved = !!entry.namespace && await writeSummaryCache(entry, this.storageAccount);
    if (generation !== this.generation) return;
    this.update({ cacheEntry: entry, cacheNotice: saved
      ? `已保存到本地 · ${new Date(entry.savedAt).toLocaleString("zh-CN")}`
      : "本次结果保留在当前应用会话中，未能保存到应用数据目录" });
  }

  private async requestChat(messages: LLMChatMessage[], history: CanvasAgentChatMessage[], generation: number, prefix = "") {
    const response = aiMessage("assistant", prefix, { pending: true });
    let content = "";
    const onChunk = new Channel<string>();
    onChunk.onmessage = (chunk) => {
      if (generation !== this.generation || !this.state.loading) return;
      content += chunk;
      this.update({ progress: "正在生成正文", messages: [...history, { ...response, content: prefix + content }] });
    };
    const onStatus = new Channel<string>();
    onStatus.onmessage = (progress) => {
      if (generation === this.generation && this.state.loading) this.update({ progress });
    };
    const result = await invoke<VideoChatResponse | string>("chat_video_materials", { text: this.state.text, messages,
      options: this.state.summaryOptions, preparedContext: this.state.preparedContext, onChunk, onStatus });
    // Accept older backends during development/hot reload; current backend returns preparation metadata.
    const reply = typeof result === "string" ? { content: result } : result;
    if (!reply.content.trim()) throw new Error("模型未返回有效正文，请重试");
    if (generation === this.generation) this.update({ preparedContext: reply.preparedContext ?? undefined });
    return reply.content;
  }

  start = async ({ scopes, organization, namespace, title, cleanUpPpt, force = false, summaryOptions = videoSummaryOptions() }: SummaryRequest) => {
    if (isAccountTransitioning() || this.state.loading || !scopes.length) return;
    namespace = namespace.replace(/:ppt-(?:animation|cleanup)(?:-v\d+)?=[01]$/, `:${PPT_CLEANUP_POLICY}=${Number(cleanUpPpt)}`);
    summaryOptions = { ...summaryOptions, prompt: summaryOptions.prompt.trim() || videoSummaryOptions().prompt };
    const key = summaryCacheKey(namespace, scopes, organization, summaryOptions);
    if (force) this.clearMaterials();
    const generation = ++this.generation;
    const prompt = organization === "sessions"
      ? `请逐堂总结所选课堂，每堂课内综合所有小节的字幕与 PPT OCR。\n课堂总结要求：\n${summaryOptions.prompt}`
      : `请综合总结全部所选小节的字幕与 PPT OCR。\n课堂总结要求：\n${summaryOptions.prompt}`;
    const opening = aiMessage("user", prompt);
    this.update({ cacheEntry: undefined, namespace, cacheNotice: "", title, scopes, organization,
      summaryOptions, preparedContext: undefined,
      messages: [opening], coverage: "", text: "", input: "", loading: true, open: true, progress: "正在准备资料" });
    try {
      this.storageAccount = await currentDataAccount();
      if (generation !== this.generation) return;
      let history: VideoSummaryCache[] = [];
      try { history = await readSummaryCache(this.storageAccount); }
      catch (error) { this.update({ cacheNotice: `读取历史失败：${error}；新结果仍会尝试保存` }); }
      if (generation !== this.generation) return;
      const cached = !force && history.find((entry) => entry.key === key);
      if (cached) {
        this.update({ loading: false });
        this.restore(cached, scopes, this.storageAccount);
        return;
      }
      const entries = scopes.flatMap((session) => session.videos.map((video, i) => ({ video, title: `${session.title} · ${video.courseBeginTime || `小节 ${i + 1}`}` })));
      const materials: VideoMaterial[] = [];
      for (const [index, entry] of entries.entries()) {
        if (generation !== this.generation) return;
        this.update({ progress: `正在读取字幕与 PPT OCR ${index + 1}/${entries.length}` });
        const materialKey = `${namespace}:${recordingKey(entry.video)}:${PPT_CLEANUP_POLICY}=${cleanUpPpt}`;
        let material = this.materialCache.get(materialKey);
        if (!material) {
          try { material = await withTimeout(invoke<VideoMaterial>("prepare_video_material", { request: recordingRequest(entry.video, entry.title), cleanUpPpt })); }
          catch (e) { material = { key: recordingKey(entry.video), title: entry.title, text: "", srt: "", subtitleAvailable: false, warnings: [`${entry.title}：${e}`] }; }
          if (generation !== this.generation) return;
          if (hasVideoMaterial(material) && !material.warnings.length) this.materialCache.set(materialKey, material);
        }
        materials.push(material);
      }
      if (generation !== this.generation) return;
      const available = materials.filter(hasVideoMaterial);
      const warnings = materials.flatMap((item) => item.warnings);
      const report = `${materials.filter((item) => item.subtitleAvailable).length}/${entries.length} 小节字幕可用；${materials.filter((item) => item.ocrAvailable).length}/${entries.length} 小节 PPT OCR 可用${warnings.length ? `；资料提示：${warnings.join("；")}` : ""}${available.length < entries.length ? `；未覆盖小节：${materials.filter((item) => !hasVideoMaterial(item)).map((item) => item.title).join("；")}` : "；覆盖全部所选小节"}`;
      this.update({ coverage: report });
      if (!available.length) throw new Error("所选小节均无可用字幕或 PPT OCR，无法生成总结");
      const text = `${report}\n\n${available.map((item) => item.text).join("\n\n")}`;
      this.update({ text, progress: "正在准备总结" });
      const result = await this.requestChat([{ role: "user", content: prompt }], [opening], generation, `${report}\n\n`);
      if (generation !== this.generation) return;
      const messages = [opening, aiMessage("assistant", `${report}\n\n${result}`)];
      this.update({ messages });
      await this.persist({ key, namespace, title, scopes, organization, messages, text, coverage: report,
        summaryOptions, preparedContext: this.state.preparedContext, savedAt: new Date().toISOString() }, generation);
    } catch (e) {
      if (generation === this.generation) this.update({ messages: [opening, aiMessage("assistant", `总结失败：${e}`, { error: true })] });
    } finally {
      if (generation === this.generation) this.update({ loading: false, progress: "" });
    }
  };

  send = async (content: string) => {
    if (isAccountTransitioning() || this.state.loading || !this.state.text || !content.trim()) return;
    const generation = ++this.generation;
    const next = [...this.state.messages, aiMessage("user", content.trim())];
    this.update({ messages: next, loading: true, progress: "正在准备回答", input: "" });
    try {
      const result = await this.requestChat(aiPayload(next), next, generation);
      if (generation !== this.generation) return;
      const messages = [...next, aiMessage("assistant", result)];
      this.update({ messages });
      if (this.state.cacheEntry) await this.persist({ ...this.state.cacheEntry, messages, preparedContext: this.state.preparedContext, savedAt: new Date().toISOString() }, generation);
    } catch (e) {
      if (generation === this.generation) this.update({ messages: [...next, aiMessage("assistant", `回答失败：${e}`, { error: true })] });
    } finally {
      if (generation === this.generation) this.update({ loading: false, progress: "" });
    }
  };
}

export const videoSummarySession = new VideoSummarySession();
