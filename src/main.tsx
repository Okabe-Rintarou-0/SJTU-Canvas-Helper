import ReactDOM from "react-dom/client";
import App from "./App";
import { consoleLog } from "./lib/utils";

consoleLog("SJTU Cavas Helper Hello World!");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />
);

