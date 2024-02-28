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

    return <BasicLayout>
        {contextHolder}
        <Space direction="vertical">
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
                <Form.Item>
                    <Button type="primary" htmlType="submit">
                        保存
                    </Button>
                </Form.Item>
            </Form>
        </Space>
    </BasicLayout>
}