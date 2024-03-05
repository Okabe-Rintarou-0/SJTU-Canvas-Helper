import AppRouter from "./components/router";
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
function App() {
  return <ConfigProvider locale={zhCN}>
    <AppRouter />
  </ConfigProvider>
}

export default App;
