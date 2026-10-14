import { invoke } from "@tauri-apps/api/core";
import { Dialog, DialogContent, DialogTitle } from "@mui/material";
import { useEffect, useState } from "react";
import ReactAnsi from "react-ansi";

import { LOG_LEVEL_ERROR } from "../lib/model";
import { consoleLog } from "../lib/utils";

export default function LogModal({ onClose }: { onClose: () => void }) {
  const [log, setLog] = useState<string>("");

  useEffect(() => {
    const init = async () => {
      try {
        const value = (await invoke("read_log_content")) as string;
        setLog(value);
      } catch (e) {
        consoleLog(LOG_LEVEL_ERROR, e);
      }
    };
    void init();
  }, []);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>日志详情</DialogTitle>
      <DialogContent dividers>
        {log ? (
          <ReactAnsi
            log={log}
            bodyStyle={{ height: "100%", overflowY: "auto" }}
            logStyle={{ height: "80vh" }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
