'use strict';

const devicesEl = document.getElementById('devices');
const emptyEl = document.getElementById('empty');
const tickEl = document.getElementById('tick');
const lanEl = document.getElementById('lan');
const authUserEl = document.getElementById('auth-user');
const authPassEl = document.getElementById('auth-pass');

let lastState = null;
const ipResults = {}; // udid -> {ok, ip, error}
let authTouched = false;

function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
}

function batteryColor(pct) {
  if (pct == null) return 'var(--muted)';
  if (pct <= 20) return 'var(--red)';
  if (pct <= 40) return 'var(--amber)';
  return 'var(--green)';
}

function render(state) {
  lastState = state;
  lanEl.textContent = state.lan;

  if (!authTouched) {
    authUserEl.value = state.auth.user;
    authPassEl.value = state.auth.pass;
  }

  // Баннер: libimobiledevice недоступен (заряд/имя не читаются, но прокси работает).
  const banner = document.getElementById('tools-banner');
  if (state.toolsAvailable === false) {
    banner.classList.remove('hidden');
    banner.textContent =
      state.platform === 'win32'
        ? 'libimobiledevice не найден — заряд и имя телефона недоступны, но прокси работает. Для показа заряда положи бинарники в папку imobiledevice рядом с приложением.'
        : 'libimobiledevice не найден — заряд недоступен. Установи: brew install libimobiledevice';
  } else {
    banner.classList.add('hidden');
  }
  for (const el of document.querySelectorAll('.win-only')) {
    el.classList.toggle('hidden', state.platform !== 'win32');
  }

  const devices = state.devices || [];
  emptyEl.classList.toggle('hidden', devices.length > 0);
  devicesEl.classList.toggle('hidden', devices.length === 0);

  devicesEl.innerHTML = '';
  for (const d of devices) devicesEl.appendChild(renderCard(d, state));

  const running = devices.filter((d) => d.proxy && d.proxy.running).length;
  tickEl.textContent = `Устройств: ${devices.length} · Активных прокси: ${running} · Интерфейсов найдено: ${state.interfaces.length}`;
}

function renderCard(d, state) {
  const card = document.createElement('div');
  card.className = 'card';

  const running = d.proxy && d.proxy.running;
  const pct = d.battery;

  // --- шапка: имя + статус ---
  const head = document.createElement('div');
  head.className = 'card-head';
  head.innerHTML = `
    <div class="card-title">
      <span class="name">${escapeHtml(d.name)}</span>
      <span class="meta">${escapeHtml(d.model)} · ${d.udid.slice(0, 12)}…</span>
    </div>
    <span class="status-pill ${running ? 'pill-on' : d.trusted ? 'pill-off' : 'pill-warn'}">
      ${running ? 'ПРОКСИ АКТИВЕН' : d.trusted ? 'ГОТОВ' : 'НЕ ДОВЕРЕН'}
    </span>`;
  card.appendChild(head);

  // --- батарея ---
  const bat = document.createElement('div');
  bat.className = 'battery';
  bat.innerHTML = `
    <div class="bat-shell"><div class="bat-fill" style="width:${pct == null ? 0 : pct}%;background:${batteryColor(pct)}"></div></div>
    <span class="bat-label">${pct == null ? '—' : pct + '%'}${d.charging ? ' <span class="charging">⚡</span>' : ''}</span>`;
  card.appendChild(bat);

  // --- выбор интерфейса ---
  const ifaceRow = document.createElement('div');
  ifaceRow.className = 'row';
  const select = document.createElement('select');
  select.disabled = running;
  const optNone = document.createElement('option');
  optNone.value = '';
  optNone.textContent = '— выбрать интерфейс телефона —';
  select.appendChild(optNone);
  let hasInactive = false;
  for (const iface of state.interfaces) {
    const opt = document.createElement('option');
    if (iface.active) {
      opt.value = iface.ip;
      opt.dataset.device = iface.device;
      opt.textContent = `${iface.port} (${iface.device}) · ${iface.ip}`;
      if (d.assignedIp === iface.ip) opt.selected = true;
    } else {
      hasInactive = true;
      opt.value = '';
      opt.disabled = true;
      opt.textContent = `${iface.port} (${iface.device}) · нет IP — включи Режим модема`;
    }
    select.appendChild(opt);
  }
  select.addEventListener('change', async () => {
    const opt = select.selectedOptions[0];
    await window.api.assignInterface({ udid: d.udid, device: opt.dataset.device || null, ip: select.value || null });
  });
  ifaceRow.innerHTML = '<span class="label">Интерфейс</span>';
  ifaceRow.appendChild(select);

  const checkBtn = document.createElement('button');
  checkBtn.className = 'btn small';
  checkBtn.textContent = 'Проверить IP';
  checkBtn.addEventListener('click', async () => {
    const ip = select.value;
    if (!ip) return;
    checkBtn.disabled = true;
    checkBtn.textContent = '…';
    const res = await window.api.checkIp({ ip });
    ipResults[d.udid] = res;
    checkBtn.disabled = false;
    checkBtn.textContent = 'Проверить IP';
    paintIpResult();
  });
  ifaceRow.appendChild(checkBtn);
  card.appendChild(ifaceRow);

  if (hasInactive && !select.value) {
    const warn = document.createElement('div');
    warn.className = 'ip-result err';
    warn.textContent =
      'Интерфейс телефона найден, но без IP. На iPhone открой «Настройки → Режим модема» и держи экран открытым; либо на Mac временно выключи Wi-Fi, чтобы система активировала iPhone USB.';
    card.appendChild(warn);
  }

  const ipRes = document.createElement('div');
  ipRes.className = 'ip-result';
  ipRes.dataset.udid = d.udid;
  const r = ipResults[d.udid];
  if (r) {
    ipRes.classList.add(r.ok ? 'ok' : 'err');
    ipRes.textContent = r.ok ? `Внешний IP через этот телефон: ${r.ip}` : `Ошибка: ${r.error}`;
  }
  card.appendChild(ipRes);

  // --- блок прокси ---
  const box = document.createElement('div');
  box.className = 'proxy-box' + (running ? '' : ' off');
  if (running) {
    box.dataset.udid = d.udid;
    const st = d.proxy.stats || {};
    box.innerHTML = `
      <div class="kv"><span class="k">Адрес прокси</span><span class="v"><code>${state.lan}:${d.proxy.port}</code></span></div>
      <div class="kv"><span class="k">Тип</span><span class="v">HTTP / HTTPS (Basic auth)</span></div>
      <div class="kv"><span class="k">Соединений (активно / всего)</span><span class="v" data-f="conns">${st.active || 0} / ${st.total || 0}</span></div>
      <div class="kv"><span class="k">Скорость ↓ / ↑</span><span class="v" data-f="speed">— / —</span></div>
      <div class="kv"><span class="k">Всего ↓ / ↑</span><span class="v" data-f="total">${fmtBytes(st.bytesDown)} / ${fmtBytes(st.bytesUp)}</span></div>`;
  } else {
    box.innerHTML = `<div class="kv"><span class="k">Прокси выключен</span><span class="v">выбери интерфейс и включи</span></div>`;
  }
  card.appendChild(box);

  // --- кнопка вкл/выкл ---
  const toggle = document.createElement('button');
  toggle.className = 'btn ' + (running ? 'danger' : 'primary');
  toggle.textContent = running ? 'Выключить прокси' : 'Использовать как прокси';
  toggle.disabled = !running && !select.value;
  toggle.addEventListener('click', async () => {
    toggle.disabled = true;
    const res = await window.api.toggleProxy({
      udid: d.udid,
      enable: !running,
      ip: select.value,
      label: d.name,
    });
    if (!res.ok) alert('Ошибка: ' + res.error);
  });
  card.appendChild(toggle);

  return card;
}

function paintIpResult() {
  for (const el of document.querySelectorAll('.ip-result')) {
    const r = ipResults[el.dataset.udid];
    el.classList.remove('ok', 'err');
    if (r) {
      el.classList.add(r.ok ? 'ok' : 'err');
      el.textContent = r.ok ? `Внешний IP через этот телефон: ${r.ip}` : `Ошибка: ${r.error}`;
    }
  }
}

const prevStats = {}; // udid -> { bytesUp, bytesDown, t }

function fmtSpeed(bytesPerSec) {
  return fmtBytes(bytesPerSec) + '/с';
}

function onStats(stats) {
  const now = performance.now();
  for (const [udid, st] of Object.entries(stats)) {
    const box = document.querySelector(`.proxy-box[data-udid="${udid}"]`);
    if (!box) continue;

    const prev = prevStats[udid];
    const conns = box.querySelector('[data-f="conns"]');
    const speed = box.querySelector('[data-f="speed"]');
    const total = box.querySelector('[data-f="total"]');
    if (conns) conns.textContent = `${st.active || 0} / ${st.total || 0}`;
    if (total) total.textContent = `${fmtBytes(st.bytesDown)} / ${fmtBytes(st.bytesUp)}`;

    if (prev && speed) {
      const dt = (now - prev.t) / 1000;
      if (dt > 0) {
        const down = Math.max(0, (st.bytesDown - prev.bytesDown) / dt);
        const up = Math.max(0, (st.bytesUp - prev.bytesUp) / dt);
        speed.textContent = `${fmtSpeed(down)} / ${fmtSpeed(up)}`;
      }
    }
    prevStats[udid] = { bytesUp: st.bytesUp, bytesDown: st.bytesDown, t: now };
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

[authUserEl, authPassEl].forEach((el) => el.addEventListener('input', () => (authTouched = true)));
document.getElementById('save-auth').addEventListener('click', async () => {
  await window.api.setAuth({ user: authUserEl.value.trim(), pass: authPassEl.value.trim() });
  authTouched = false;
});

window.api.onState((state) => render(state));
window.api.onStats((stats) => onStats(stats));
window.api.getState().then((state) => render(state));
