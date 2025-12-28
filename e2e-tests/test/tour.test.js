import os from "os";
import path from "path";
import fs from "fs";
import { expect } from "chai";
import { spawn, spawnSync } from "child_process";
import { Builder, By, Capabilities } from "selenium-webdriver";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// create the path to the expected application binary
const application = path.resolve(
  __dirname,
  "..",
  "..",
  "src-tauri",
  "target",
  "release",
  os.platform() === "win32" ? "SJTU Canvas Helper.exe" : "SJTU Canvas Helper"
);

// keep track of the webdriver instance we create
let driver;

// keep track of the tauri-driver process we start
let tauriDriver;
let exit = false;

console.log(os.homedir())

before(async function () {
  // set timeout to 2 minutes to allow the program to build if it needs to
  this.timeout(120000);

  console.log("Checking if application exists at:", application);

  // only build the program if it doesn't already exist
  if (!fs.existsSync(application)) {
    console.log("Application not found, building...");
    spawnSync("yarn", ["tauri", "build", "--no-bundle"], {
      cwd: path.resolve(__dirname, "../.."),
      stdio: "inherit",
      shell: true,
    });
  } else {
    console.log("Application already exists, skipping build...");
  }

  // start tauri-driver
  console.log("start tauri-driver")
  tauriDriver = spawn(
    path.resolve(os.homedir(), ".cargo", "bin", os.platform() === "win32" ? "tauri-driver.exe" : "tauri-driver"),
    [],
    { stdio: [null, process.stdout, process.stderr] }
  );

  const capabilities = new Capabilities();
  capabilities.set("tauri:options", {
    application
  });
  capabilities.setBrowserName("wry");

  // start the webdriver client
  driver = await new Builder()
    .withCapabilities(capabilities)
    .usingServer("http://localhost:4444/")
    .build();
});

after(async function () {
  // stop the webdriver session
  await closeTauriDriver();
});

describe("Settings Tour", () => {
  it ("should open tour modal", async () => {
        // Navigate to settings page
    await driver.get("http://tauri.localhost/settings");

    driver.wait(async () => {
      try {
        const tourElement = await driver.findElement(By.css(".ant-tour-content"));
        return !(await tourElement.isDisplayed());
      } catch (error) {
        return false;
      }
    }, 10000, "Tour did not appear");
  })
  
  it("should show first tour step about Canvas Token", async () => {

    const img = await driver.findElement(By.css("img[src='help.png']"));
    expect(img).to.not.be.null;
  });

  it("should navigate to next tour step", async () => {
    // Click next button
    const nextButton = await driver.findElement(By.css(".ant-tour-next-btn"));
    await nextButton.click();

    // Verify second step
    const tourTitle = await driver.findElement(By.css(".ant-tour-title")).getText();
    expect(tourTitle).to.include("下载保存目录");
  });

  it("should navigate to final tour step", async () => {
    // Click next button again
    const nextButton = await driver.findElement(By.css(".ant-tour-next-btn"));
    await nextButton.click();

    // Verify third step
    const tourTitle = await driver.findElement(By.css(".ant-tour-title")).getText();
    expect(tourTitle).to.include("保存");
  });

  it("should close the tour", async () => {
    // Click finish button
    const finishButton = await driver.findElement(By.css(".ant-tour-next-btn"));
    await finishButton.click();

    // Verify tour is closed
    await driver.wait(async () => {
      try {
        const tourElement = await driver.findElement(By.css(".ant-tour-content"));
        return !(await tourElement.isDisplayed());
      } catch (error) {
        return true;
      }
    }, 5000, "Tour did not close");
  });
});

async function closeTauriDriver() {
  exit = true;
  // stop the webdriver session
  await driver.quit();

  // kill the tauri-driver process
  tauriDriver.kill();
}

function onShutdown(fn) {
  const cleanup = () => {
    try {
      fn();
    } finally {
      process.exit();
    }
  };

  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("SIGHUP", cleanup);
  process.on("SIGBREAK", cleanup);
}

onShutdown(() => {
  closeTauriDriver();
});