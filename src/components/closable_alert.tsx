import { Alert, Checkbox, FormControlLabel, Stack } from "@mui/material";
import { ReactNode, useEffect, useState } from "react";

import { getConfig, saveConfig, StaleConfigSessionError } from "../lib/config";
import { currentSession, isSessionCurrent } from "../lib/session";

export interface ClosableAlertProps {
  configKey: string;
  alertType: "success" | "info" | "warning" | "error";
  message: ReactNode;
  description?: ReactNode;
}

export default function ClosableAlert(props: ClosableAlertProps) {
  const [show, setShow] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    const session = currentSession();
    void getConfig(true).then((config) => {
      if (cancelled || !isSessionCurrent(session)) return;
      setShow(!Object.prototype.hasOwnProperty.call(config.show_alert_map, props.configKey) ||
        Boolean(config.show_alert_map[props.configKey]));
    }).catch((error: unknown) => {
      if (cancelled || !isSessionCurrent(session) || error instanceof StaleConfigSessionError) return;
      console.error("Failed to load alert configuration", error);
    });
    return () => { cancelled = true; };
  }, [props.configKey]);

  const notShowAgain = () => {
    const session = currentSession();
    void getConfig(true).then(async (config) => {
      if (!isSessionCurrent(session)) return;
      await saveConfig({
        ...config,
        show_alert_map: { ...config.show_alert_map, [props.configKey]: false },
      });
      if (isSessionCurrent(session)) setShow(false);
    }).catch((error: unknown) => {
      if (!isSessionCurrent(session) || error instanceof StaleConfigSessionError) return;
      console.error("Failed to save alert configuration", error);
    });
  };

  if (!show) {
    return null;
  }

  return (
    <Alert
      severity={props.alertType}
      sx={{ borderRadius: "20px" }}
      onClose={() => setShow(false)}
    >
      <Stack spacing={1.5}>
        <div>{props.message}</div>
        {props.description ? <div>{props.description}</div> : null}
        <FormControlLabel
          control={<Checkbox size="small" onChange={notShowAgain} />}
          label="不再显示"
        />
      </Stack>
    </Alert>
  );
}
