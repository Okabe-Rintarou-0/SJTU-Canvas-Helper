import { Button, Col, Form, List, Modal, Row, Space } from "antd";
import { useEffect, useState } from "react";
import { DialogFilter, open } from '@tauri-apps/api/dialog';
import TextArea from "antd/es/input/TextArea";
import { FaUpload } from "react-icons/fa";
import useMessage from "antd/es/message/useMessage";
import { useForm } from "antd/lib/form/Form";
import { invoke, path } from "@tauri-apps/api";

interface SubmitParam {
    filePaths: string[];
    comment?: string;
}

function FilesSelector({ value, onChange, allowed_extensions }: {
    allowed_extensions: string[],
    value?: string[],
    onChange?: (value: string[]) => void,
}) {
    const [filePaths, setFilePaths] = useState<string[]>([]);
    const [fileBaseNames, setFileBaseNames] = useState<string[]>([]);
    const [messageApi, contextHolder] = useMessage();
    useEffect(() => {
        if (value) {
            setFilePaths(value);
        }
    }, [value]);
    useEffect(() => {
        const fileBaseNamesPromise = Promise.all(
            filePaths.map(async (filePath) => await path.basename(filePath))
        );
        fileBaseNamesPromise.then(fileBaseNames => {
            setFileBaseNames(fileBaseNames);
        });
    }, [filePaths]);

    const handleSelectFiles = async () => {
        let filters: DialogFilter[];
        if (allowed_extensions.length) {
            filters = [{
                name: `所有文件(${allowed_extensions.join(',')})`,
                extensions: allowed_extensions
            }].concat(
                allowed_extensions.map(extension => ({
                    name: extension,
                    extensions: [extension],
                })));
        } else {
            filters = [{
                name: '所有文件(*)',
                extensions: ['*'],
            }];
        }

        const selected = await open({
            multiple: true,
            filters: filters,
        });
        if (selected == null) {
            messageApi.warning("未选中文件⚠️！", 1);
            return;
        }
        let paths = [...filePaths];
        if (Array.isArray(selected)) {
            paths.push(...selected);
        } else {
            paths.push(selected);
        }
        onChange?.(paths);
    }

    const handleRemove = (filePath: string) => {
        let paths = filePaths.filter(path => path !== filePath);
        onChange?.(paths);
    }

    return <Space direction="vertical" style={{ width: "100%" }}>
        {contextHolder}
        <Button icon={<FaUpload size={15} />} onClick={handleSelectFiles}>选择上传文件</Button>
        <List>
            {fileBaseNames.map(fileBaseName => <List.Item key={fileBaseName}>
                <Row justify="space-between" style={{ width: "100%" }}>
                    <Col>{fileBaseName}</Col>
                    <Col><a onClick={(e) => {
                        e.preventDefault();
                        handleRemove(fileBaseName);
                    }}>删除</a></Col>
                </Row>
            </List.Item>)}
        </List>
    </Space >
}


export function SubmitModal({ open, onCancel, onSubmit, allowed_extensions, courseId, assignmentId }: {
    open: boolean,
    allowed_extensions: string[],
    courseId: number,
    assignmentId: number,
    onCancel?: () => void,
    onSubmit?: () => void,
}) {
    const [form] = useForm<SubmitParam>();
    const [messageApi, contextHolder] = useMessage();
    const handleSubmit = async ({ filePaths, comment }: SubmitParam) => {
        if (!comment) {
            comment = undefined;
        }
        try {
            messageApi.open({
                key: "submitting",
                type: "loading",
                content: "正在提交中😄...请耐心等待！"
            });
            await invoke("submit_assignment", { courseId, assignmentId, filePaths, comment });
            onSubmit?.();
        } catch (e) {
            messageApi.error(`提交失败☹️：${e}`);
        }
    }
    return <Modal open={open} footer={null} onCancel={onCancel} width={"90%"}>
        {contextHolder}
        <Form form={form} onFinish={handleSubmit} >
            <Form.Item label="文件" name="filePaths" required rules={[{
                required: true,
                message: '请上传文件!',
            }]} style={{ width: "100%" }}>
                <FilesSelector allowed_extensions={allowed_extensions} />
            </Form.Item>
            <Form.Item label="评论" name="comment">
                <TextArea placeholder="输入评论" />
            </Form.Item>
            <Form.Item>
                <Button type="primary" htmlType="submit">提交</Button>
            </Form.Item>
        </Form>
    </Modal>
}