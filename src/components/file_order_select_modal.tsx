import { DraggableItem, File } from "../lib/model";
import { Alert, Modal, Space } from "antd";
import DraggableList from "./draggable_list";
import { useEffect, useState } from "react";

export default function FileOrderSelectModal({ files, open, handleOk, handleCancel }: {
    files: File[],
    open: boolean,
    handleOk: (items: DraggableItem[]) => void,
    handleCancel: () => void
}) {
    const [items, setItems] = useState<DraggableItem[]>([]);
    useEffect(() => {
        setItems(files.map(f => ({
            id: f.id.toString(),
            content: f.display_name,
            data: f
        })));
    }, [files])
    return <Modal open={open} onCancel={handleCancel}
        width={"60%"}
        onOk={() => handleOk(items)}
        title={"指定合并顺序"}
        styles={{ body: { padding: "20px" } }}
    >
        <Space direction="vertical" style={{ width: "100%" }}>
            <Alert
                message="使用提示"
                description="您可以拖拽文件名称以调整合并顺序。"
                type="info"
                showIcon
            />
            <DraggableList items={items} onDragEnd={setItems} />
        </Space>
    </Modal>
}