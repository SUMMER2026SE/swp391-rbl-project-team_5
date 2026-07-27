'use strict';

// Browser-level VietTicket Rescue smoke test using the Chrome DevTools
// Protocol built into the locally installed Chrome. No test-only endpoint or
// browser extension is required.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME_PATH = process.env.CHROME_PATH
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const CUSTOMER_EMAIL = process.env.RECOVERY_CUSTOMER_EMAIL
  || 'do.anh.khoa@vietticket.local';
const CUSTOMER_PASSWORD = process.env.DEMO_PASSWORD || 'Demo@VietTicket2026';
const recoveryCaseId = String(process.argv[2] || '').trim();
const verifyOnly = process.argv.includes('--verify-only');

if (!recoveryCaseId) {
  console.error('Usage: node scripts/e2e_recovery_browser.js <recoveryCaseId>');
  process.exit(2);
}

class CdpClient {
  constructor(webSocketUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.socket = new WebSocket(webSocketUrl);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        return;
      }
      if (message.method) this.events.push(message);
    });
  }

  call(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function waitForJson(url, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Chrome has not opened its debugging socket yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function loginCookies() {
  const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: CUSTOMER_EMAIL,
      password: CUSTOMER_PASSWORD,
      remember: false,
    }),
  });
  if (!response.ok) {
    throw new Error(`Customer login failed (${response.status}): ${await response.text()}`);
  }
  return typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
}

function parseCookie(setCookie) {
  const pair = String(setCookie || '').split(';', 1)[0];
  const separator = pair.indexOf('=');
  if (separator <= 0) return null;
  return {
    name: pair.slice(0, separator),
    value: pair.slice(separator + 1),
  };
}

async function waitForExpression(client, expression, {
  timeoutMs = 15000,
  message = 'Timed out waiting for browser state',
} = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await client.call('Runtime.evaluate', {
      expression: `Boolean(${expression})`,
      returnByValue: true,
    });
    if (result.result?.value === true) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(message);
}

async function clickButtonByText(client, text) {
  const result = await client.call('Runtime.evaluate', {
    expression: `(() => {
      const target = ${JSON.stringify(text)};
      const button = [...document.querySelectorAll('button')]
        .find((item) => item.textContent.includes(target) && !item.disabled);
      if (!button) return false;
      button.click();
      return true;
    })()`,
    returnByValue: true,
  });
  if (!result.result?.value) throw new Error(`Button not found or disabled: ${text}`);
}

async function screenshot(client, outputPath) {
  const result = await client.call('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    fromSurface: true,
  });
  fs.writeFileSync(outputPath, Buffer.from(result.data, 'base64'));
}

async function main() {
  if (!fs.existsSync(CHROME_PATH)) throw new Error(`Chrome not found: ${CHROME_PATH}`);

  const debugPort = 9333 + Math.floor(Math.random() * 400);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vietticket-rescue-chrome-'));
  const outputDir = path.resolve(__dirname, '..', 'outputs');
  fs.mkdirSync(outputDir, { recursive: true });
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    '--remote-allow-origins=*',
    '--disable-extensions',
    '--disable-background-networking',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  let client;
  try {
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    const targetResponse = await fetch(
      `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('about:blank')}`,
      { method: 'PUT' },
    );
    const target = await targetResponse.json();
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await Promise.all([
      client.call('Network.enable'),
      client.call('Page.enable'),
      client.call('Runtime.enable'),
      client.call('Log.enable'),
    ]);

    for (const setCookie of await loginCookies()) {
      const cookie = parseCookie(setCookie);
      if (!cookie) continue;
      const result = await client.call('Network.setCookie', {
        ...cookie,
        url: FRONTEND_URL,
        path: '/',
      });
      if (!result.success) throw new Error(`Could not set browser cookie ${cookie.name}`);
    }

    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.call('Page.navigate', {
      url: `${FRONTEND_URL}/rescue/${recoveryCaseId}`,
    });
    const screenshots = [];
    if (verifyOnly) {
      await waitForExpression(
        client,
        `document.body.innerText.includes('Kế hoạch đã được cứu thành công')`,
        { message: 'Replacement success state did not render' },
      );
    } else {
      await waitForExpression(
        client,
        `document.body.innerText.includes('Đổi sang vé này — không thanh toán lại')`,
        { message: 'Recovery option did not render' },
      );
      const desktopBefore = path.join(outputDir, 'recovery-e2e-desktop-before.png');
      await screenshot(client, desktopBefore);
      screenshots.push(desktopBefore);

      await clickButtonByText(client, 'Đổi sang vé này');
      await waitForExpression(
        client,
        `document.body.innerText.includes('Xác nhận đổi vé?')`,
        { message: 'Confirmation dialog did not render' },
      );
      const desktopDialog = path.join(outputDir, 'recovery-e2e-confirmation.png');
      await screenshot(client, desktopDialog);
      screenshots.push(desktopDialog);

      await clickButtonByText(client, 'Xác nhận đổi vé');
      await waitForExpression(
        client,
        `document.body.innerText.includes('Kế hoạch đã được cứu thành công')`,
        { timeoutMs: 20000, message: 'Replacement success state did not render' },
      );
    }
    const desktopAfter = path.join(outputDir, 'recovery-e2e-desktop-after.png');
    await screenshot(client, desktopAfter);
    screenshots.push(desktopAfter);

    const ticketNavigation = await client.call('Runtime.evaluate', {
      expression: `(() => {
        const link = [...document.querySelectorAll('a')]
          .find((item) => item.textContent.includes('Mở e-ticket mới'));
        return link?.href || null;
      })()`,
      returnByValue: true,
    });
    if (!ticketNavigation.result?.value) {
      throw new Error('New e-ticket link did not render');
    }
    await client.call('Page.navigate', { url: ticketNavigation.result.value });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const ticketBody = await client.call('Runtime.evaluate', {
      expression: '({ text: document.body.innerText, path: location.pathname })',
      returnByValue: true,
    });
    if (!ticketBody.result?.value?.text?.toLocaleLowerCase('vi-VN').includes('mã vé để nhập tay')) {
      throw new Error(
        `New QR ticket did not render at ${ticketBody.result?.value?.path}: `
        + String(ticketBody.result?.value?.text || '').slice(0, 300),
      );
    }
    const ticketScreenshot = path.join(outputDir, 'recovery-e2e-new-ticket.png');
    await screenshot(client, ticketScreenshot);
    screenshots.push(ticketScreenshot);

    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await client.call('Page.navigate', {
      url: `${FRONTEND_URL}/rescue/${recoveryCaseId}`,
    });
    await waitForExpression(
      client,
      `document.body.innerText.includes('Kế hoạch đã được cứu thành công')`,
      { message: 'Mobile success state did not render' },
    );
    const mobileAfter = path.join(outputDir, 'recovery-e2e-mobile-after.png');
    await screenshot(client, mobileAfter);
    screenshots.push(mobileAfter);

    const browserErrors = client.events
      .filter((event) => ['Runtime.exceptionThrown', 'Log.entryAdded'].includes(event.method))
      .filter((event) => (
        event.method === 'Runtime.exceptionThrown'
        || ['error', 'warning'].includes(event.params?.entry?.level)
      ));
    if (browserErrors.length > 0) {
      throw new Error(`Browser emitted ${browserErrors.length} error/warning event(s).`);
    }

    const text = await client.call('Runtime.evaluate', {
      expression: 'document.body.innerText',
      returnByValue: true,
    });
    console.log(JSON.stringify({
      success: true,
      recoveryCaseId,
      finalPageContainsSuccess: text.result?.value.includes('Kế hoạch đã được cứu thành công'),
      screenshots,
      browserErrors: browserErrors.length,
    }, null, 2));
  } finally {
    client?.close();
    chrome.kill();
    await new Promise((resolve) => {
      if (chrome.exitCode != null) {
        resolve();
        return;
      }
      const timeout = setTimeout(resolve, 2000);
      chrome.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    if (path.resolve(profileDir).startsWith(path.resolve(os.tmpdir()))) {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      } catch {
        // Chrome may keep a short-lived Windows crash-handler lock. The
        // OS-owned temporary directory is safe to clean on the next reboot.
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
