// End-to-end check of reSpawn checkpoints in headless Chromium over CDP.
//   pnpm build:extension && node test/checkpoints-e2e/build-fixtures.mjs
//   node test/checkpoints-e2e/run.mjs
// Env: CHROME_BIN (default /usr/bin/chromium), CDP_PORT (default 9333).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const EXT = path.resolve(import.meta.dirname, '../../dist');
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-e2e-'));
const CHROME = process.env.CHROME_BIN ?? '/usr/bin/chromium';
const PORT = Number(process.env.CDP_PORT ?? 9333);
const HAS_NG = fs.existsSync(path.join(FIXTURES, 'ng/main.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` -> ${JSON.stringify(detail)}`}`,
  );
}

const serve = path.join(import.meta.dirname, 'serve.py');
const servers = [
  spawn('python3', [serve, path.join(FIXTURES, 'redux'), '8701']),
  spawn('python3', [serve, path.join(FIXTURES, 'ng'), '8702']),
  spawn('python3', [serve, path.join(FIXTURES, 'redux'), '8703']),
];
const browser = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  `--load-extension=${EXT}`,
  `--disable-extensions-except=${EXT}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1200,900',
  'about:blank',
]);
let browserLog = '';
browser.stderr.on('data', (d) => (browserLog += d));

async function cleanup() {
  browser.kill();
  servers.forEach((s) => s.kill());
  await sleep(300);
  fs.rmSync(PROFILE, { recursive: true, force: true });
}

let ws;
let nextId = 1;
const pending = new Map();
const events = [];
function send(method, params = {}, sessionId) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
  });
}

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const { webSocketDebuggerUrl } = await res.json();
      ws = new WebSocket(webSocketDebuggerUrl);
      await new Promise((r, j) => {
        ws.onopen = r;
        ws.onerror = j;
      });
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error)
            p.reject(new Error(`${p.method}: ${msg.error.message}`));
          else p.resolve(msg.result);
        } else if (msg.method) {
          events.push(msg);
        }
      };
      return;
    } catch {
      await sleep(200);
    }
  }
  throw new Error('Chromium did not start:\n' + browserLog);
}

async function openTab(url) {
  const { targetId } = await send('Target.createTarget', { url });
  const { sessionId } = await send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  return { targetId, sessionId };
}

async function evaluate(sessionId, expression) {
  const result = await send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(
      `${expression}\n${JSON.stringify(result.exceptionDetails.exception?.description ?? result.exceptionDetails)}`,
    );
  }
  return result.result.value;
}

async function waitFor(sessionId, expression, timeout = 8000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      last = await evaluate(sessionId, expression);
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${expression} (last: ${last})`);
}

async function key(sessionId, code, keyChar, modifiers) {
  const vk = keyChar.toUpperCase().charCodeAt(0);
  const base = { code, key: keyChar, modifiers, windowsVirtualKeyCode: vk };
  await send(
    'Input.dispatchKeyEvent',
    { type: 'rawKeyDown', ...base },
    sessionId,
  );
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, sessionId);
}

async function pressNamed(sessionId, keyName, modifiers = 0) {
  const codes = { Enter: 13, Escape: 27, ArrowDown: 40 };
  const base = {
    key: keyName,
    code: keyName,
    windowsVirtualKeyCode: codes[keyName],
    modifiers,
  };
  await send(
    'Input.dispatchKeyEvent',
    { type: 'rawKeyDown', ...base },
    sessionId,
  );
  if (keyName === 'Enter') {
    await send(
      'Input.dispatchKeyEvent',
      { type: 'char', text: '\r', ...base },
      sessionId,
    );
  }
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, sessionId);
}

async function main() {
  await connect();

  // Extension service worker → extension id.
  let extensionId;
  for (let i = 0; i < 50 && !extensionId; i++) {
    const { targetInfos } = await send('Target.getTargets');
    const sw = targetInfos.find(
      (t) =>
        t.type === 'service_worker' && t.url.startsWith('chrome-extension://'),
    );
    if (sw) extensionId = new URL(sw.url).host;
    else await sleep(200);
  }
  check('extension loaded', !!extensionId, browserLog.slice(-500));
  if (!extensionId) return;

  // An extension page (not a monitor) to talk to the background like the panel does.
  const ext = await openTab(`chrome-extension://${extensionId}/options.html`);
  await waitFor(ext.sessionId, 'document.readyState === "complete"');
  const bg = (request) =>
    evaluate(
      ext.sessionId,
      `chrome.runtime.sendMessage(${JSON.stringify(request)})`,
    );
  const tabIdFor = (urlPattern) =>
    evaluate(
      ext.sessionId,
      `chrome.tabs.query({ url: ${JSON.stringify(urlPattern)} }).then((t) => t[0] && t[0].id)`,
    );

  // ------------------------------------------------------------------ Redux
  const rx = await openTab('http://127.0.0.1:8701/cart');
  await waitFor(
    rx.sessionId,
    'window.reduxTest && document.readyState === "complete"',
  );
  await send('Page.bringToFront', {}, rx.sessionId);
  await send(
    'Emulation.setFocusEmulationEnabled',
    { enabled: true },
    rx.sessionId,
  );
  await evaluate(
    rx.sessionId,
    `reduxTest.store.dispatch({type:'inc'}); reduxTest.store.dispatch({type:'inc'}); reduxTest.store.dispatch({type:'add', item:'apple'}); true`,
  );
  // Real Alt+S keypress with no DevTools panel open.
  await sleep(300);
  await key(rx.sessionId, 'KeyS', 's', 1);
  let list = await waitFor(
    ext.sessionId,
    `chrome.runtime.sendMessage({type:'RESPAWN/LIST'}).then(r => r.checkpoints.length ? r : null)`,
  );
  const rxCheckpoint = list.checkpoints[0];
  check(
    'redux: Alt+S saves a checkpoint',
    rxCheckpoint?.route === '/cart' && rxCheckpoint?.name === '/cart',
    rxCheckpoint,
  );
  check(
    'redux: toast shown in page',
    await waitFor(
      rx.sessionId,
      `!!document.getElementById('respawn-toast-host')`,
      3000,
    ),
    null,
  );

  const exported = await bg({ type: 'RESPAWN/EXPORT', id: rxCheckpoint.id });
  check(
    'redux: saved state is the app state',
    exported.ok && exported.record.state.count === 2,
    exported,
  );

  // Diverge: more actions and a different route.
  await evaluate(
    rx.sessionId,
    `reduxTest.store.dispatch({type:'inc'}); reduxTest.store.dispatch({type:'add', item:'pear'}); history.pushState(null,'','/elsewhere'); dispatchEvent(new PopStateEvent('popstate')); true`,
  );
  const rxTab = await tabIdFor('http://127.0.0.1:8701/*');
  const rendersBefore = await evaluate(
    rx.sessionId,
    'reduxTest.routerRenders()',
  );
  const restored = await bg({
    type: 'RESPAWN/RESTORE',
    id: rxCheckpoint.id,
    tabId: rxTab,
  });
  check('redux: restore responds ok', restored.ok, restored);
  const rxState = await waitFor(
    rx.sessionId,
    `(() => { const s = reduxTest.store.getState(); return s.count === 2 && s.items.join() === 'apple' ? s : null })()`,
    4000,
  ).catch((e) => e.message);
  check('redux: state restored', typeof rxState === 'object', rxState);
  check(
    'redux: route restored',
    (await evaluate(rx.sessionId, 'location.pathname')) === '/cart',
    null,
  );
  check(
    'redux: router saw popstate',
    (await evaluate(rx.sessionId, 'reduxTest.routerRenders()')) > rendersBefore,
    null,
  );

  // Relative navigation keeps state.
  const nav = await bg({
    type: 'RESPAWN/NAVIGATE',
    route: './detail',
    tabId: rxTab,
  });
  check(
    'redux: ./detail resolves to /cart/detail',
    nav.ok && nav.route === '/cart/detail',
    nav,
  );
  check(
    'redux: navigate keeps state',
    (await evaluate(
      rx.sessionId,
      'location.pathname + "|" + reduxTest.store.getState().count',
    )) === '/cart/detail|2',
    null,
  );
  const up = await bg({ type: 'RESPAWN/NAVIGATE', route: '../', tabId: rxTab });
  check('redux: ../ goes up one level', up.ok && up.route === '/cart', up);
  const bad = await bg({
    type: 'RESPAWN/NAVIGATE',
    route: 'detail',
    tabId: rxTab,
  });
  check(
    'redux: non-route rejected',
    !bad.ok && /not a route/.test(bad.error),
    bad,
  );

  // Palette: Alt+P, type a relative route, Enter.
  await send('Page.bringToFront', {}, rx.sessionId);
  await key(rx.sessionId, 'KeyP', 'p', 1);
  const opened = await waitFor(
    rx.sessionId,
    `!!document.getElementById('respawn-palette-host')`,
    3000,
  ).catch(() => false);
  check('palette: Alt+P opens', opened, null);
  const rows = await waitFor(
    rx.sessionId,
    `(() => { const r = document.getElementById('respawn-palette-host').shadowRoot.querySelectorAll('.row .title'); return r.length > 1 ? [...r].map(e => e.textContent) : null })()`,
    3000,
  ).catch((e) => e.message);
  check(
    'palette: lists the checkpoint + save',
    Array.isArray(rows) &&
      rows.includes('/cart') &&
      rows.some((t) => t.startsWith('Save')),
    rows,
  );
  await send('Input.insertText', { text: './x' }, rx.sessionId);
  const goRow = await waitFor(
    rx.sessionId,
    `document.getElementById('respawn-palette-host').shadowRoot.querySelector('.row.active .title')?.textContent`,
    2000,
  ).catch((e) => e.message);
  check('palette: route query shows Go row', goRow === '/cart/x', goRow);
  await pressNamed(rx.sessionId, 'Enter');
  const navigated = await waitFor(
    rx.sessionId,
    `location.pathname === '/cart/x'`,
    3000,
  ).catch(() => false);
  check(
    'palette: Enter on Go row navigates',
    navigated,
    await evaluate(rx.sessionId, 'location.pathname'),
  );
  check(
    'palette: closes after action',
    await waitFor(
      rx.sessionId,
      `!document.getElementById('respawn-palette-host')`,
      2000,
    ).catch(() => false),
    null,
  );

  // Palette: Shift+Enter on a checkpoint navigates without restoring.
  await evaluate(rx.sessionId, `reduxTest.store.dispatch({type:'inc'}); true`);
  const countBefore = await evaluate(
    rx.sessionId,
    'reduxTest.store.getState().count',
  );
  await key(rx.sessionId, 'KeyP', 'p', 1);
  await waitFor(
    rx.sessionId,
    `document.getElementById('respawn-palette-host')?.shadowRoot.querySelector('.row.active .title')?.textContent === '/cart'`,
    3000,
  );
  await pressNamed(rx.sessionId, 'Enter', 8 /* Shift */);
  const shiftNav = await waitFor(
    rx.sessionId,
    `location.pathname === '/cart'`,
    3000,
  ).catch(() => false);
  check(
    'palette: Shift+Enter goes without restoring',
    shiftNav &&
      (await evaluate(rx.sessionId, 'reduxTest.store.getState().count')) ===
        countBefore,
    await evaluate(
      rx.sessionId,
      'location.pathname + "|" + reduxTest.store.getState().count',
    ),
  );

  // Palette: Enter on a checkpoint restores.
  await waitFor(
    rx.sessionId,
    `!document.getElementById('respawn-palette-host')`,
    3000,
  );
  await key(rx.sessionId, 'KeyP', 'p', 1);
  await waitFor(
    rx.sessionId,
    `document.getElementById('respawn-palette-host')?.shadowRoot.querySelector('.row.active .title')?.textContent === '/cart'`,
    3000,
  );
  await pressNamed(rx.sessionId, 'Enter');
  const paletteRestore = await waitFor(
    rx.sessionId,
    `reduxTest.store.getState().count === 2`,
    3000,
  ).catch(() => false);
  check(
    'palette: Enter restores',
    paletteRestore,
    await evaluate(rx.sessionId, 'reduxTest.store.getState()'),
  );
  // Restore resolves before the palette has finished closing; wait for it so the
  // inspector is no longer suppressed by the palette.
  await waitFor(
    rx.sessionId,
    `!document.getElementById('respawn-palette-host')`,
    3000,
  );

  // ---------------------------------------------------------------- Inspector
  // The host mounts on every page; the overlay only draws while a tool is on.
  check(
    'inspector: host mounts with a shadow root',
    await waitFor(
      rx.sessionId,
      `!!document.getElementById('respawn-inspector-host')?.shadowRoot`,
      3000,
    ).catch(() => false),
    null,
  );

  // Count page clicks to prove inspect mode consumes them.
  await evaluate(
    rx.sessionId,
    `window.__respawnClicks = 0;
     document.addEventListener('click', () => { window.__respawnClicks += 1; }, true);
     true`,
  );

  const rectOf = (id) =>
    evaluate(
      rx.sessionId,
      `(() => {
        const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, width: r.width, height: r.height };
      })()`,
    );
  const inspectShadow = (expression) =>
    evaluate(
      rx.sessionId,
      `(() => {
        const root = document.getElementById('respawn-inspector-host')?.shadowRoot;
        if (!root) return null;
        return (${expression})(root);
      })()`,
    );

  const stateRect = await rectOf('state');
  await key(rx.sessionId, 'KeyI', 'i', 1 /* Alt */);
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: stateRect.x, y: stateRect.y, button: 'none' },
    rx.sessionId,
  );
  const hoverBox = await waitFor(
    rx.sessionId,
    `(() => {
      const b = document.getElementById('respawn-inspector-host')?.shadowRoot?.querySelector('.box--hover');
      return b ? { left: b.style.left, top: b.style.top, width: b.style.width, height: b.style.height } : null;
    })()`,
    3000,
  ).catch(() => null);
  check(
    'inspector: Alt+I highlights the element under the pointer',
    hoverBox?.left === `${stateRect.left}px` &&
      hoverBox?.width === `${stateRect.width}px`,
    hoverBox,
  );

  await send(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: stateRect.x, y: stateRect.y, button: 'left', clickCount: 1 },
    rx.sessionId,
  );
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: stateRect.x, y: stateRect.y, button: 'left', clickCount: 1 },
    rx.sessionId,
  );
  const label = await waitFor(
    rx.sessionId,
    `(() => {
      const root = document.getElementById('respawn-inspector-host')?.shadowRoot;
      if (!root?.querySelector('.box--outline')) return null;
      return root.querySelector('.label')?.textContent ?? '';
    })()`,
    3000,
  ).catch(() => null);
  check('inspector: click pins the selection', label?.startsWith('pre#state'), label);
  check(
    'inspector: inspect mode swallows the page click',
    (await evaluate(rx.sessionId, 'window.__respawnClicks')) === 0,
    await evaluate(rx.sessionId, 'window.__respawnClicks'),
  );

  // Hold Alt over another element to measure the gap.
  const routeRect = await rectOf('route');
  await send(
    'Input.dispatchKeyEvent',
    { type: 'rawKeyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: 1 },
    rx.sessionId,
  );
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: routeRect.x, y: routeRect.y, button: 'none' },
    rx.sessionId,
  );
  const distanceTag = await waitFor(
    rx.sessionId,
    `document.getElementById('respawn-inspector-host')?.shadowRoot?.querySelector('.distance-tag')?.textContent ?? null`,
    3000,
  ).catch(() => null);
  check('inspector: holding Alt measures the distance', /^\d+$/.test(distanceTag ?? ''), distanceTag);
  await send(
    'Input.dispatchKeyEvent',
    { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 },
    rx.sessionId,
  );

  await pressNamed(rx.sessionId, 'Escape');
  check(
    'inspector: Esc clears the overlay',
    await waitFor(
      rx.sessionId,
      `!document.getElementById('respawn-inspector-host')?.shadowRoot?.querySelector('.box--outline')`,
      2000,
    ).catch(() => false),
    null,
  );

  await send(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: stateRect.x, y: stateRect.y, button: 'left', clickCount: 1 },
    rx.sessionId,
  );
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: stateRect.x, y: stateRect.y, button: 'left', clickCount: 1 },
    rx.sessionId,
  );
  check(
    'inspector: page gets clicks again after Esc',
    (await evaluate(rx.sessionId, 'window.__respawnClicks')) > 0,
    await evaluate(rx.sessionId, 'window.__respawnClicks'),
  );

  // Palette tool rows drive the overlay.
  await key(rx.sessionId, 'KeyP', 'p', 1);
  await waitFor(
    rx.sessionId,
    `!!document.getElementById('respawn-palette-host')?.shadowRoot`,
    3000,
  );
  const toolRows = await evaluate(
    rx.sessionId,
    `(() => {
      const root = document.getElementById('respawn-palette-host')?.shadowRoot;
      return root ? [...root.querySelectorAll('.row .title')].map((e) => e.textContent) : null;
    })()`,
  ).catch(() => null);
  check(
    'inspector: palette lists the tool rows',
    Array.isArray(toolRows) &&
      ['Inspect', 'Type', 'Vertical guides', 'Horizontal guides'].every((name) =>
        toolRows.includes(name),
      ),
    toolRows,
  );

  await send('Input.insertText', { text: 'vertical' }, rx.sessionId);
  await pressNamed(rx.sessionId, 'ArrowDown');
  await pressNamed(rx.sessionId, 'Enter');
  await waitFor(
    rx.sessionId,
    `!document.getElementById('respawn-palette-host')`,
    3000,
  );
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: 300, y: 200, button: 'none' },
    rx.sessionId,
  );
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: 300, y: 200, button: 'left', clickCount: 1 },
    rx.sessionId,
  );
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: 300, y: 200, button: 'left', clickCount: 1 },
    rx.sessionId,
  );
  const guideCount = await inspectShadow(
    `(root) => root.querySelectorAll('.guide--vertical:not(.guide--preview)').length`,
  ).catch(() => 0);
  check('inspector: palette starts guide mode and a click places a guide', guideCount === 1, guideCount);
  await pressNamed(rx.sessionId, 'Escape');

  // Typography overlay from the palette.
  await key(rx.sessionId, 'KeyP', 'p', 1);
  await waitFor(
    rx.sessionId,
    `!!document.getElementById('respawn-palette-host')?.shadowRoot`,
    3000,
  );
  await send('Input.insertText', { text: 'type' }, rx.sessionId);
  await pressNamed(rx.sessionId, 'ArrowDown');
  await pressNamed(rx.sessionId, 'Enter');
  const chips = await waitFor(
    rx.sessionId,
    `(() => {
      const count = document.getElementById('respawn-inspector-host')?.shadowRoot?.querySelectorAll('.chip').length ?? 0;
      return count > 0 ? count : null;
    })()`,
    3000,
  ).catch(() => 0);
  check('inspector: Type annotates visible text blocks', chips > 0, chips);
  await key(rx.sessionId, 'KeyP', 'p', 1);
  await waitFor(
    rx.sessionId,
    `!!document.getElementById('respawn-palette-host')?.shadowRoot`,
    3000,
  );
  await send('Input.insertText', { text: 'type' }, rx.sessionId);
  await pressNamed(rx.sessionId, 'ArrowDown');
  await pressNamed(rx.sessionId, 'Enter');
  await pressNamed(rx.sessionId, 'Escape');

  await mappingCheck(ext, bg);

  if (!HAS_NG) {
    console.log('SKIP NgRx checks (fixtures/ng/main.js not built)');
    await finishRedux(ext, rx, bg, rxCheckpoint);
    return;
  }

  // ------------------------------------------------------------------ NgRx
  const ng = await openTab('http://127.0.0.1:8702/workflow');
  await waitFor(
    ng.sessionId,
    `document.getElementById('page')?.textContent === 'workflow' && window.ngTest`,
    15000,
  );
  await evaluate(ng.sessionId, `ngTest.add('apple'); ngTest.step(2); true`);
  // Let the last ACTION reach the background before asking it to save.
  await sleep(300);
  const ngTab = await tabIdFor('http://127.0.0.1:8702/*');
  const ngSave = await bg({ type: 'RESPAWN/SAVE', tabId: ngTab });
  check(
    'ngrx: save without panel (START wake-up)',
    ngSave.ok && ngSave.checkpoint.route === '/workflow',
    ngSave,
  );
  const ngExport =
    ngSave.ok &&
    (await bg({ type: 'RESPAWN/EXPORT', id: ngSave.checkpoint.id }));
  const ngSaved = ngExport?.ok && ngExport.record.state;
  check(
    'ngrx: saved NgRx root state',
    ngSaved && ngSaved.cart?.join() === 'apple' && ngSaved.wizard?.step === 2,
    ngSaved,
  );
  check(
    'ngrx: instance name recorded',
    ngExport?.record?.instanceName === 'ng e2e',
    ngExport?.record?.instanceName,
  );

  await evaluate(
    ng.sessionId,
    `ngTest.add('pear'); ngTest.step(5); ngTest.navigate('/')`,
  );
  await waitFor(
    ng.sessionId,
    `document.getElementById('page')?.textContent === 'home'`,
  );
  const ngRestore = await bg({
    type: 'RESPAWN/RESTORE',
    id: ngSave.checkpoint.id,
    tabId: ngTab,
  });
  check('ngrx: restore responds ok', ngRestore.ok, ngRestore);
  const ngPage = await waitFor(
    ng.sessionId,
    `document.getElementById('page')?.textContent === 'workflow'`,
    4000,
  ).catch(() => false);
  check(
    'ngrx: Angular Router navigated to /workflow',
    ngPage,
    await evaluate(ng.sessionId, `document.getElementById('url').textContent`),
  );
  const ngState = await waitFor(
    ng.sessionId,
    `(() => { const s = JSON.parse(document.getElementById('state').textContent); return s.cart.join() === 'apple' && s.wizard.step === 2 ? s : null })()`,
    4000,
  ).catch((e) => e.message);
  check('ngrx: store state restored', typeof ngState === 'object', ngState);

  const ngNav = await bg({
    type: 'RESPAWN/NAVIGATE',
    route: './detail',
    tabId: ngTab,
  });
  const ngDetail = await waitFor(
    ng.sessionId,
    `document.getElementById('page')?.textContent === 'detail'`,
    3000,
  ).catch(() => false);
  check(
    'ngrx: ./detail navigates via Angular Router',
    ngNav.ok && ngDetail,
    ngNav,
  );
  check(
    'ngrx: navigation keeps state',
    (await evaluate(
      ng.sessionId,
      `JSON.parse(document.getElementById('state').textContent).wizard.step`,
    )) === 2,
    null,
  );

  // Alt+S on the Angular page too.
  await send('Page.bringToFront', {}, ng.sessionId);
  await send(
    'Emulation.setFocusEmulationEnabled',
    { enabled: true },
    ng.sessionId,
  );
  await key(ng.sessionId, 'KeyS', 's', 1);
  list = await waitFor(
    ext.sessionId,
    `chrome.runtime.sendMessage({type:'RESPAWN/LIST'}).then(r => r.checkpoints.some(c => c.route === '/workflow/detail') ? r : null)`,
    4000,
  ).catch((e) => e.message);
  check('ngrx: Alt+S saves /workflow/detail', typeof list === 'object', list);

  // Restore again with a DevTools monitor connected (devpanel page as a tab).
  const panel = await openTab(
    `chrome-extension://${extensionId}/devpanel.html`,
  );
  await waitFor(panel.sessionId, `document.readyState === 'complete'`);
  await sleep(800);
  await evaluate(ng.sessionId, `ngTest.add('kiwi'); ngTest.navigate('/')`);
  await waitFor(
    ng.sessionId,
    `document.getElementById('page')?.textContent === 'home'`,
  );
  const monitored = await bg({
    type: 'RESPAWN/RESTORE',
    id: ngSave.checkpoint.id,
    tabId: ngTab,
  });
  const monitoredState = await waitFor(
    ng.sessionId,
    `(() => { const s = JSON.parse(document.getElementById('state').textContent); return s.cart.join() === 'apple' && document.getElementById('page').textContent === 'workflow' })()`,
    4000,
  ).catch(() => false);
  check(
    'ngrx: restore with panel open',
    monitored.ok && monitoredState,
    monitored,
  );

  // Rename duplicate guard, rename, delete.
  const rename = await bg({
    type: 'RESPAWN/RENAME',
    id: ngSave.checkpoint.id,
    name: 'Wizard step 2',
  });
  check(
    'rename',
    rename.ok && rename.checkpoint.name === 'Wizard step 2',
    rename,
  );

  // Import an inspector-ng (library) export.
  const imported = await bg({
    type: 'RESPAWN/IMPORT',
    origin: 'http://127.0.0.1:8702',
    data: {
      version: 1,
      id: 'lib',
      name: '/workflow',
      route: '/workflow',
      createdAt: '2026-01-01T00:00:00.000Z',
      state: { cart: ['lib'], wizard: { step: 9 } },
    },
  });
  check(
    'import inspector-ng export',
    imported.ok && imported.checkpoint.name === '/workflow',
    imported,
  );
  const importedRestore = await bg({
    type: 'RESPAWN/RESTORE',
    id: imported.checkpoint.id,
    tabId: ngTab,
  });
  const importedState = await waitFor(
    ng.sessionId,
    `JSON.parse(document.getElementById('state').textContent).wizard.step === 9`,
    4000,
  ).catch(() => false);
  check(
    'restore imported checkpoint',
    importedRestore.ok && importedState,
    importedRestore,
  );

  // Panel UI: switch to the Checkpoints tab and screenshot.
  await send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1000, height: 640, deviceScaleFactor: 1, mobile: false },
    panel.sessionId,
  );
  await evaluate(
    panel.sessionId,
    `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Checkpoints')?.click(); true`,
  );
  const panelText = await waitFor(
    panel.sessionId,
    `document.body.innerText.includes('Wizard step 2') && document.body.innerText`,
    5000,
  ).catch((e) => e.message);
  check(
    'panel: Checkpoints tab renders',
    typeof panelText === 'string' && panelText.includes('Wizard step 2'),
    String(panelText).slice(0, 300),
  );
  await sleep(600);
  const shot = await send(
    'Page.captureScreenshot',
    { format: 'png' },
    panel.sessionId,
  );
  fs.writeFileSync(
    path.join(os.tmpdir(), 'respawn-panel.png'),
    Buffer.from(shot.data, 'base64'),
  );

  await evaluate(
    panel.sessionId,
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Settings')?.click(); true`,
  );
  const settingsText = await waitFor(
    panel.sessionId,
    `document.body.innerText.includes('Site mappings') && document.body.innerText.includes('Any site /app') ? document.body.innerText : null`,
    4000,
  ).catch((e) => e.message);
  check(
    'panel: Site mappings settings render',
    typeof settingsText === 'string',
    String(settingsText).slice(0, 300),
  );
  const settingsShot = await send(
    'Page.captureScreenshot',
    { format: 'png' },
    panel.sessionId,
  );
  fs.writeFileSync(
    path.join(os.tmpdir(), 'respawn-settings.png'),
    Buffer.from(settingsShot.data, 'base64'),
  );

  // Palette screenshot on the redux page.
  await send('Page.bringToFront', {}, rx.sessionId);
  await send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1000, height: 640, deviceScaleFactor: 1, mobile: false },
    rx.sessionId,
  );
  await key(rx.sessionId, 'KeyP', 'p', 1);
  await waitFor(
    rx.sessionId,
    `!!document.getElementById('respawn-palette-host')`,
    3000,
  );
  await sleep(400);
  const pshot = await send(
    'Page.captureScreenshot',
    { format: 'png' },
    rx.sessionId,
  );
  fs.writeFileSync(
    path.join(os.tmpdir(), 'respawn-palette.png'),
    Buffer.from(pshot.data, 'base64'),
  );
  await pressNamed(rx.sessionId, 'Escape');

  // Pages can't trigger hotkeys or palette actions with synthetic events.
  const countBeforeSynthetic = (await bg({ type: 'RESPAWN/LIST' })).checkpoints
    .length;
  await evaluate(
    rx.sessionId,
    `dispatchEvent(new KeyboardEvent('keydown', { altKey: true, code: 'KeyS', key: 's', bubbles: true })); true`,
  );
  await sleep(1000);
  check(
    'synthetic Alt+S is ignored',
    (await bg({ type: 'RESPAWN/LIST' })).checkpoints.length ===
      countBeforeSynthetic,
    null,
  );
  await key(rx.sessionId, 'KeyP', 'p', 1);
  await waitFor(
    rx.sessionId,
    `!!document.getElementById('respawn-palette-host')`,
    3000,
  );
  await evaluate(
    rx.sessionId,
    `document.getElementById('respawn-palette-host').shadowRoot.querySelector('.btn.delete').click(); document.getElementById('respawn-palette-host').shadowRoot.querySelector('.btn.delete').click(); true`,
  );
  await sleep(500);
  check(
    'synthetic palette clicks are ignored',
    (await bg({ type: 'RESPAWN/LIST' })).checkpoints.length ===
      countBeforeSynthetic,
    null,
  );
  await pressNamed(rx.sessionId, 'Escape');

  // Closing the DevTools panel must not leave NgRx deaf (stale saves).
  await send('Target.closeTarget', { targetId: panel.targetId });
  await sleep(800);
  await evaluate(ng.sessionId, `ngTest.add('late'); true`);
  const lateSave = await bg({
    type: 'RESPAWN/SAVE',
    tabId: ngTab,
    name: 'after panel closed',
  });
  const lateExport =
    lateSave.ok &&
    (await bg({ type: 'RESPAWN/EXPORT', id: lateSave.checkpoint.id }));
  check(
    'ngrx: save after closing the panel is fresh',
    !!lateExport?.ok && lateExport.record.state.cart.includes('late'),
    lateExport?.ok ? lateExport.record.state : lateSave,
  );

  // Restore across origins, and respawn into a blank tab.
  const other = await openTab('http://127.0.0.1:8701/');
  await waitFor(
    other.sessionId,
    'window.reduxTest && document.readyState === "complete"',
  );
  const otherTab = await evaluate(
    ext.sessionId,
    `chrome.tabs.query({ url: 'http://127.0.0.1:8701/' }).then((t) => t[0] && t[0].id)`,
  );
  // Palette: Alt+A shows other sites' checkpoints, Alt+E exports one.
  const shadow = `document.getElementById('respawn-palette-host')?.shadowRoot`;
  await send('Page.bringToFront', {}, other.sessionId);
  await key(other.sessionId, 'KeyP', 'p', 1);
  const badge = await waitFor(
    other.sessionId,
    `${shadow}?.querySelector('.tool .badge')?.textContent`,
    3000,
  ).catch((e) => e.message);
  check('palette: globe badge counts other sites', Number(badge) > 0, badge);
  await key(other.sessionId, 'KeyA', 'a', 1);
  const foreign = await waitFor(
    other.sessionId,
    `(() => { const s = [...${shadow}.querySelectorAll('.row .sub')].map(e => e.textContent); return s.some(t => t.startsWith('127.0.0.1:8702')) ? s : null })()`,
    3000,
  ).catch((e) => e.message);
  check(
    'palette: Alt+A lists other sites with their host',
    Array.isArray(foreign),
    foreign,
  );
  const shared = await evaluate(
    ext.sessionId,
    `chrome.storage.local.get('respawn:checkpoints:allSites').then((r) => r['respawn:checkpoints:allSites'])`,
  );
  check(
    'palette: all-sites toggle is stored for the panel',
    shared === true,
    shared,
  );
  await key(other.sessionId, 'KeyE', 'e', 1);
  const exportedToast = await waitFor(
    other.sessionId,
    `document.getElementById('respawn-toast-host')?.shadowRoot.querySelector('.message')?.textContent.startsWith('Exported')`,
    3000,
  ).catch((e) => e.message);
  check(
    'palette: Alt+E exports the active checkpoint',
    exportedToast === true,
    exportedToast,
  );
  await key(other.sessionId, 'KeyA', 'a', 1);
  await pressNamed(other.sessionId, 'Escape');

  // Another origin (e.g. localhost vs. staging) restores in place.
  const here = await bg({
    type: 'RESPAWN/RESTORE',
    id: ngSave.checkpoint.id,
    tabId: otherTab,
  });
  check('cross-origin: restore responds ok', here.ok, here);
  const hereState = await waitFor(
    other.sessionId,
    `location.origin === 'http://127.0.0.1:8701' && location.pathname === '/workflow' && (() => { const s = reduxTest.store.getState(); return s.cart?.join() === 'apple' && s.wizard?.step === 2 })()`,
    6000,
  ).catch((e) => e.message);
  check(
    'cross-origin: state applied on this site at the checkpoint route',
    hereState === true,
    hereState,
  );

  const blank = await openTab('about:blank');
  await sleep(300);
  const blankTab = await evaluate(
    ext.sessionId,
    `chrome.tabs.query({ url: 'about:blank' }).then((t) => Math.max(...t.map((x) => x.id)))`,
  );
  const fromBlank = await bg({
    type: 'RESPAWN/RESTORE',
    id: ngSave.checkpoint.id,
    tabId: blankTab,
    open: true,
  });
  const blankState = await waitFor(
    blank.sessionId,
    `location.href === 'http://127.0.0.1:8702/workflow' && (() => { const s = JSON.parse(document.getElementById('state')?.textContent || 'null'); return !!s && s.cart.join() === 'apple' && s.wizard.step === 2 })()`,
    6000,
  ).catch((e) => e.message);
  check('open: respawn into a blank tab', fromBlank.ok && blankState === true, {
    fromBlank,
    blankState,
  });

  const del = await bg({ type: 'RESPAWN/DELETE', id: rxCheckpoint.id });
  const after = await bg({ type: 'RESPAWN/LIST' });
  check(
    'delete',
    del.ok && !after.checkpoints.some((c) => c.id === rxCheckpoint.id),
    after,
  );
}

// A mapping with a /app prefix on one origin and the root on another.
async function mappingCheck(ext, bg) {
  const source = await openTab('http://127.0.0.1:8701/app/cart');
  await waitFor(
    source.sessionId,
    'window.reduxTest && document.readyState === "complete"',
  );
  await evaluate(
    source.sessionId,
    `reduxTest.store.dispatch({type:'inc'}); reduxTest.store.dispatch({type:'inc'}); reduxTest.store.dispatch({type:'add', item:'apple'}); true`,
  );
  const sourceTab = await evaluate(
    ext.sessionId,
    `chrome.tabs.query({ url: 'http://127.0.0.1:8701/app/cart' }).then((t) => t[0] && t[0].id)`,
  );
  const saved = await bg({
    type: 'RESPAWN/SAVE',
    tabId: sourceTab,
    name: 'mapping source',
  });
  check(
    'mapping: save under /app',
    saved.ok && saved.checkpoint.route === '/app/cart',
    saved,
  );
  if (!saved.ok) return;

  await evaluate(
    ext.sessionId,
    `chrome.storage.sync.set({ 'respawn:siteMappings': ${JSON.stringify([
      {
        id: 'mapping-e2e',
        name: 'Any site /app',
        environments: [
          { id: 'mapping-e2e-any', name: 'Any site', baseUrl: '*/app' },
          { id: 'mapping-e2e-local', name: 'Local', baseUrl: '127.0.0.1:8703' },
        ],
      },
    ])} }).then(() => true)`,
  );

  const target = await openTab('http://127.0.0.1:8703/');
  await waitFor(
    target.sessionId,
    'window.reduxTest && document.readyState === "complete"',
  );
  const targetTab = await evaluate(
    ext.sessionId,
    `chrome.tabs.query({ url: 'http://127.0.0.1:8703/' }).then((t) => t[0] && t[0].id)`,
  );
  const restored = await bg({
    type: 'RESPAWN/RESTORE',
    id: saved.checkpoint.id,
    tabId: targetTab,
  });
  check('mapping: restore responds ok', restored.ok, restored);
  const restoredState = await waitFor(
    target.sessionId,
    `location.pathname === '/cart' && (() => { const s = reduxTest.store.getState(); return s.count === 2 && s.items.join() === 'apple' })()`,
    6000,
  ).catch((e) => e.message);
  const mappingResult = await evaluate(
    target.sessionId,
    `({ href: location.href, route: location.pathname, state: reduxTest.store.getState() })`,
  );
  check('mapping: /app maps to localhost root', restoredState === true, {
    restoredState,
    mappingResult,
    checkpoint: saved.checkpoint,
    restored,
  });

  await bg({ type: 'RESPAWN/DELETE', id: saved.checkpoint.id });
  await evaluate(
    ext.sessionId,
    `chrome.storage.sync.remove('respawn:siteMappings').then(() => true)`,
  );
}

// Redux-only ending when the NgRx fixture is missing.
async function finishRedux(ext, rx, bg, rxCheckpoint) {
  const del = await bg({ type: 'RESPAWN/DELETE', id: rxCheckpoint.id });
  const after = await bg({ type: 'RESPAWN/LIST' });
  check(
    'delete',
    del.ok && !after.checkpoints.some((c) => c.id === rxCheckpoint.id),
    after,
  );
}

try {
  await main();
} catch (error) {
  check('run completed', false, error.message);
} finally {
  await cleanup();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}
