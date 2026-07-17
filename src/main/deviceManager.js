'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');

const EXE = process.platform === 'win32' ? '.exe' : '';

/**
 * Ищет бинарники libimobiledevice (ideviceinfo / idevice_id) в разных местах,
 * чтобы работать и на macOS (Homebrew), и на Windows (bundled рядом с приложением).
 * Возвращает полный путь к бинарю или голое имя (расчёт на PATH).
 */
function resolveBin(name) {
  const exe = name + EXE;
  const candidates = [];

  if (process.env.IMOBILEDEVICE_DIR) candidates.push(path.join(process.env.IMOBILEDEVICE_DIR, exe));

  // Бинарники, поставляемые вместе с приложением.
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'imobiledevice', exe));
  // Режим разработки: vendor/imobiledevice/<platform>/
  candidates.push(path.join(__dirname, '..', '..', 'vendor', 'imobiledevice', process.platform, exe));

  if (process.platform === 'darwin') {
    candidates.push(path.join('/opt/homebrew/bin', exe));
    candidates.push(path.join('/usr/local/bin', exe));
  }

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return exe; // расчёт на PATH
}

const IDEVICE_ID = resolveBin('idevice_id');
const IDEVICEINFO = resolveBin('ideviceinfo');

function run(bin, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(String(stdout).trim());
    });
  });
}

/**
 * Опрашивает libimobiledevice и отдаёт список подключённых по USB iPhone
 * с зарядом, именем и моделью. Эмитит 'update' со снимком состояния.
 * Если libimobiledevice недоступен — просто отдаёт пустой список (не падает),
 * а поле toolsAvailable=false позволяет UI подсказать пользователю.
 */
class DeviceManager extends EventEmitter {
  constructor({ interval = 4000 } = {}) {
    super();
    this.interval = interval;
    this.timer = null;
    this.devices = new Map();
    this.toolsAvailable = true;
    this._polling = false;
  }

  start() {
    this.poll();
    this.timer = setInterval(() => this.poll(), this.interval);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async _readDevice(udid) {
    const [name, product, capacityRaw, chargingRaw] = await Promise.all([
      run(IDEVICEINFO, ['-u', udid, '-k', 'DeviceName']),
      run(IDEVICEINFO, ['-u', udid, '-k', 'ProductType']),
      run(IDEVICEINFO, ['-u', udid, '-q', 'com.apple.mobile.battery', '-k', 'BatteryCurrentCapacity']),
      run(IDEVICEINFO, ['-u', udid, '-q', 'com.apple.mobile.battery', '-k', 'BatteryIsCharging']),
    ]);

    const trusted = name !== null;
    const battery = capacityRaw !== null && /^\d+$/.test(capacityRaw) ? parseInt(capacityRaw, 10) : null;

    return {
      udid,
      name: name || 'iPhone (не доверен)',
      model: modelName(product),
      productType: product,
      battery,
      charging: chargingRaw === 'true',
      trusted,
      synthetic: false,
    };
  }

  async poll() {
    if (this._polling) return;
    this._polling = true;
    try {
      const listOut = await run(IDEVICE_ID, ['-l']);
      // null => бинарь не найден/ошибка запуска.
      this.toolsAvailable = listOut !== null;

      const udids = (listOut || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      const infos = await Promise.all(udids.map((u) => this._readDevice(u)));
      const next = new Map();
      for (const info of infos) next.set(info.udid, info);
      this.devices = next;

      this.emit('update', this.snapshot());
    } catch (e) {
      this.emit('error', e);
    } finally {
      this._polling = false;
    }
  }

  snapshot() {
    return Array.from(this.devices.values());
  }
}

function modelName(productType) {
  if (!productType) return 'iPhone';
  const map = {
    'iPhone9,1': 'iPhone 7',
    'iPhone9,3': 'iPhone 7',
    'iPhone9,2': 'iPhone 7 Plus',
    'iPhone9,4': 'iPhone 7 Plus',
    'iPhone10,1': 'iPhone 8',
    'iPhone10,4': 'iPhone 8',
    'iPhone10,2': 'iPhone 8 Plus',
    'iPhone10,5': 'iPhone 8 Plus',
    'iPhone10,3': 'iPhone X',
    'iPhone10,6': 'iPhone X',
  };
  return map[productType] || productType;
}

module.exports = DeviceManager;
