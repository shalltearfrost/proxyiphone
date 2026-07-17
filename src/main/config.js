'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Простое хранилище настроек в JSON-файле в userData.
 * Хранит логин/пароль прокси, базовый порт и привязки телефон→интерфейс.
 */
class Config {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'config.json');
    this.data = {
      auth: { user: 'proxy', pass: randomPass() },
      basePort: 8100,
      // udid -> { device, ip, port, enabled }
      assignments: {},
    };
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = { ...this.data, ...parsed };
    } catch {
      this._save();
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Не удалось сохранить конфиг:', e.message);
    }
  }

  get auth() {
    return this.data.auth;
  }

  setAuth(user, pass) {
    this.data.auth = { user, pass };
    this._save();
  }

  get basePort() {
    return this.data.basePort;
  }

  getAssignment(udid) {
    return this.data.assignments[udid] || null;
  }

  setAssignment(udid, patch) {
    const prev = this.data.assignments[udid] || {};
    this.data.assignments[udid] = { ...prev, ...patch };
    this._save();
    return this.data.assignments[udid];
  }

  allAssignments() {
    return this.data.assignments;
  }

  /** Выдаёт следующий свободный порт, начиная с basePort. */
  nextPort() {
    const used = new Set(
      Object.values(this.data.assignments)
        .map((a) => a.port)
        .filter(Boolean)
    );
    let p = this.data.basePort;
    while (used.has(p)) p += 1;
    return p;
  }
}

function randomPass() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

module.exports = Config;
