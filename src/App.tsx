import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useMemo } from 'react';
import AppRouter from "./components/router";
import "./css/global.css";
import { useConfigSelector } from './lib/hooks';

const {
  compactAlgorithm,
  defaultAlgorithm,
  darkAlgorithm,
} = theme;

function App() {
  const config = useConfigSelector(state => state.config.data);

  const algorithms = useMemo(() => {
    if (!config) {
      return undefined;
    }

    const theme = config?.theme;
    const compactMode = config?.compact_mode ?? false;
    const algorithms = [];
    if (compactMode) {
      algorithms.push(compactAlgorithm);
    }
    algorithms.push(theme === "light" ? defaultAlgorithm : darkAlgorithm);
    return algorithms;
  }, [config?.theme]);

  return <ConfigProvider locale={zhCN} theme={{
    algorithm: algorithms,
    token: {
      colorPrimary: config?.color_primary ?? "#00b96b",
    },
  }}>
    <AppRouter />
  </ConfigProvider>
}

export default App;
