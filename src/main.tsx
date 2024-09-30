import ReactDOM from "react-dom/client";
import App from "./App";
import { consoleLog } from "./lib/utils";
import { LOG_LEVEL_INFO } from "./lib/model";

consoleLog(LOG_LEVEL_INFO, "SJTU Cavas Helper Hello World!");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />
);

