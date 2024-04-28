import { Button, Input, InputRef, Space } from "antd";
import React, { useEffect, useState } from "react";
import { open } from '@tauri-apps/api/dialog';
import { getConfig } from "../lib/store";

interface PathSelectorProps {
    value?: string,
    onChange?: (value: string) => void
}

export const PathSelector = React.forwardRef<InputRef, PathSelectorProps>(({ value, onChange }, ref) => {
    const [saveDir, setSaveDir] = useState<string>("");

    useEffect(() => {
        setSaveDir(value ?? "");
    }, [value]);

    const handleSelectDirectory = async () => {
        const config = await getConfig(true);
        const path = config.save_path.length > 0 ? config.save_path : undefined;
        const saveDir = await open({
            directory: true,
            defaultPath: path,
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
        <Input ref={ref} width={"100%"} placeholder="请输入文件下载保存目录" value={saveDir} onChange={(e) => setSaveDir(e.target.value)} />
        <Button onClick={handleSelectDirectory}>选择</Button>
    </Space.Compact>
});