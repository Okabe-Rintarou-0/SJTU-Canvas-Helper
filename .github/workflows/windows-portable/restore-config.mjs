import fs from "fs-extra";

async function restoreConfig() {
    const configPath = "./src-tauri/tauri.conf.json";
    if (!(await fs.pathExists(configPath + ".bak"))) {
        throw new Error("could not found the tauri.conf.json.bak");
    }

    await fs.remove(configPath);
    await fs.copyFile(configPath + ".bak", configPath);
}

restoreConfig().catch((err) => { console.error(err); });