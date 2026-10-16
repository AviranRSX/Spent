import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PORT, REPO_ROOT, renderTemplate } from "./paths.mjs";
import { addManagedBlock, removeManagedBlock } from "./hosts.mjs";
import { isSpentServerCommand, parseListeningPids } from "./windows-process.mjs";

const TASK_NAME = "Spent";
const LAUNCHER_DIR = path.join(os.homedir(), "AppData", "Local", "Spent");
const LAUNCHER_VBS = path.join(LAUNCHER_DIR, "spent-launcher.vbs");

function whichNode() {
  const r = spawnSync("where", ["node"], { encoding: "utf-8", shell: false });
  if (r.status !== 0) throw new Error("Cannot find `node` on PATH.");
  return r.stdout.split(/\r?\n/).filter(Boolean)[0].trim();
}

// wscript.exe is a GUI-subsystem host, so launching node through this
// VBScript avoids the visible console window node.exe would otherwise get.
function writeLauncherVbs() {
  fs.mkdirSync(LAUNCHER_DIR, { recursive: true });
  const content = renderTemplate("spent-launcher.vbs", {
    port: PORT,
    repoRoot: REPO_ROOT,
    nodePath: whichNode(),
  });
  fs.writeFileSync(LAUNCHER_VBS, content, { encoding: "utf-8" });
}

function removeLauncherVbs() {
  try {
    fs.unlinkSync(LAUNCHER_VBS);
  } catch {
    // best-effort
  }
  try {
    fs.rmdirSync(LAUNCHER_DIR);
  } catch {
    // directory not empty or already gone; leave it
  }
}

function userId() {
  return `${process.env.USERDOMAIN ?? os.hostname()}\\${process.env.USERNAME ?? os.userInfo().username}`;
}

function isAdmin() {
  const r = spawnSync("net", ["session"], { encoding: "utf-8" });
  return r.status === 0;
}

function writeTaskXml() {
  const xmlPath = path.join(os.tmpdir(), `spent-task-${process.pid}.xml`);
  const content = renderTemplate("spent-task.xml", {
    port: PORT,
    repoRoot: REPO_ROOT,
    nodePath: whichNode(),
    userId: userId(),
    launcherVbsPath: LAUNCHER_VBS,
  });
  fs.writeFileSync(xmlPath, "﻿" + content, { encoding: "utf16le" });
  return xmlPath;
}

function schtasks(args) {
  return spawnSync("schtasks", args, { encoding: "utf-8" });
}

function checkPortBinding() {
  const r = spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf-8" });
  if (r.status !== 0) return { listening: false };
  const lines = r.stdout.split(/\r?\n/);
  const portStr = `:${PORT}`;
  const matches = lines.filter((l) => l.includes(portStr) && l.includes("LISTENING"));
  const onLoopback = matches.some((l) => l.includes(`127.0.0.1${portStr}`));
  const onWildcard = matches.some(
    (l) => l.includes(`0.0.0.0${portStr}`) || /\s\[::\]:/.test(l) ? l.includes(portStr) : false,
  );
  return { listening: matches.length > 0, onLoopback, onWildcard };
}

function listeningPids() {
  const r = spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf-8" });
  return r.status === 0 ? parseListeningPids(r.stdout, PORT) : [];
}

function processCommandLine(pid) {
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
    ],
    { encoding: "utf-8" },
  );
  return r.status === 0 ? r.stdout.trim() : "";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * schtasks /End only ends the wscript launcher; the node server it started
 * keeps running and holding the port. Stop that server too, but only when it
 * is `next start` from this checkout.
 */
async function stopServer() {
  schtasks(["/End", "/TN", TASK_NAME]);
  for (const pid of listeningPids()) {
    if (!isSpentServerCommand(processCommandLine(pid), REPO_ROOT)) {
      console.error(
        `Port ${PORT} is held by PID ${pid}, which is not this Spent server. Leaving it running.`,
      );
      continue;
    }
    const r = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf-8" });
    if (r.status !== 0) console.error(r.stderr || r.stdout);
  }
  for (let i = 0; i < 20 && listeningPids().length > 0; i++) await sleep(250);
  if (listeningPids().length > 0) {
    console.error(`Port ${PORT} is still in use. The server may not have stopped.`);
    return false;
  }
  console.log("Spent stopped.");
  return true;
}

function preflight() {
  if (!fs.existsSync(path.join(REPO_ROOT, ".next"))) {
    console.warn(
      "WARNING: .next/ not found. Run `npm run build` before installing the service.",
    );
  }
  if (!isAdmin()) {
    console.warn(
      "Note: hosts file edit needs Administrator. " +
        "If it fails, re-run this command from an elevated terminal.",
    );
  }
}

export async function run(cmd, { friendlyUrl, loopbackUrl }) {
  switch (cmd) {
    case "install": {
      preflight();
      writeLauncherVbs();
      const xmlPath = writeTaskXml();
      try {
        const r = schtasks(["/Create", "/TN", TASK_NAME, "/XML", xmlPath, "/F"]);
        if (r.status !== 0) {
          console.error(r.stderr || r.stdout);
          throw new Error(`schtasks /Create failed (exit ${r.status}).`);
        }
        const run = schtasks(["/Run", "/TN", TASK_NAME]);
        if (run.status !== 0) console.error(run.stderr || run.stdout);
      } finally {
        try {
          fs.unlinkSync(xmlPath);
        } catch {
          // best-effort
        }
      }
      try {
        addManagedBlock();
        // Windows caches negative DNS lookups, so even a fresh `spent.localhost`
        // entry can still resolve as NXDOMAIN until the cache is cleared.
        spawnSync("ipconfig", ["/flushdns"], { stdio: "ignore" });
      } catch (err) {
        console.error(`Hosts file edit failed: ${err.message}`);
        console.error("Task is still installed. You can bookmark " + loopbackUrl);
      }
      setTimeout(() => {
        const state = checkPortBinding();
        if (state.onWildcard && !state.onLoopback) {
          console.error(
            `DANGER: server is bound to wildcard on :${PORT}. ` +
              `Stop the task immediately: npm run service:stop`,
          );
          process.exit(1);
        }
        console.log(`Spent is running. Open ${friendlyUrl} or ${loopbackUrl}.`);
      }, 2000);
      return;
    }
    case "uninstall": {
      await stopServer();
      const r = schtasks(["/Delete", "/TN", TASK_NAME, "/F"]);
      if (r.status !== 0 && !/cannot find/i.test(r.stderr ?? "")) {
        console.error(r.stderr || r.stdout);
      }
      removeLauncherVbs();
      try {
        removeManagedBlock();
      } catch (err) {
        console.error(`Hosts file cleanup failed: ${err.message}`);
      }
      console.log("Spent task removed. The repo and data/ directory are untouched.");
      return;
    }
    case "start": {
      const running = listeningPids();
      if (running.length > 0) {
        // A new server would fail to bind and the old build would keep serving.
        console.error(
          `Port ${PORT} is already in use (PID ${running.join(", ")}). ` +
            "Run `npm run service:stop` first.",
        );
        process.exitCode = 1;
        return;
      }
      const r = schtasks(["/Run", "/TN", TASK_NAME]);
      if (r.status !== 0) {
        console.error(r.stderr || r.stdout);
        process.exitCode = 1;
        return;
      }
      console.log(`Spent started. Open ${friendlyUrl} or ${loopbackUrl}.`);
      return;
    }
    case "stop": {
      if (!(await stopServer())) process.exitCode = 1;
      return;
    }
    case "status": {
      const r = schtasks(["/Query", "/TN", TASK_NAME, "/V", "/FO", "LIST"]);
      console.log(r.stdout || r.stderr);
      const port = checkPortBinding();
      console.log(
        `Port ${PORT}: ${
          port.onLoopback
            ? "127.0.0.1 (ok)"
            : port.onWildcard
              ? "WILDCARD (NOT OK)"
              : "not bound"
        }`,
      );
      return;
    }
    case "logs": {
      console.log(
        "Windows Task Scheduler does not capture stdout/stderr by default.",
      );
      console.log(
        "Run the server manually with `npm run start` to see logs interactively.",
      );
      return;
    }
    case "open": {
      spawnSync("cmd", ["/c", "start", "", friendlyUrl], { stdio: "inherit" });
      return;
    }
  }
}
