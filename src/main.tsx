import ReactDOM from "react-dom/client";
import { Provider } from 'react-redux';
import App from "./App";
import { LOG_LEVEL_INFO } from "./lib/model";
import { configStore } from "./lib/store";
import { consoleLog } from "./lib/utils";

consoleLog(LOG_LEVEL_INFO, "SJTU Cavas Helper Hello World!");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <Provider store={configStore}>
    <App />
  </Provider>
);

