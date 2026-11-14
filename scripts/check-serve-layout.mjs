// Optional real-browser regressions: CHROMIUM=/path/to/chromium node scripts/check-serve-layout.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { startServeServer } from "../src/web/server.ts";
import { createServeAuth } from "../src/web/auth.ts";
import { createSampleRunDataSource } from "../src/web/sample-data.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = await startServeServer({
  host: "127.0.0.1",
  port: 0,
  auth: createServeAuth(),
  source: createSampleRunDataSource(),
});
const profile = await fs.mkdtemp("/tmp/patchmill-layout-chrome-");
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
const failures = [];
const evidence = [];
const exceptions = [];
const requests = [];
const imagePauses = [];
let imagesReady;
function check(condition, message) {
  if (!condition) failures.push(message);
}
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Chromium startup timed out")),
      15000,
    );
    let output = "";
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
      reject(Error("Chromium exited"));
    });
  });
  socket = new WebSocket(endpoint);
  await once(socket, "open", { signal: AbortSignal.timeout(15000) });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown")
      exceptions.push(message.params.exceptionDetails);
    if (message.method === "Network.requestWillBeSent")
      requests.push(message.params.request);
    if (message.method === "Fetch.requestPaused") {
      imagePauses.push(message.params.requestId);
      if (imagePauses.length >= 3) imagesReady?.();
    }
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
      const ready=()=>Boolean(${expression});
      if(ready()){resolve();return;}
      const observer=new MutationObserver(()=>{if(ready()){observer.disconnect();clearTimeout(timer);resolve();}});
      observer.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
      const timer=setTimeout(()=>{observer.disconnect();reject(new Error('Page readiness timed out'));},10000);
    })`);
  }
  async function settled() {
    await evaluate("document.fonts.ready");
    await evaluate(
      "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
    );
  }
  async function click(selector) {
    const point = await evaluate(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
    );
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      clickCount: 1,
      ...point,
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      clickCount: 1,
      ...point,
    });
    await settled();
  }
  async function enter() {
    for (const type of ["keyDown", "keyUp"])
      await send("Input.dispatchKeyEvent", {
        type,
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        ...(type === "keyDown" ? { text: "\r" } : {}),
      });
  }
  async function metrics() {
    return evaluate(`(()=>{
      const rect=node=>{if(!node)return null;const r=node.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      const control=selector=>{const node=document.querySelector(selector);if(!node)return null;const r=node.getBoundingClientRect();const points=[[r.x+r.width/2,r.y+r.height/2],[r.x+2,r.y+2],[r.right-2,r.y+2],[r.x+2,r.bottom-2],[r.right-2,r.bottom-2]];return {bounds:rect(node),hits:points.map(([x,y])=>{const hit=document.elementFromPoint(x,y);return {receives:hit===node||node.contains(hit),notice:hit?.id==='notice'};})};};
      const note=document.querySelector('#notice');
      return {scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,innerWidth,innerHeight,visualWidth:visualViewport.width,theme:control('#theme-switch'),name:control('.name-chip'),notice:{hidden:note.hidden,text:note.textContent,bounds:rect(note)},textarea:control('#composer-input'),send:control('#composer button[type=submit]')};
    })()`);
  }
  async function screenshot(name) {
    if (process.env.LAYOUT_SCREENSHOTS !== "1") return;
    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await fs.writeFile(
      `${root}docs/screenshots/${name}.png`,
      Buffer.from(data, "base64"),
    );
  }
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-color-scheme", value: "dark" },
      { name: "prefers-reduced-motion", value: "reduce" },
    ],
  });
  await send("Page.navigate", { url: server.url });
  await until(
    'document.querySelectorAll(".col").length===7 && document.querySelector("#name-dialog")?.open',
  );
  // Invalid names must remain editable in the dialog; Cancel must still work.
  await evaluate("document.querySelector('#name-input').value='   '");
  await click("#name-form [value=save]");
  const invalidName = await evaluate(
    `({open:document.querySelector('#name-dialog').open,focused:document.activeElement.id,error:document.querySelector('#name-error')?.textContent??'',errorHidden:document.querySelector('#name-error')?.hidden??true,saved:localStorage.getItem('patchmill-name')})`,
  );
  evidence.push({ invalidName });
  check(invalidName.open, "Whitespace-only Save must keep the dialog open");
  check(
    invalidName.focused === "name-input",
    "Invalid name must retain field focus",
  );
  check(
    !invalidName.errorHidden && invalidName.error.length > 0,
    "Invalid name must have an inline error",
  );
  check(invalidName.saved === null, "Invalid name must not be saved");
  await screenshot("serve-name-validation-mobile");
  if (!invalidName.open) await click(".name-chip");
  await click("#name-form [value=cancel]");
  check(
    await evaluate(
      "!document.querySelector('#name-dialog').open && localStorage.getItem('patchmill-name')===null",
    ),
    "Cancel must close without saving",
  );

  await click(".name-chip");
  await evaluate(
    "document.querySelector('#name-input').value='Enter sample';document.querySelector('#name-input').focus()",
  );
  await enter();
  await settled();
  const enterName = await evaluate(
    "({open:document.querySelector('#name-dialog').open,saved:localStorage.getItem('patchmill-name')})",
  );
  evidence.push({ enterName });
  check(
    !enterName.open && enterName.saved === "Enter sample",
    "Enter in the name field must save, not cancel",
  );

  // Both normal and maximum-length names must leave the composer usable.
  for (const name of ["abcdefghijklmnopqrstuvwxyzabcdef", "Browser reviewer"]) {
    if (!(await evaluate('document.querySelector("#name-dialog").open'))) {
      await evaluate('document.querySelector(".name-chip").focus()');
      await enter();
      await until('document.querySelector("#name-dialog").open');
    }
    await evaluate(
      `document.querySelector('#name-input').value=${JSON.stringify(name)};document.querySelector('#name-form [value=save]').click()`,
    );
    await until(
      `document.querySelector('#me-name').textContent===${JSON.stringify(name)} && !document.querySelector('#name-dialog').open`,
    );
    await settled();
    const board = await metrics();
    evidence.push({ name, board });
    check(
      board.scrollWidth === 390 && board.innerWidth === 390,
      `${name}: page must remain 390px wide (actual ${board.scrollWidth}/${board.innerWidth})`,
    );
    for (const key of ["theme", "name"]) {
      check(
        board[key].bounds.right <= 390 && board[key].hits[0].receives,
        `${name}: ${key} control must fit and receive pointer input`,
      );
    }
    for (const number of [227, 250]) {
      await evaluate(`location.hash='#/issue/${number}'`);
      await until(
        `document.querySelector('.ihead')?.dataset.issue==='${number}'`,
      );
      await evaluate("window.scrollTo(0,0)");
      await settled();
      const thread = await evaluate(
        'document.querySelector(".thread").innerText',
      );
      await evaluate(
        `(()=>{window.__layoutSubmits=0;document.querySelector('#composer').addEventListener('submit',()=>window.__layoutSubmits++);const input=document.querySelector('#composer-input');input.value='Synthetic draft';input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await click(".control button");
      for (const action of ["Pause", "Send"]) {
        if (action === "Send") await click("#composer button[type=submit]");
        const state = await metrics();
        evidence.push({ name, number, action, state });
        check(
          !state.notice.hidden &&
            state.notice.text === "This comes with live chat. Nothing changed.",
          `#${number} ${action}: show the truthful view-only notice`,
        );
        for (const key of ["textarea", "send"]) {
          const field = state[key];
          check(
            field.hits[0].receives && field.hits.every((hit) => !hit.notice),
            `#${number} ${action} ${name}: notice must not intercept ${key}`,
          );
          check(
            state.notice.bounds.bottom <= field.bounds.y,
            `#${number} ${action} ${name}: notice must not obscure ${key}`,
          );
          check(
            field.bounds.bottom <= 844,
            `#${number} ${action} ${name}: ${key} must remain visible`,
          );
        }
      }
      check(
        (await evaluate("window.__layoutSubmits")) === 1,
        `#${number} ${name}: real pointer click must submit exactly once`,
      );
      check(
        (await evaluate('document.querySelector(".thread").innerText')) ===
          thread,
        `#${number}: controls must not mutate the sample thread`,
      );
      await click("#composer-input");
      check(
        (await evaluate("document.activeElement.id")) === "composer-input",
        `#${number}: textarea must remain focusable after the notice`,
      );
      await send("Input.insertText", { text: "continued" });
      check(
        await evaluate(
          'document.querySelector("#composer-input").value.includes("continued")',
        ),
        `#${number}: textarea must remain editable`,
      );
      if (name.length === 32 && number === 227)
        await screenshot("serve-issue-mobile-feedback");
    }
    await evaluate("location.hash='#/board'");
    await until('document.querySelectorAll(".col").length===7');
  }
  // The first keyboard stop must bypass the topbar without changing the route.
  await evaluate("location.hash='#/issue/227'");
  await until("document.querySelector('.ihead')?.dataset.issue==='227'");
  await evaluate(
    "document.body.tabIndex=-1;document.body.focus();document.body.removeAttribute('tabindex')",
  );
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", {
      type,
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
    });
  await settled();
  const skip = await evaluate(
    `(()=>{const a=document.querySelector('.skip-link');const r=a?.getBoundingClientRect();return {exists:Boolean(a),focused:document.activeElement===a,visible:Boolean(r&&r.top>=0&&r.bottom<=innerHeight),hash:location.hash}})()`,
  );
  evidence.push({ skip });
  check(
    skip.exists && skip.focused && skip.visible,
    "First Tab must reveal and focus a skip link",
  );
  if (skip.exists) {
    await screenshot("serve-skip-link-mobile");
    await enter();
    await settled();
    const destination = await evaluate(
      "({focused:document.activeElement.id,hash:location.hash})",
    );
    evidence.push({ skipDestination: destination });
    check(
      destination.focused === "app" && destination.hash === skip.hash,
      "Skip must focus main and preserve the issue route",
    );
  }

  // Hold real image requests to measure the gallery before and after loading.
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate("location.hash='#/issue/173'");
  await until("document.querySelector('.ihead')?.dataset.issue==='173'");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Fetch.enable", {
    patterns: [
      {
        urlPattern: server.origin + "/samples/*.png",
        resourceType: "Image",
        requestStage: "Request",
      },
    ],
  });
  const pausedImages = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Screenshot requests were not paused")),
      10000,
    );
    imagesReady = () => {
      clearTimeout(timer);
      resolve();
    };
  });
  await click("[data-artifact-id=shots]");
  await pausedImages;
  async function galleryGeometry() {
    return evaluate(
      `(()=>{const img=document.querySelector('.shot img');const r=img.getBoundingClientRect();return {loaded:img.complete&&img.naturalWidth>0,imageHeight:r.height,captionY:document.querySelector('.gallery figcaption').getBoundingClientRect().y,navY:document.querySelector('.gal-nav').getBoundingClientRect().y}})()`,
    );
  }
  const beforeImage = await galleryGeometry();
  check(
    !beforeImage.loaded,
    "Image must actually be delayed for the shift regression",
  );
  await Promise.all(
    imagePauses.map((requestId) =>
      send("Fetch.continueRequest", { requestId }),
    ),
  );
  await send("Fetch.disable");
  await evaluate(
    "Promise.all([...document.querySelectorAll('#viewer img')].map(img=>img.decode()))",
  );
  await settled();
  const afterImage = await galleryGeometry();
  evidence.push({
    gallery: { beforeImage, afterImage, pausedRequests: imagePauses.length },
  });
  for (const key of ["imageHeight", "captionY", "navY"])
    check(
      Math.abs(beforeImage[key] - afterImage[key]) < 1,
      "Delayed gallery image must not shift " + key,
    );
  await click("[data-vw=next]");
  await screenshot("serve-artifact-gallery");
  await click("[data-vw=close]");

  check(exceptions.length === 0, "No browser runtime exceptions");
  check(
    requests.every((request) => request.method === "GET"),
    "No mutation requests",
  );
  check(
    requests.every(
      (request) =>
        !/^https?:/.test(request.url) || request.url.startsWith(server.origin),
    ),
    "No foreign requests",
  );
  if (process.env.LAYOUT_EVIDENCE)
    await fs.writeFile(
      process.env.LAYOUT_EVIDENCE,
      JSON.stringify({ evidence, failures, exceptions }, null, 2),
    );
  assert.deepEqual(failures, [], failures.join("\n"));
  console.log(
    "Serve browser regressions passed: mobile names, usable notice/composer, inline validation, Cancel, keyboard bypass, stable delayed gallery, no mutations.",
  );
} finally {
  socket?.close();
  const closed = once(browser, "close");
  browser.kill("SIGTERM");
  await closed;
  await server.close();
  await fs.rm(profile, { recursive: true, force: true });
}
