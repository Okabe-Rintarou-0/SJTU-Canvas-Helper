import AppRouter from "./components/router";
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { checkUpdate, installUpdate, } from "@tauri-apps/api/updater";
import { useEffect } from "react";

function App() {
  const checkAndUpdate = async () => {
    const update = await checkUpdate();
    if (update.shouldUpdate) {
      await installUpdate();
    }
  }

  useEffect(() => {
    checkAndUpdate();
  }, []);

  return <ConfigProvider locale={zhCN}>
    <AppRouter />
  </ConfigProvider>
}

export default App;
