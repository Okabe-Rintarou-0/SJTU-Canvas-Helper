import { invoke } from "@tauri-apps/api/core";
import { Modal } from "antd";
import { useEffect, useState } from "react";
import { consoleLog } from "../lib/utils";
import { LOG_LEVEL_ERROR } from "../lib/model";
import ReactAnsi from "react-ansi";

export default function LogModal({ onClose }: { onClose: () => void }) {
  const [log, setLog] = useState<string>("");

  useEffect(() => {
    const init = async () => {
      try {
        const log = (await invoke("read_log_content")) as string;
        setLog(log);
      } catch (e) {
        consoleLog(LOG_LEVEL_ERROR, e);
      }
    };
    init();
  }, []);

  return (
    <Modal open title="日志详情" footer={null} onCancel={onClose} width={"80%"}>
      {log && (
        <ReactAnsi
          log={log}
          bodyStyle={{ height: "100%", overflowY: "auto" }}
          logStyle={{ height: "80%" }}
        />
      )}
    </Modal>
  );
}
