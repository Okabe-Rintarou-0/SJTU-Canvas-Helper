import fs from "fs-extra";
import { getOctokit, context } from "@actions/github";
import { createPortableArchive } from "./portable-archive.mjs";

const target = process.argv.slice(2)[0];
const tagTemplate = process.argv.slice(2)[1] ?? "v__VERSION__";

// 打包绿色版/便携版 (only Windows)
async function resolvePortable() {
  if (process.platform !== "win32") return;

  const releaseDir = target
    ? `./src-tauri/target/${target}/release`
    : `./src-tauri/target/release`;
  if (!(await fs.pathExists(releaseDir))) {
    throw new Error("could not found the release dir");
  }

  const { version, zipFile, zipPath } = await createPortableArchive({
    target,
    configPath: "./src-tauri/tauri.conf.json",
    releaseDir,
  });

  console.log("[INFO]: create portable zip successfully");

  // push release assets
  if (process.env.GITHUB_TOKEN === undefined) {
    throw new Error("GITHUB_TOKEN is required");
  }

  const options = { owner: context.repo.owner, repo: context.repo.repo };
  const github = getOctokit(process.env.GITHUB_TOKEN);
  const tag = process.env.TAG_NAME || tagTemplate.replace("__VERSION__", version);
  console.log("[INFO]: upload to ", tag);

  const { data: release } = await github.rest.repos.getReleaseByTag({
    ...options,
    tag,
  });

  let assets = release.assets.filter((x) => {
    return x.name === zipFile;
  });
  if (assets.length > 0) {
    let id = assets[0].id;
    await github.rest.repos.deleteReleaseAsset({
      ...options,
      asset_id: id,
    });
  }

  console.log(release.name);

  await github.rest.repos.uploadReleaseAsset({
    ...options,
    release_id: release.id,
    name: zipFile,
    data: await fs.readFile(zipPath),
  });
}

resolvePortable().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
