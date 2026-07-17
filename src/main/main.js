'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const https = require('https');

const DeviceManager = require('./deviceManager');
const ProxyManager = require('./proxyManager');
const Config = require('./config');
const { listTetherInterfaces } = require('./interfaceMapper');

let win = null;
let config = null;
let deviceManager = null;
let proxyManager = null;

function createWindow() {
  win = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    title: 'iPhone Proxy',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
}

/**
 * LAN-адрес компьютера, который выдаём клиентам для подключения к прокси.
 * Кросс-платформенно: предпочитаем частные адреса (192.168 / 10 / 172.16-31),
 * исключая подсеть Режима модема и служебные адреса (VPN, link-local).
 */
function lanAddress() {
  const skip = (ip) =>
    ip.startsWith('172.20.10.') || // подсеть iPhone-модема
    ip.startsWith('169.254.') || // link-local
    ip.startsWith('100.'); // частые VPN (Tailscale и т.п.)

  const isPrivateLan = (ip) =>
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip);

  const all = [];
  for (const arr of Object.values(os.networkInterfaces())) {
    for (const a of arr) {
      if (a.family === 'IPv4' && !a.internal && !skip(a.address)) all.push(a.address);
    }
  }
  const lan = all.find(isPrivateLan);
  return lan || all[0] || '127.0.0.1';
}

/** Делает запрос к сервису определения IP через конкретный интерфейс. */
function checkPublicIp(localAddress) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: 'api.ipify.org',
        path: '/?format=json',
        method: 'GET',
        localAddress,
        timeout: 8000,
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve({ ok: true, ip: JSON.parse(body).ip });
          } catch {
            resolve({ ok: false, error: 'Не удалось разобрать ответ' });
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Таймаут (интерфейс без интернета?)' });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.end();
  });
}

/** Собирает полный снимок состояния для UI. */
async function buildState() {
  const realDevices = deviceManager.snapshot();
  const interfaces = await listTetherInterfaces();

  let devices = realDevices.slice();

  // Если libimobiledevice не видит телефоны (напр. Windows без него),
  // но есть активные интерфейсы модема — синтезируем карточки, чтобы
  // прокси всё равно можно было запустить (без заряда/имени).
  if (realDevices.length === 0) {
    for (const iface of interfaces) {
      if (!iface.active) continue;
      devices.push({
        udid: `iface:${iface.device}`,
        name: 'iPhone (USB-модем)',
        model: iface.port,
        productType: null,
        battery: null,
        charging: false,
        trusted: true,
        synthetic: true,
        preferIp: iface.ip,
      });
    }
  }

  const enriched = devices.map((d) => {
    const assignment = config.getAssignment(d.udid) || {};
    const status = proxyManager.getStatus(d.udid);
    return {
      ...d,
      assignedDevice: assignment.device || null,
      assignedIp: assignment.ip || d.preferIp || null,
      proxy: status,
    };
  });
  return {
    devices: enriched,
    interfaces,
    auth: config.auth,
    lan: lanAddress(),
    toolsAvailable: deviceManager.toolsAvailable,
    platform: process.platform,
  };
}

async function pushState() {
  if (!win || win.isDestroyed()) return;
  const state = await buildState();
  win.webContents.send('state', state);
}

/** Лёгкий частый апдейт только статистики прокси (для расчёта скорости). */
function pushStats() {
  if (!win || win.isDestroyed()) return;
  const running = deviceManager.snapshot().filter((d) => proxyManager.isRunning(d.udid));
  if (running.length === 0) return;
  const payload = {};
  for (const d of running) {
    const st = proxyManager.getStatus(d.udid);
    if (st.running) payload[d.udid] = st.stats;
  }
  win.webContents.send('stats', payload);
}

/** При старте поднимает прокси, помеченные enabled, если их интерфейс жив. */
async function restoreProxies() {
  const interfaces = await listTetherInterfaces();
  const activeIps = new Set(interfaces.filter((i) => i.active).map((i) => i.ip));
  for (const [udid, a] of Object.entries(config.allAssignments())) {
    if (a.enabled && a.ip && activeIps.has(a.ip)) {
      try {
        await proxyManager.start(udid, a.ip, udid.slice(0, 8));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Не удалось восстановить прокси', udid, e.message);
      }
    }
  }
  pushState();
}

function registerIpc() {
  ipcMain.handle('get-state', () => buildState());

  ipcMain.handle('assign-interface', (_e, { udid, device, ip }) => {
    config.setAssignment(udid, { device, ip });
    return buildState();
  });

  ipcMain.handle('toggle-proxy', async (_e, { udid, enable, ip, label }) => {
    try {
      if (enable) {
        if (!ip) return { ok: false, error: 'Не выбран интерфейс телефона' };
        const res = await proxyManager.start(udid, ip, label);
        return { ok: true, ...res };
      }
      await proxyManager.stop(udid);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      pushState();
    }
  });

  ipcMain.handle('check-ip', async (_e, { ip }) => {
    if (!ip) return { ok: false, error: 'Нет IP интерфейса' };
    return checkPublicIp(ip);
  });

  ipcMain.handle('set-auth', (_e, { user, pass }) => {
    config.setAuth(user, pass);
    return buildState();
  });
}

app.whenReady().then(() => {
  config = new Config(app.getPath('userData'));
  proxyManager = new ProxyManager(config);
  deviceManager = new DeviceManager({ interval: 4000 });

  deviceManager.on('update', () => pushState());
  deviceManager.start();
  setInterval(pushStats, 1000);
  restoreProxies();

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  await proxyManager.stopAll();
  deviceManager.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  await proxyManager.stopAll();
});
