'use strict';

const os = require('os');
const { execFile } = require('child_process');

/**
 * Ищет сетевые интерфейсы USB-модема iPhone (Режим модема по кабелю).
 * Кросс-платформенно (macOS + Windows). Каждый такой интерфейс на компьютере
 * имеет свой IPv4 — его используем как localAddress, чтобы направить трафик
 * через сотовую сеть именно этой сим-карты.
 *
 * Возвращаем интерфейсы даже без IP (active:false) — чтобы UI показал, что
 * телефон подключён, но Режим модема ещё не активировался.
 *
 * Формат: [{ device, port, ip:string|null, active:boolean }, ...]
 */

const HOTSPOT_PREFIX = '172.20.10.'; // подсеть Режима модема Apple по умолчанию

function ipv4For(device) {
  const arr = os.networkInterfaces()[device];
  if (!arr) return null;
  const v4 = arr.find((a) => a.family === 'IPv4' && !a.internal);
  return v4 ? v4.address : null;
}

/** Все интерфейсы с IP в hotspot-подсети — работает на любой ОС. */
function scanHotspotInterfaces() {
  const out = [];
  for (const [device, arr] of Object.entries(os.networkInterfaces())) {
    for (const a of arr) {
      if (a.family === 'IPv4' && !a.internal && a.address.startsWith(HOTSPOT_PREFIX)) {
        out.push({ device, ip: a.address });
      }
    }
  }
  return out;
}

// ---------- macOS: имена сервисов + «спящие» интерфейсы через networksetup ----------

function macHardwarePorts() {
  return new Promise((resolve) => {
    execFile('/usr/sbin/networksetup', ['-listallhardwareports'], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve([]);
      const ports = [];
      for (const block of String(stdout).split(/\n\s*\n/)) {
        const nameM = block.match(/Hardware Port:\s*(.+)/);
        const devM = block.match(/Device:\s*(\S+)/);
        if (nameM && devM) ports.push({ port: nameM[1].trim(), device: devM[1].trim() });
      }
      resolve(ports);
    });
  });
}

async function listMac() {
  const ports = await macHardwarePorts();
  const result = [];
  const seen = new Set();

  for (const p of ports) {
    if (!/iphone/i.test(p.port)) continue;
    const ip = ipv4For(p.device);
    result.push({ device: p.device, port: p.port, ip, active: !!ip });
    seen.add(p.device);
  }
  for (const h of scanHotspotInterfaces()) {
    if (seen.has(h.device)) continue;
    result.push({ device: h.device, port: 'iPhone USB (?)', ip: h.ip, active: true });
    seen.add(h.device);
  }
  return result;
}

// ---------- Windows: адаптер «Apple Mobile Device Ethernet» ----------

/** Имена адаптеров Apple через PowerShell (для красивых подписей). Не критично. */
function winAppleAdapters() {
  return new Promise((resolve) => {
    const ps =
      "Get-NetAdapter | Where-Object { $_.InterfaceDescription -match 'Apple Mobile Device' } | " +
      'Select-Object -ExpandProperty Name';
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', ps],
      { timeout: 6000, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve([]);
        resolve(
          String(stdout)
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
        );
      }
    );
  });
}

async function listWin() {
  // На Windows os.networkInterfaces() отдаёт «дружелюбные» имена адаптеров.
  const appleNames = await winAppleAdapters().catch(() => []);
  const appleSet = new Set(appleNames);
  const result = [];
  const seen = new Set();

  // 1) интерфейсы в hotspot-подсети (самый надёжный признак активной раздачи).
  for (const h of scanHotspotInterfaces()) {
    const isApple = appleSet.has(h.device);
    result.push({ device: h.device, port: isApple ? h.device : 'iPhone USB', ip: h.ip, active: true });
    seen.add(h.device);
  }
  // 2) Apple-адаптеры без IP (модем ещё не поднялся) — покажем как неактивные.
  for (const name of appleNames) {
    if (seen.has(name)) continue;
    const ip = ipv4For(name);
    result.push({ device: name, port: name, ip, active: !!ip });
    seen.add(name);
  }
  return result;
}

// ---------- прочие ОС / фолбэк ----------

function listGeneric() {
  return scanHotspotInterfaces().map((h) => ({
    device: h.device,
    port: 'iPhone USB',
    ip: h.ip,
    active: true,
  }));
}

async function listTetherInterfaces() {
  let result;
  if (process.platform === 'darwin') result = await listMac();
  else if (process.platform === 'win32') result = await listWin();
  else result = listGeneric();

  result.sort((a, b) => Number(b.active) - Number(a.active));
  return result;
}

module.exports = { listTetherInterfaces };
