'use strict';

const http = require('http');
const net = require('net');

/**
 * HTTP/HTTPS прокси-сервер, привязанный к сетевому интерфейсу конкретного iPhone.
 *
 * Исходящие соединения открываются с localAddress = IP интерфейса телефона,
 * поэтому трафик уходит через сотовую сеть именно этой сим-карты.
 * Поддерживает обычные HTTP-запросы и CONNECT-туннели (HTTPS).
 */
class ProxyServer {
  /**
   * @param {object} opts
   * @param {number} opts.port      порт, который слушаем (на 0.0.0.0)
   * @param {string} opts.localAddress IP Mac-стороны интерфейса телефона
   * @param {{user:string, pass:string}|null} opts.auth  Basic-авторизация
   * @param {string} opts.label     человекочитаемое имя (для логов)
   */
  constructor({ port, localAddress, auth, label }) {
    this.port = port;
    this.localAddress = localAddress;
    this.auth = auth || null;
    this.label = label || `proxy:${port}`;
    this.server = null;
    this.stats = { total: 0, active: 0, bytesUp: 0, bytesDown: 0, errors: 0 };
  }

  _checkAuth(req) {
    if (!this.auth) return true;
    const header = req.headers['proxy-authorization'];
    if (!header) return false;
    const token = header.split(' ')[1] || '';
    let decoded = '';
    try {
      decoded = Buffer.from(token, 'base64').toString('utf8');
    } catch {
      return false;
    }
    const sep = decoded.indexOf(':');
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);
    return user === this.auth.user && pass === this.auth.pass;
  }

  _requireAuth(res) {
    res.writeHead(407, {
      'Proxy-Authenticate': 'Basic realm="iPhone Proxy"',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    res.end('Требуется авторизация прокси');
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this._handleRequest(req, res));
      this.server.on('connect', (req, socket, head) => this._handleConnect(req, socket, head));
      this.server.on('error', (err) => {
        if (this.server && !this.server.listening) reject(err);
      });
      this.server.listen(this.port, '0.0.0.0', () => resolve());
    });
  }

  _handleRequest(req, res) {
    if (!this._checkAuth(req)) return this._requireAuth(res);

    let target;
    try {
      // Для прокси клиент присылает абсолютный URL: GET http://host/path
      target = new URL(req.url);
    } catch {
      res.writeHead(400);
      res.end('Некорректный запрос прокси');
      return;
    }

    const headers = { ...req.headers };
    delete headers['proxy-authorization'];
    delete headers['proxy-connection'];

    const options = {
      host: target.hostname,
      port: target.port || 80,
      method: req.method,
      path: (target.pathname || '/') + (target.search || ''),
      headers,
      localAddress: this.localAddress,
    };

    this.stats.total += 1;
    this.stats.active += 1;

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.on('data', (c) => (this.stats.bytesDown += c.length));
      proxyRes.pipe(res);
    });

    req.on('data', (c) => (this.stats.bytesUp += c.length));

    const done = () => {
      this.stats.active = Math.max(0, this.stats.active - 1);
    };
    proxyReq.on('error', (e) => {
      this.stats.errors += 1;
      done();
      if (!res.headersSent) res.writeHead(502);
      res.end('Ошибка прокси: ' + e.message);
    });
    res.on('close', done);

    req.pipe(proxyReq);
  }

  _handleConnect(req, clientSocket, head) {
    if (!this._checkAuth(req)) {
      clientSocket.write(
        'HTTP/1.1 407 Proxy Authentication Required\r\n' +
          'Proxy-Authenticate: Basic realm="iPhone Proxy"\r\n\r\n'
      );
      clientSocket.end();
      return;
    }

    const [host, portStr] = req.url.split(':');
    const port = parseInt(portStr, 10) || 443;

    this.stats.total += 1;
    this.stats.active += 1;
    const done = () => {
      this.stats.active = Math.max(0, this.stats.active - 1);
    };

    const serverSocket = net.connect(
      { host, port, localAddress: this.localAddress },
      () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head && head.length) serverSocket.write(head);
        serverSocket.pipe(clientSocket);
        clientSocket.pipe(serverSocket);
      }
    );

    serverSocket.on('data', (c) => (this.stats.bytesDown += c.length));
    clientSocket.on('data', (c) => (this.stats.bytesUp += c.length));

    serverSocket.on('error', () => {
      this.stats.errors += 1;
      done();
      clientSocket.end();
    });
    clientSocket.on('error', () => {
      done();
      serverSocket.end();
    });
    serverSocket.on('close', done);
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
    });
  }
}

module.exports = ProxyServer;
