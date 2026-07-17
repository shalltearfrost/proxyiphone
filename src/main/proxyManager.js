'use strict';

const ProxyServer = require('./proxyServer');

/**
 * Управляет набором прокси-серверов — по одному на активный телефон.
 */
class ProxyManager {
  constructor(config) {
    this.config = config;
    this.servers = new Map(); // udid -> ProxyServer
  }

  isRunning(udid) {
    return this.servers.has(udid);
  }

  getStatus(udid) {
    const srv = this.servers.get(udid);
    if (!srv) return { running: false };
    return {
      running: true,
      port: srv.port,
      localAddress: srv.localAddress,
      stats: srv.stats,
    };
  }

  /**
   * Запускает прокси для телефона на его интерфейсе.
   * @param {string} udid
   * @param {string} localAddress  IP интерфейса телефона (Mac-сторона)
   * @param {string} label
   */
  async start(udid, localAddress, label) {
    if (this.servers.has(udid)) {
      await this.stop(udid);
    }
    const assignment = this.config.getAssignment(udid) || {};
    const port = assignment.port || this.config.nextPort();

    const srv = new ProxyServer({
      port,
      localAddress,
      auth: this.config.auth,
      label: label || udid.slice(0, 8),
    });
    await srv.start();
    this.servers.set(udid, srv);
    this.config.setAssignment(udid, { device: assignment.device, ip: localAddress, port, enabled: true });
    return { port, localAddress };
  }

  async stop(udid) {
    const srv = this.servers.get(udid);
    if (srv) {
      await srv.stop();
      this.servers.delete(udid);
    }
    const assignment = this.config.getAssignment(udid);
    if (assignment) this.config.setAssignment(udid, { enabled: false });
  }

  async stopAll() {
    await Promise.all(Array.from(this.servers.keys()).map((u) => this.stop(u)));
  }
}

module.exports = ProxyManager;
