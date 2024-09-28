import { Alert, Radio, Space } from "antd";
import { ReactNode, useEffect, useState } from "react";
import { getConfig, saveConfig } from "../lib/store";

export interface ClosableAlertProps {
    // The "not-show-again" option will be persisted in the config with a given key
    configKey: string;
    alertType: 'success' | 'info' | 'warning' | 'error';
    message: ReactNode;
    description?: ReactNode;
}

export default function ClosableAlert(props: ClosableAlertProps) {
    const [show, setShow] = useState<boolean>(false);
    useEffect(() => {
        getConfig(true).then(config => {
            console.log(config)
            // judge if configKey is in the map
            if (!config.show_alert_map.hasOwnProperty(props.configKey) || config.show_alert_map[props.configKey]) {
                setShow(true);
            }
        });
    }, []);

    const notShowAgain = () => {
        getConfig(true).then(config => {
            config.show_alert_map[props.configKey] = false;
            saveConfig(config);
            setShow(false);
        });
    }

    if (!show) {
        return null;
    }

    const description = <Space direction="vertical" size="large">
        {props.description && <div>{props.description}</div>}
        <Radio onClick={notShowAgain}>不再显示</Radio>
    </Space>
    return <Alert message={props.message} description={description} showIcon type={props.alertType} />
}