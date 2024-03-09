import React, { useEffect, useState } from 'react';
import { FileOutlined, SettingOutlined, UserOutlined, VideoCameraOutlined, FormOutlined, CalendarOutlined, CloudDownloadOutlined } from '@ant-design/icons';
import { Layout, Menu, theme } from 'antd';
import { Link, useLocation } from 'react-router-dom';
import { getVersion } from "@tauri-apps/api/app";

const { Content, Footer, Sider } = Layout;

export default function BasicLayout({ children }: React.PropsWithChildren) {
    const [version, setVersion] = useState<string>("");

    useEffect(() => {
        getVersion().then(version => setVersion(version));
    }, []);

    const items = [{
        key: 'files',
        icon: <FileOutlined />,
        label: <Link to={'/files'}>文件</Link>,
    }, {
        key: 'assignments',
        icon: <FormOutlined />,
        label: <Link to={'/assignments'}>查看作业</Link>,
    }, {
        key: 'calendar',
        icon: <CalendarOutlined />,
        label: <Link to={'/calendar'}>日历</Link>,
    }, {
        key: 'users',
        icon: <UserOutlined />,
        label: <Link to={'/users'}>人员导出</Link>,
    }, {
        key: 'submissions',
        icon: <CloudDownloadOutlined />,
        label: <Link to={'/submissions'}>作业批改</Link>,
    }, {
        key: 'video',
        icon: <VideoCameraOutlined />,
        label: <Link to={'/video'}>视频</Link>,
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
                当前版本：{version} <br />
                SJTU Canvas Helper ©{new Date().getFullYear()} Created by <a target="_blank" href='https://github.com/Okabe-Rintarou-0'>Okabe</a>
            </Footer>
        </Layout>
    </Layout>
}