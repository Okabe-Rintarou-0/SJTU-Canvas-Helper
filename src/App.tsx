import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useMemo } from 'react';
import AppRouter from "./components/router";
import "./css/global.css";
import { useConfigSelector } from './lib/hooks';
import { LOG_LEVEL_INFO } from './lib/model';
import { consoleLog } from './lib/utils';

const {
  compactAlgorithm,
  defaultAlgorithm,
  darkAlgorithm,
} = theme;

function App() {
  const config = useConfigSelector(state => state.config.data);

  const algorithms = useMemo(() => {
    const theme = config?.theme;
    const compactMode = config?.compact_mode ?? false;
    const algorithms = [];
    if (compactMode) {
      algorithms.push(compactAlgorithm);
    }
    algorithms.push(theme === "light" ? defaultAlgorithm : darkAlgorithm);
    consoleLog(LOG_LEVEL_INFO, algorithms);
    return algorithms;
  }, [config?.theme]);

  consoleLog(LOG_LEVEL_INFO, algorithms);

  return <ConfigProvider locale={zhCN} theme={{
    algorithm: algorithms,
    token: {
      colorPrimary: config?.color_primary ?? undefined,
    },
  }}>
    <AppRouter />
  </ConfigProvider>
}

export default App;
