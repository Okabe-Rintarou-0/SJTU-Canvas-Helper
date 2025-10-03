import { open } from '@tauri-apps/plugin-dialog';
import { Button, Input, InputRef, Space } from "antd";
import React, { useEffect, useState } from "react";
import { getConfig } from "../lib/config";

interface PathSelectorProps {
    value?: string,
    onChange?: (value: string) => void,
    directory?: boolean,
    extensions?: string[],
    placeholder?: string
}

const DEFAULT_PLACE_HOLDER = "请输入文件下载保存目录";

export const PathSelector = React.forwardRef<InputRef, PathSelectorProps>(({ value, onChange, extensions, directory = true, placeholder = DEFAULT_PLACE_HOLDER }, ref) => {
    const [saveDir, setSaveDir] = useState<string>("");

    useEffect(() => {
        setSaveDir(value ?? "");
    }, [value]);

    const handleSelectDirectory = async () => {
        const config = await getConfig(true);
        const path = config.save_path.length > 0 ? config.save_path : undefined;
        const saveDir = await open({
            directory,
            defaultPath: path,
            filters: extensions ? [{ name: "", extensions }] : undefined
        });
        if (!saveDir) {
            return;
        }
        if (Array.isArray(saveDir)) {
            if (saveDir.length > 0) {
                onChange?.(saveDir[0]);
            }
        } else {
            onChange?.(saveDir);
        }
    }
    return <Space.Compact style={{ width: "100%" }} >
        <Input ref={ref} width={"100%"} placeholder={placeholder} value={saveDir} onChange={(e) => setSaveDir(e.target.value)} />
        <Button onClick={handleSelectDirectory}>选择</Button>
    </Space.Compact>
});