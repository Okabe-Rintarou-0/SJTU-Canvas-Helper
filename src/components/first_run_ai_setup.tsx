import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Alert, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import { ZHIYUAN_LLM_BASE_URL, ZHIYUAN_LLM_DEFAULT_MODEL, type AiDraft } from "../lib/llm_config";

export function FirstRunAiSetup({ draft, onChange, canImport, busy, onImportingChange }: {
  draft: AiDraft;
  onChange: (draft: AiDraft) => void;
  canImport: boolean;
  busy: boolean;
  onImportingChange: (busy: boolean) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const importKey = async () => {
    setConfirm(false);
    setError("");
    onImportingChange(true);
    try {
      const result = await invoke<{ status: "imported"; key: string } | { status: "no_login" | "not_found" | "unavailable" }>("read_zhiyuan_api_key");
      if (result.status === "imported") {
        onChange({
          ...draft,
          name: "",
          key: result.key,
          baseUrl: ZHIYUAN_LLM_BASE_URL,
          model: ZHIYUAN_LLM_DEFAULT_MODEL,
          modelEdited: true,
          imported: true,
        });
      } else {
        setError({
          no_login: "jAccount 登录态已失效。可以返回上一步重新登录，或手动填写 API Key。",
          not_found: "交我办已办事项中没有找到可导入的致远一号 API Key。你可以手动填写 API Key。",
          unavailable: "暂时无法读取交我办已办事项。你仍可以手动填写 API Key。",
        }[result.status]);
      }
    } catch {
      setError("暂时无法读取交我办已办事项。你仍可以手动填写 API Key。");
    } finally {
      onImportingChange(false);
    }
  };

  return <>
    <Card variant="outlined"><CardContent><Stack spacing={2}>
      <Typography variant="h6">AI 模型</Typography>
      <Typography variant="body2" color="text.secondary">
        在这里配置你的第一个 AI 模型。之后可以在「设置 → AI 与模型」中添加、编辑或切换模型。
      </Typography>
      {canImport && <Button variant="outlined" disabled={busy} onClick={() => setConfirm(true)} sx={{ alignSelf: "flex-start" }}>从交我办导入致远一号</Button>}
      {draft.imported && <Alert severity="success">已填入致远一号配置。选择「保存并继续」后生效。</Alert>}
      {error && <Alert severity="warning">{error}</Alert>}
      <TextField label="API Key" type="password" autoComplete="off" value={draft.key} disabled={busy} onChange={(event) => onChange({ ...draft, key: event.target.value, modelEdited: true, imported: false })} />
      <TextField label="接口地址" placeholder="https://models.sjtu.edu.cn/api/v1" value={draft.baseUrl} disabled={busy} onChange={(event) => {
        const baseUrl = event.target.value;
        const imported = draft.imported && baseUrl.trim().replace(/\/+$/, "") === ZHIYUAN_LLM_BASE_URL;
        onChange({ ...draft, baseUrl, modelEdited: true, imported, key: draft.imported && !imported ? "" : draft.key });
      }} />
      <TextField label="模型名称" value={draft.model} disabled={busy} onChange={(event) => onChange({ ...draft, model: event.target.value, modelEdited: true })} />
    </Stack></CardContent></Card>
    <Dialog open={confirm} onClose={() => setConfirm(false)} aria-labelledby="zhiyuan-import-title">
      <DialogTitle id="zhiyuan-import-title">允许读取致远一号申请结果？</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Canvas Helper 将使用本机已连接的 jAccount，从交我办「已办事项」查找「“致远一号”AI模型API申请（测试）」并读取该申请发放的 API Key。导入后可在此页检查模型配置，再保存到当前账号。
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setConfirm(false)}>取消</Button>
        <Button variant="contained" disabled={busy} onClick={() => void importKey()}>同意并导入</Button>
      </DialogActions>
    </Dialog>
  </>;
}
