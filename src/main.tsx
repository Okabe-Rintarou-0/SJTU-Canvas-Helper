import ReactDOM from "react-dom/client";
import { Provider } from 'react-redux';
import App from "./App";
import ErrorBoundary from "./components/error_boundary";
import { consoleLog, installGlobalErrorHandlers } from "./lib/diagnostics";
import { LOG_LEVEL_INFO } from "./lib/model";
import { configStore } from "./lib/store";

const removeErrorHandlers = installGlobalErrorHandlers();
if (import.meta.hot) import.meta.hot.dispose(removeErrorHandlers);
consoleLog(LOG_LEVEL_INFO, "Canvas Helper frontend started");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary>
    <Provider store={configStore}>
      <App />
    </Provider>
  </ErrorBoundary>
);

