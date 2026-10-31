import {
  Alert,
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  ListItemText,
  Link,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from "@mui/material";
import ArrowDropDownRoundedIcon from "@mui/icons-material/ArrowDropDownRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import { check } from "@tauri-apps/plugin-updater";
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { useAppMessage } from "./message";
import { checkForUpdates } from "./utils";
import { getCumulativeChanges, ReleaseChangeLog } from "./update_changelog";
import localChangeLogs from "./change_logs.json";
import { version as appVersion } from "../../package.json";

const NEVER_REMIND_KEY = "sjtu-canvas-helper:update-notice:never-remind";
const SKIPPED_VERSION_KEY = "sjtu-canvas-helper:update-notice:skipped-version";

function readNoticePreference(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeNoticePreference(key: string, value: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch (error) {
    console.warn("Failed to save update reminder preference", error);
  }
}

interface UpdateNoticeContextValue {
  availableVersion: string | null;
  setAvailableVersion: (version: string | null) => void;
  previewOnly: boolean;
}

const UpdateNoticeContext = createContext<UpdateNoticeContextValue | null>(null);

export function UpdateNoticeProvider({ children }: { children: ReactNode }) {
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [changesExpanded, setChangesExpanded] = useState(false);
  const [releaseInfo, setReleaseInfo] = useState<{
    currentVersion: string;
    body?: string;
    logs?: unknown;
  }>({ currentVersion: appVersion });
  const [reminderMenuAnchor, setReminderMenuAnchor] = useState<HTMLElement | null>(null);
  const [neverRemind, setNeverRemind] = useState(
    () => readNoticePreference(NEVER_REMIND_KEY) === "true"
  );
  const [skippedVersion, setSkippedVersion] = useState(() =>
    readNoticePreference(SKIPPED_VERSION_KEY)
  );
  const [messageApi] = useAppMessage();
  const [previewVersion] = useState<string | null>(() => {
    if (!import.meta.env.DEV) return null;
    const envVersion = import.meta.env.VITE_MOCK_UPDATE_VERSION?.trim();
    const queryVersion = new URLSearchParams(window.location.search)
      .get("mockUpdate")
      ?.trim();
    return envVersion || queryVersion || null;
  });
  const allowDowngradePreview =
    import.meta.env.DEV && import.meta.env.VITE_UPDATE_CHECK_PREVIEW === "true";
  const previewOnly = previewVersion !== null || allowDowngradePreview;
  const isNoticeSuppressed = Boolean(
    availableVersion &&
      (neverRemind || skippedVersion === availableVersion)
  );

  const closePrompt = () => {
    setShowUpdatePrompt(false);
    setReminderMenuAnchor(null);
  };

  const skipUntilNextVersion = () => {
    if (!availableVersion) return;
    writeNoticePreference(SKIPPED_VERSION_KEY, availableVersion);
    setSkippedVersion(availableVersion);
    setShowUpdatePrompt(false);
  };

  const neverRemindAgain = () => {
    writeNoticePreference(NEVER_REMIND_KEY, "true");
    setNeverRemind(true);
    setShowUpdatePrompt(false);
  };

  useEffect(() => {
    if (previewVersion) {
      setAvailableVersion(previewVersion);
      setShowUpdatePrompt(true);
      return;
    }

    let cancelled = false;

    const checkOnStartup = async () => {
      try {
        const update = await check(
          allowDowngradePreview ? { allowDowngrades: true } : undefined
        );
        if (cancelled) {
          await update?.close();
          return;
        }

        setAvailableVersion(update?.version ?? null);
        if (update) {
          setReleaseInfo({
            currentVersion: update.currentVersion,
            body: update.body,
            logs: update.rawJson?.changelog,
          });
        }
        setShowUpdatePrompt(update !== null);
        await update?.close();
      } catch (error) {
        console.debug("Automatic update check failed", error);
      }
    };

    void checkOnStartup();
    return () => {
      cancelled = true;
    };
  }, [allowDowngradePreview, previewVersion]);

  const contextValue = useMemo(
    () => ({
      availableVersion: isNoticeSuppressed ? null : availableVersion,
      setAvailableVersion,
      previewOnly,
    }),
    [availableVersion, isNoticeSuppressed, previewOnly]
  );

  const changes: ReleaseChangeLog[] = availableVersion
    ? getCumulativeChanges(releaseInfo.currentVersion, availableVersion, releaseInfo.logs, localChangeLogs)
    : [];
  const hasTargetChanges = changes.some((log) =>
    log.version.replace(/^v/, "") === availableVersion?.replace(/^v/, "")
  );

  return (
    <UpdateNoticeContext.Provider value={contextValue}>
      {children}
      <Dialog
        open={showUpdatePrompt && !isNoticeSuppressed}
        onClose={closePrompt}
        aria-labelledby="update-notice-title"
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle id="update-notice-title">发现新版本</DialogTitle>
        <DialogContent>
          <Typography variant="body1">
            {previewOnly
              ? `预览 SJTU Canvas Helper v${availableVersion} 的更新提示，可展开查看累积更新内容。`
              : `检测到 SJTU Canvas Helper v${availableVersion}，可以立即下载安装。`}
          </Typography>
          {previewOnly ? (
            <Alert severity="info" sx={{ mt: 2 }}>
              当前为开发预览，只显示更新提示，不会下载或安装更新。
            </Alert>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              安装完成后应用会自动重启。
            </Typography>
          )}
          <Box sx={{ mt: 2 }}>
            <Button
              color="inherit"
              fullWidth
              aria-expanded={changesExpanded}
              aria-controls="update-notice-changes"
              onClick={() => setChangesExpanded((expanded) => !expanded)}
              endIcon={<ExpandMoreRoundedIcon sx={{ transform: changesExpanded ? "rotate(180deg)" : "none" }} />}
              sx={{ justifyContent: "space-between", px: 0, color: "text.secondary" }}
            >
              {changesExpanded ? "收起更新内容" : "查看更新内容"}
              {changes.length > 0 ? `（累计 ${changes.length} 个版本）` : ""}
            </Button>
            <Collapse in={changesExpanded} unmountOnExit>
              <Box
                id="update-notice-changes"
                role="region"
                aria-label="累积更新内容"
                tabIndex={0}
                sx={{ maxHeight: "min(320px, 40vh)", overflowY: "auto", overflowWrap: "anywhere", pr: 1, pt: 1 }}
              >
                <Typography variant="caption" color="text.secondary">
                  当前 v{releaseInfo.currentVersion} → v{availableVersion}，按版本倒序展示。
                </Typography>
                {!hasTargetChanges && (
                  <Box sx={{ mt: 1.5 }}>
                    {releaseInfo.body?.trim() && (
                      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mb: 1 }}>
                        {releaseInfo.body}
                      </Typography>
                    )}
                    <Typography variant="body2" color="text.secondary">
                      此版本尚未提供完整的累积更新日志。
                      <Link
                        href={`https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/releases/tag/app-v${encodeURIComponent(availableVersion?.replace(/^v/, "") ?? "")}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看发布说明
                      </Link>
                    </Typography>
                  </Box>
                )}
                <Stack spacing={2} sx={{ mt: 1.5 }}>
                  {changes.map((log) => (
                    <Box key={log.version}>
                      <Typography variant="subtitle2">{log.version} · {log.date}</Typography>
                      <Box component="ul" sx={{ my: 0.75, pl: 2.5 }}>
                        {log.items.map((item, index) => (
                          <Typography key={index} component="li" variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
                            {item}
                          </Typography>
                        ))}
                      </Box>
                    </Box>
                  ))}
                </Stack>
              </Box>
            </Collapse>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, pt: 0.5 }}>
          <Button
            size="small"
            color="inherit"
            aria-haspopup="menu"
            aria-expanded={Boolean(reminderMenuAnchor)}
            onClick={(event) => setReminderMenuAnchor(event.currentTarget)}
            endIcon={<ArrowDropDownRoundedIcon />}
            sx={{ mr: "auto", color: "text.secondary" }}
          >
            提醒选项
          </Button>
          <Button onClick={closePrompt}>稍后</Button>
          <Button
            variant="contained"
            disabled={previewOnly}
            onClick={() => {
              setShowUpdatePrompt(false);
              void checkForUpdates(messageApi, setAvailableVersion);
            }}
          >
            {previewOnly ? "仅预览" : "立即更新"}
          </Button>
        </DialogActions>
      </Dialog>
      <Menu
        anchorEl={reminderMenuAnchor}
        open={Boolean(reminderMenuAnchor)}
        onClose={() => setReminderMenuAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <MenuItem
          onClick={() => {
            setReminderMenuAnchor(null);
            skipUntilNextVersion();
          }}
        >
          <ListItemText
            primary="跳过此版本"
            secondary="新版本发布后再提醒"
          />
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            setReminderMenuAnchor(null);
            neverRemindAgain();
          }}
        >
          <ListItemText
            primary="永不提醒"
            secondary="关闭自动更新提醒"
          />
        </MenuItem>
      </Menu>
    </UpdateNoticeContext.Provider>
  );
}

export function useUpdateNotice() {
  const context = useContext(UpdateNoticeContext);
  if (!context) {
    throw new Error("useUpdateNotice must be used within UpdateNoticeProvider");
  }
  return context;
}
