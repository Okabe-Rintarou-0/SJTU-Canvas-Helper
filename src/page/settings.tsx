import { Button, Form, Input, Space } from "antd";
import BasicLayout from "../components/layout";
import { useEffect } from "react";
import { AppConfig } from "../lib/model";
import { invoke } from "@tauri-apps/api";
import useMessage from "antd/es/message/useMessage";

const { Password } = Input;

export default function SettingsPage() {
    const [form] = Form.useForm<AppConfig>();
    const [messageApi, contextHolder] = useMessage();

    useEffect(() => {
        initConfig();
    }, []);

    const initConfig = async () => {
        let config = await invoke("get_config") as AppConfig;
        form.setFieldsValue(config)
    }

    const handleSaveConfig = async (config: AppConfig) => {
        try {
            await invoke("save_config", { config });
            messageApi.success("保存成功！");
        } catch (e) {
            messageApi.error(e as string);
        }
    }

    const savePathValidator = async (_: any, savePath: string) => {
        let valid = await invoke("check_path", { path: savePath });
        return valid ? Promise.resolve() : Promise.reject(new Error("保存路径无效！请检查目录是否存在！"));
    }

    return <BasicLayout>
        {contextHolder}
        <Space direction="vertical" style={{ width: "100%" }}>
            <Form
                form={form}
                layout="vertical"
                onFinish={handleSaveConfig}
                preserve={false}
            >
                <Form.Item
                    name="token"
                    label="Token"
                    required
                >
                    <Password placeholder="请输入 Canvas Token" />
                </Form.Item>
                <Form.Item name="save_path" label="下载保存目录" required rules={[{ validator: savePathValidator }]}>
                    <Input placeholder="请输入文件下载保存目录" />
                </Form.Item>
                <Form.Item>
                    <Button type="primary" htmlType="submit">
                        保存
                    </Button>
                </Form.Item>
            </Form>
        </Space>
    </BasicLayout>
}