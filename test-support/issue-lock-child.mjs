import fs from "node:fs/promises";
import { constants } from "node:fs";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mock } from "node:test";
import fsExt from "fs-ext";
import { acquireLock, LockHeldError } from "../src/kernel/lock.ts";

const [mode, path] = process.argv.slice(2);
const send = (event, extra = {}) => process.send({ event, ...extra });

if (mode === "idle") {
  // Deliberately outlive the owner to expose inherited lock descriptors.
  process.on("disconnect", () => {});
  setInterval(() => {}, 60000);
  send("ready");
} else if (mode === "preopened") {
  const handle = await fs.open(path, constants.O_RDWR);
  process.on("message", () => {
    try {
      fsExt.flockSync(handle.fd, "exnb");
      send("acquired");
    } catch (error) {
      if (!["EAGAIN", "EWOULDBLOCK"].includes(error.code)) throw error;
      send("held");
    }
  });
  send("ready");
} else {
  if (mode === "publication-gap") {
    const open = fs.open;
    mock.method(fs, "open", async (...args) => {
      const handle = await open(...args);
      const truncate = handle.truncate.bind(handle);
      mock.method(handle, "truncate", async (...truncateArgs) => {
        const publish = once(process, "message");
        send("paused");
        await publish;
        return truncate(...truncateArgs);
      });
      return handle;
    });
  }
  let owner;
  const acquire = async () => {
    try {
      owner = await acquireLock(path);
      if (mode === "owner-with-child") {
        const ordinary = fork(new URL(import.meta.url), ["idle", path], {
          execArgv: [],
          stdio: ["ignore", "ignore", "inherit", "ipc"],
        });
        await once(ordinary, "message");
        send("acquired", { childPid: ordinary.pid });
      } else send("acquired");
    } catch (error) {
      if (!(error instanceof LockHeldError)) throw error;
      send("held");
    }
  };
  if (mode === "contender") {
    process.on("message", async (command) => {
      if (command === "acquire") await acquire();
      if (command === "release") {
        await owner.release();
        send("released");
      }
    });
    send("ready");
  } else await acquire();
}
