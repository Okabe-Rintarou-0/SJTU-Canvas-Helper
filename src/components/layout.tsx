import React from 'react';
import { FileOutlined, SettingOutlined } from '@ant-design/icons';
import { Layout, Menu, theme } from 'antd';
import { Link, useLocation } from 'react-router-dom';

const { Content, Footer, Sider } = Layout;

export default function BasicLayout({ children }: React.PropsWithChildren) {
    const items = [{
        key: 'file',
        icon: <FileOutlined />,
        label: <Link to={'/file'}>文件</Link>,
    }, {
        key: 'settings',
        icon: <SettingOutlined />,
        label: <Link to={'/settings'}>设置</Link>,
    }]

    const parts = useLocation().pathname.split('/');
    const selectedKeys = [parts[parts.length - 1]];

    const {
        token: { colorBgContainer, borderRadiusLG },
    } = theme.useToken();

    return <Layout style={{ minHeight: "100vh" }}>
        <Sider theme="light">
            <Menu theme="light" mode="inline" defaultSelectedKeys={selectedKeys} items={items} />
        </Sider>
        <Layout>
            <Content style={{ margin: '24px 16px 0' }}>
                <div
                    style={{
                        padding: 24,
                        minHeight: 360,
                        background: colorBgContainer,
                        borderRadius: borderRadiusLG,
                    }}
                >
                    {children}
                </div>
            </Content>
            <Footer style={{ textAlign: 'center' }}>
                SJTU Canvas Helper ©{new Date().getFullYear()} Created by Okabe
            </Footer>
        </Layout>
    </Layout>
}