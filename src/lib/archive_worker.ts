import { bootstrapArchiveWorker } from "./archive_worker_bootstrap";

// Keep the vendor bundle as an asset, preserving its relative WASM URL and
// avoiding changes to its bundled Comlink or Node-only compatibility branch.
const bundleUrl = new URL("libarchive.js/dist/worker-bundle.js", import.meta.url).href;
bootstrapArchiveWorker(self, () => import(/* @vite-ignore */ bundleUrl));
