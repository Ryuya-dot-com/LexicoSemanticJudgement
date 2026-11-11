#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromeCandidates = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = chromeCandidates.find(candidate => fs.existsSync(candidate));

if (!chromePath) {
  console.error('Chrome/Chromium not found; set CHROME_BIN to run the browser smoke test.');
  process.exit(2);
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.m4a': 'audio/mp4', '.wav': 'audio/wav'
};

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
  const relative = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
  const requestedPath = path.resolve(repoRoot, '.' + relative);
  if (!requestedPath.startsWith(repoRoot + path.sep) || !fs.existsSync(requestedPath) || !fs.statSync(requestedPath).isFile()) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': contentTypes[path.extname(requestedPath)] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(requestedPath).pipe(response);
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const baseUrl = 'http://127.0.0.1:' + server.address().port;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ljts-chrome-smoke-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-gpu',
  '--no-first-run',
  '--no-sandbox',
  '--remote-debugging-port=0',
  '--user-data-dir=' + profileDir,
  'about:blank'
], { stdio: 'ignore' });

let socket;

try {
  const activePortPath = path.join(profileDir, 'DevToolsActivePort');
  await waitUntil(() => fs.existsSync(activePortPath), 'Chrome debugging endpoint', 10000);
  const [port, browserPath] = fs.readFileSync(activePortPath, 'utf8').trim().split(/\r?\n/);
  socket = new WebSocket('ws://127.0.0.1:' + port + browserPath);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let commandId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      waiter.reject(new Error(message.error.message || JSON.stringify(message.error)));
    } else {
      waiter.resolve(message.result || {});
    }
  });

  const send = (method, params = {}, sessionId = undefined) => new Promise((resolve, reject) => {
    commandId += 1;
    pending.set(commandId, { resolve, reject });
    const message = { id: commandId, method, params };
    if (sessionId) message.sessionId = sessionId;
    socket.send(JSON.stringify(message));
  });

  const target = await send('Target.createTarget', { url: 'about:blank' });
  const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);

  const injectedHarness = `(() => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (fn, delay, ...args) => nativeSetTimeout(fn, delay === 250 ? 1 : delay, ...args);
    window.__failNextAudio = false;
    window.__downloads = 0;
    window.__posts = 0;
    window.__audio = null;
    class FakeAudio extends EventTarget {
      constructor() { super(); this.src = ''; window.__audio = this; }
      pause() {}
      play() {
        const failure = window.__failNextAudio;
        window.__failNextAudio = false;
        nativeSetTimeout(() => this.dispatchEvent(new Event(failure ? 'error' : 'ended')), 20);
        return Promise.resolve();
      }
    }
    window.Audio = FakeAudio;
    HTMLAnchorElement.prototype.click = function() { if (this.download) window.__downloads++; };
    window.fetch = () => { window.__posts++; throw new Error('Public app must not submit data'); };
    navigator.sendBeacon = () => { window.__posts++; return false; };
    window.confirm = () => true;
  })();`;
  await send('Page.addScriptToEvaluateOnNewDocument', { source: injectedHarness }, sessionId);

  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    }, sessionId);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
    }
    return result.result ? result.result.value : undefined;
  };

  const navigate = async url => {
    await send('Page.navigate', { url }, sessionId);
    await waitUntil(async () => {
      try {
        return await evaluate('document.readyState === "complete"');
      } catch {
        return false;
      }
    }, 'page load: ' + url, 10000);
  };

  const url = baseUrl + '/public/index.html';
  await navigate(url);
  assert(await evaluate('document.querySelectorAll("input, textarea, form").length === 0'), 'unexpected identity form');
  const total = await evaluate('window.LJT_PUBLIC.items.length');
  const initialStorage = await evaluate('JSON.stringify([Object.keys(localStorage), Object.keys(sessionStorage)])');
  await send('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true}, sessionId);
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'mobile welcome overflows');
  await evaluate('document.querySelector("#start").click(); document.querySelector("#check").click()');
  await waitUntil(() => evaluate('!document.querySelector("#practice").disabled'), 'sound check');
  await evaluate('document.querySelector("#practice").click(); document.dispatchEvent(new KeyboardEvent("keydown", {key:"j"}))');
  assert(await evaluate('document.querySelector("#next").hidden'), 'early response was accepted');

  let responses = 0, breaks = 0, retryTested = false;
  await waitUntil(async () => {
    if (await evaluate('Boolean(document.querySelector("#cefr"))')) return true;
    if (await evaluate('Boolean(document.querySelector("#main"))')) {
      await evaluate('window.__failNextAudio = true; document.querySelector("#main").click()');
      return false;
    }
    if (await evaluate('Boolean(document.querySelector("#resume"))')) {
      breaks++;
      await evaluate('document.querySelector("#resume").click()');
      return false;
    }
    if (await evaluate('document.querySelector("#recovery") && !document.querySelector("#recovery").hidden')) {
      retryTested = true;
      assert(await evaluate('document.querySelector("#yes").disabled'), 'audio error allowed scoring');
      await evaluate('document.querySelector("#retry").click()');
      return false;
    }
    if (await evaluate('document.querySelector("#next") && !document.querySelector("#next").hidden')) {
      await evaluate('document.querySelector("#next").click()');
      return false;
    }
    if (await evaluate('document.querySelector("#yes") && !document.querySelector("#yes").disabled')) {
      await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", {key:"j",repeat:true}))');
      assert(await evaluate('!document.querySelector("#yes").disabled'), 'repeat key accepted');
      await evaluate('document.querySelector("#yes").click(); document.querySelector("#yes").click()');
      responses++;
    }
    return false;
  }, 'practice and main completion', 30000, 3);
  assert(responses === total + 4, 'unexpected number of responses: ' + responses);
  assert(breaks === (total === 160 ? 1 : 0), 'break count');
  assert(retryTested, 'audio retry not exercised');
  assert(await evaluate('document.querySelector("#score").textContent.trim()') === `${total / 2} / ${total}`, 'wrong score');
  assert(await evaluate('document.querySelector("#cefr").textContent') === 'A1', 'wrong common-subset band');
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'mobile result overflows');
  await send('Emulation.setDeviceMetricsOverride', {width:320,height:640,deviceScaleFactor:1,mobile:true}, sessionId);
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'narrow mobile result overflows');
  assert(await evaluate('window.__downloads === 0 && window.__posts === 0'), 'download or submission occurred');
  assert(await evaluate('JSON.stringify([Object.keys(localStorage), Object.keys(sessionStorage)])') === initialStorage, 'persistent state was written');
  if (total === 160) assert((await evaluate('document.body.innerText')).includes('20 / 40点'), 'reference score not explained');

  await evaluate('document.querySelector("#restart").click(); document.querySelector("#start").click(); document.querySelector("#check").click()');
  await waitUntil(() => evaluate('!document.querySelector("#practice").disabled'), 'sound recheck');
  await evaluate('window.__failNextAudio = true; document.querySelector("#practice").click()');
  await waitUntil(() => evaluate('!document.querySelector("#recovery").hidden'), 'audio failure');
  await evaluate('document.querySelector("#stop").click()');
  assert(await evaluate('document.querySelector("#cefr").textContent') === '—', 'incomplete result displayed CEFR');
  assert((await evaluate('document.body.innerText')).includes('0 / 0'), 'empty result should not invent incorrect answers');
  console.log(`Public browser smoke passed: 4+${total}, mobile width, audio retry/stop, early/repeat/double input, score, CEFR, no downloads/submission/storage.`);

} finally {
  try {
    if (socket && socket.readyState === WebSocket.OPEN) socket.close();
  } catch {
    // Best-effort cleanup.
  }
  chrome.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => chrome.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 2000))
  ]);
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function waitForSelector(evaluate, selector, timeout = 5000) {
  return waitUntil(() => evaluate('Boolean(document.querySelector(' + JSON.stringify(selector) + '))'), 'selector ' + selector, timeout);
}

async function waitUntil(predicate, description, timeout = 5000, interval = 10) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error('Timed out waiting for ' + description);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
