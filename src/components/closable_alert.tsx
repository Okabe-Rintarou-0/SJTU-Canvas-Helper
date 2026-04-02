import { Alert, Checkbox, FormControlLabel, Stack } from "@mui/material";
import { ReactNode, useEffect, useState } from "react";

import { getConfig, saveConfig } from "../lib/config";
import { LOG_LEVEL_INFO } from "../lib/model";
import { consoleLog } from "../lib/utils";

export interface ClosableAlertProps {
  configKey: string;
  alertType: "success" | "info" | "warning" | "error";
  message: ReactNode;
  description?: ReactNode;
}

export default function ClosableAlert(props: ClosableAlertProps) {
  const [show, setShow] = useState<boolean>(false);

  useEffect(() => {
    getConfig(true).then((config) => {
      consoleLog(LOG_LEVEL_INFO, config);
      if (
        !config.show_alert_map.hasOwnProperty(props.configKey) ||
        config.show_alert_map[props.configKey]
      ) {
        setShow(true);
      }
    });
  }, [props.configKey]);

  const notShowAgain = () => {
    getConfig(true).then((config) => {
      config.show_alert_map[props.configKey] = false;
      saveConfig(config);
      setShow(false);
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
