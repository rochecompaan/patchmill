import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Installed Chromium only; no browser package or download. */
export async function openBrowser(url) {
  const profile = await fs.mkdtemp(join(tmpdir(), "patchmill-board-browser-"));
  const browser = spawn(
    process.env.CHROMIUM ?? "chromium",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-background-networking",
      "--no-first-run",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let socket;
  const requests = [],
    exceptions = [];
  async function close() {
    socket?.close();
    if (browser.exitCode === null && browser.signalCode === null) {
      const exited = once(browser, "exit");
      browser.kill("SIGTERM");
      await exited;
    }
    await fs.rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(Error("Chromium startup timed out")),
        15000,
      );
      browser.stderr.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      browser.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      browser.once("exit", () => {
        clearTimeout(timer);
        reject(Error("Chromium exited before connection"));
      });
    });
    socket = new WebSocket(endpoint);
    await once(socket, "open", { signal: AbortSignal.timeout(15000) });
    let id = 0;
    const pending = new Map();
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data),
        waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        clearTimeout(waiter.timer);
        message.error
          ? waiter.reject(Error(JSON.stringify(message.error)))
          : waiter.resolve(message.result);
      }
      if (message.method === "Runtime.exceptionThrown")
        exceptions.push(message.params.exceptionDetails);
      if (message.method === "Network.requestWillBeSent")
        requests.push(message.params.request);
    });
    function command(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const n = ++id;
        const timer = setTimeout(() => {
          pending.delete(n);
          reject(Error(`${method} timed out`));
        }, 15000);
        pending.set(n, { resolve, reject, timer });
        socket.send(
          JSON.stringify({
            id: n,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
          }),
        );
      });
    }
    const { targetId } = await command("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await command("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const send = (method, params) => command(method, params, sessionId);
    for (const method of ["Page.enable", "Runtime.enable", "Network.enable"])
      await send(method);
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source:
        "try {localStorage.setItem('patchmill-name','Reviewer');} catch {}",
    });
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    async function evaluate(expression) {
      const response = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (response.exceptionDetails)
        throw Error(JSON.stringify(response.exceptionDetails));
      return response.result.value;
    }
    async function until(expression) {
      await evaluate(`new Promise((resolve,reject)=>{
        const ready=()=>Boolean(${expression}); if(ready()){resolve();return;}
        const observer=new MutationObserver(()=>{if(ready()){observer.disconnect();clearTimeout(timer);resolve();}});
        observer.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
        const timer=setTimeout(()=>{observer.disconnect();reject(new Error('Page readiness timed out'));},10000);
      })`);
      await evaluate("document.fonts.ready");
      await evaluate(
        "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
      );
    }
    await send("Page.navigate", { url });
    return {
      send,
      evaluate,
      until,
      close,
      requests,
      exceptions,
      async viewport(width, height = width < 500 ? 844 : 1000) {
        await send("Emulation.setDeviceMetricsOverride", {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: width < 500,
        });
      },
      async screenshot(path) {
        const { data } = await send("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: false,
        });
        await fs.writeFile(path, Buffer.from(data, "base64"));
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
