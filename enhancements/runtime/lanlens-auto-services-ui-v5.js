(() => {
  'use strict';

  const STATUS_URL = '/api/services/auto-status';
  let statusRows = [];
  let scheduled = false;
  let fetching = false;

  function installStyle() {
    if (document.getElementById('lanlens-auto-services-style-v5')) return;
    const style = document.createElement('style');
    style.id = 'lanlens-auto-services-style-v5';
    style.textContent = `
      .ll-auto-status-badge{display:inline-flex;align-items:center;gap:.28rem;border-radius:9999px;padding:.12rem .48rem;font-size:11px;font-weight:600;line-height:1.25;white-space:nowrap}
      .ll-auto-status-online{color:#16a34a;background:rgba(22,163,74,.11);border:1px solid rgba(22,163,74,.22)}
      .ll-auto-status-offline{color:#dc2626;background:rgba(220,38,38,.11);border:1px solid rgba(220,38,38,.24)}
      .ll-auto-status-unknown{color:#64748b;background:rgba(100,116,139,.10);border:1px solid rgba(100,116,139,.20)}
      .ll-auto-endpoint{font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace}
      .ll-notify-port-open{color:#16a34a!important;background:rgba(22,163,74,.11)!important;border-color:rgba(22,163,74,.25)!important}
      .ll-notify-port-offline{color:#dc2626!important;background:rgba(220,38,38,.11)!important;border-color:rgba(220,38,38,.25)!important}
    `;
    document.head.appendChild(style);
  }

  function parseDeviceId(link) {
    if (!link) return null;
    const m = (link.getAttribute('href') || '').match(/\/devices\/(\d+)/);
    return m ? Number(m[1]) : null;
  }

  function parseIp(text) {
    const m = String(text || '').match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    return m ? m[0] : null;
  }

  function endpointFromHref(href) {
    if (!href) return { port: null, transport: 'tcp' };
    try {
      const u = new URL(href, window.location.origin);
      const scheme = u.protocol.replace(':', '').toLowerCase();
      let port = u.port ? Number(u.port) : null;
      if (!port && scheme === 'http') port = 80;
      if (!port && scheme === 'https') port = 443;
      return { port, transport: scheme === 'udp' ? 'udp' : 'tcp' };
    } catch (_) {
      const m = String(href).match(/:(\d{1,5})(?:\/|$)/);
      return { port: m ? Number(m[1]) : null, transport: String(href).startsWith('udp:') ? 'udp' : 'tcp' };
    }
  }

  function endpointFromCard(card) {
    const external = card.querySelector('a[target="_blank"]');
    if (external) {
      const ep = endpointFromHref(external.getAttribute('href'));
      if (ep.port) return ep;
    }
    const text = card.textContent || '';
    const m = text.match(/:(\d{1,5})\b/);
    return { port: m ? Number(m[1]) : null, transport: /\bUDP\b/i.test(text) ? 'udp' : 'tcp' };
  }

  function statusFor(deviceId, port, transport) {
    if (!deviceId || !port) return null;
    const exact = statusRows.find(r => Number(r.device_id) === Number(deviceId) && Number(r.port) === Number(port) && String(r.transport || 'tcp').toLowerCase() === transport);
    if (exact) return exact;
    const samePort = statusRows.filter(r => Number(r.device_id) === Number(deviceId) && Number(r.port) === Number(port));
    if (!samePort.length) return null;
    if (samePort.some(r => r.online)) return { ...samePort[0], online: true };
    return samePort[0];
  }

  function makeBadge(row) {
    const span = document.createElement('span');
    span.className = 'll-auto-status-badge ' + (row ? (row.online ? 'll-auto-status-online' : 'll-auto-status-offline') : 'll-auto-status-unknown');
    span.textContent = row ? (row.online ? '● 在线' : '● 离线') : '● 未检测';
    if (row?.last_checked_at) span.title = `最后检测：${new Date(row.last_checked_at).toLocaleString()}`;
    return span;
  }

  function updateBadge(container, row) {
    if (!container) return;
    const expectedText = row ? (row.online ? '● 在线' : '● 离线') : '● 未检测';
    const expectedClass = 'll-auto-status-badge ' + (row ? (row.online ? 'll-auto-status-online' : 'll-auto-status-offline') : 'll-auto-status-unknown');
    const expectedTitle = row?.last_checked_at ? `最后检测：${new Date(row.last_checked_at).toLocaleString()}` : '';
    let badge = Array.from(container.children).find(el => el.classList?.contains('ll-auto-status-badge'));
    if (!badge) {
      badge = makeBadge(row);
      container.appendChild(badge);
      return;
    }
    if (badge.textContent !== expectedText) badge.textContent = expectedText;
    if (badge.className !== expectedClass) badge.className = expectedClass;
    if ((badge.getAttribute('title') || '') !== expectedTitle) {
      if (expectedTitle) badge.setAttribute('title', expectedTitle); else badge.removeAttribute('title');
    }
  }

  function isStockServiceCard(el) {
    if (!(el instanceof HTMLElement)) return false;
    const c = el.classList;
    if (!(c.contains('border') && c.contains('border-border') && c.contains('rounded-xl') && c.contains('overflow-hidden'))) return false;
    if (!c.contains('bg-surface2/40')) return false;
    const first = el.firstElementChild;
    return !!(first && first.classList.contains('flex') && first.classList.contains('items-center') && first.classList.contains('px-3'));
  }

  function serviceCardsOnDevicePage() {
    return Array.from(document.querySelectorAll('div')).filter(isStockServiceCard);
  }

  function enhanceGlobalServices() {
    if (!/\/services\/?$/.test(window.location.pathname)) return;
    document.querySelectorAll('section').forEach(section => {
      const grid = Array.from(section.children).find(el => el instanceof HTMLElement && el.classList.contains('grid'));
      if (!grid) return;
      const cards = Array.from(grid.children).filter(card => card.querySelector?.('a[href*="/devices/"]'));
      cards.forEach(card => {
        const deviceLink = card.querySelector('a[href*="/devices/"]');
        const deviceId = parseDeviceId(deviceLink);
        const ip = parseIp(deviceLink?.textContent || '') || statusRows.find(r => Number(r.device_id) === Number(deviceId))?.device_ip || null;
        const ep = endpointFromCard(card);
        const row = statusFor(deviceId, ep.port, ep.transport);
        if (deviceLink && ip && ep.port) {
          deviceLink.textContent = `${ip}:${ep.port} →`;
          deviceLink.classList.add('ll-auto-endpoint');
        }
        const header = Array.from(card.querySelectorAll('div')).find(el => el.classList.contains('flex-wrap') && el.querySelector('h2'));
        updateBadge(header, row);
      });
    });
  }

  function enhanceDeviceServices() {
    const dm = window.location.pathname.match(/\/devices\/(\d+)/);
    if (!dm) return;
    const deviceId = Number(dm[1]);
    const cards = serviceCardsOnDevicePage();
    cards.forEach(card => {
      const ep = endpointFromCard(card);
      const row = statusFor(deviceId, ep.port, ep.transport);
      const header = Array.from(card.querySelectorAll('div')).find(el => el.classList.contains('flex-wrap') && el.querySelector('span'));
      updateBadge(header, row);
    });
  }

  function currentLanguage() {
    try {
      const stored = window.localStorage.getItem('lanlens.language');
      if (stored) return stored;
    } catch (_) {}
    const cookie = document.cookie.split(';').map(v => v.trim()).find(v => v.startsWith('lanlens_language='));
    return cookie ? cookie.split('=')[1] : 'en';
  }

  function zhValue(value) {
    const raw = String(value ?? '').trim();
    if (raw === 'True' || raw === 'true') return '是';
    if (raw === 'False' || raw === 'false') return '否';
    if (raw === 'Unknown' || raw === 'unknown') return '未知';
    if (raw === 'Unknown vendor') return '未知厂商';
    return raw;
  }

  function zhField(field) {
    const map = {
      ip_address: 'IP 地址',
      hostname: '主机名',
      is_online: '在线状态',
      is_archived: '归档状态',
      mac_address: 'MAC 地址',
    };
    return map[field] || field;
  }

  function translateNotificationMessage(text) {
    const original = String(text || '').trim();
    if (!original) return original;
    if (/^(发现新端口|端口离线)：/.test(original)) return original;

    let m = original.match(/^New port discovered:\s*(.*)$/i);
    if (m) return `发现新端口：${m[1]}`;
    m = original.match(/^Port offline:\s*(.*)$/i);
    if (m) return `端口离线：${m[1]}`;

    m = original.match(/^New device detected:\s*(.*?)\s+at\s+([^\s]+)\s+\((.*?)\)$/i);
    if (m) return `发现新设备：${zhValue(m[1])}，IP ${m[2]}（${m[3]}）`;

    m = original.match(/^Network security:\s*unknown DHCP server observed\s*\((.*?)\)$/i);
    if (m) return `网络安全：发现未知 DHCP 服务器（${m[1]}）`;

    m = original.match(/^Network change:\s*([^()]+?)(?:\s*\((.*)\))?$/i);
    if (m) {
      const eventKey = m[1].trim().toLowerCase();
      const eventMap = {
        'ip changed': 'IP 地址变化',
        'hostname changed': '主机名变化',
        'online state changed': '在线状态变化',
        'device archived': '设备已归档',
        'device unarchived': '设备已取消归档',
        'mac drift detected': 'MAC 地址变化',
        'device archive change': '设备归档状态变化',
        'unknown dhcp server': '未知 DHCP 服务器',
      };
      let label = eventMap[eventKey] || m[1].trim();
      if (!m[2]) return `网络变化：${label}`;
      const detail = m[2].match(/^([^:]+):\s*(.*?)\s*->\s*(.*)$/);
      if (detail) {
        const field = zhField(detail[1].trim());
        const oldValue = zhValue(detail[2]);
        const newValue = zhValue(detail[3]);
        if (eventKey === 'online state changed') {
          label = newValue === '是' ? '设备上线' : newValue === '否' ? '设备离线' : label;
        }
        return `网络变化：${label}（${field}：${oldValue} → ${newValue}）`;
      }
      return `网络变化：${label}（${m[2]}）`;
    }

    return original
      .replace(/\bUnknown vendor\b/g, '未知厂商')
      .replace(/\bUnknown\b/g, '未知');
  }

  function enhanceNotifications() {
    if (!/\/notifications\/?$/.test(window.location.pathname)) return;
    const zh = currentLanguage() === 'zh';
    const messages = Array.from(document.querySelectorAll('p.text-sm.text-text-muted.leading-relaxed'));
    messages.forEach(messageEl => {
      if (!messageEl.dataset.llOriginalText) messageEl.dataset.llOriginalText = messageEl.textContent || '';
      const original = messageEl.dataset.llOriginalText || '';
      const display = zh ? translateNotificationMessage(original) : original;
      if (messageEl.textContent !== display) messageEl.textContent = display;

      const card = messageEl.closest('div.flex.items-start.gap-3.p-4');
      if (!card) return;
      const badge = card.querySelector('div.flex.items-center.gap-2.mb-1 span');
      if (!badge) return;
      if (!badge.dataset.llOriginalText) badge.dataset.llOriginalText = badge.textContent || '';
      badge.classList.remove('ll-notify-port-open', 'll-notify-port-offline');
      if (!zh) {
        badge.textContent = badge.dataset.llOriginalText || badge.textContent;
        return;
      }
      if (/^发现新端口：/.test(display)) {
        badge.textContent = '发现新端口';
        badge.classList.add('ll-notify-port-open');
      } else if (/^端口离线：/.test(display)) {
        badge.textContent = '端口离线';
        badge.classList.add('ll-notify-port-offline');
      }
    });
  }

  function enhance() {
    scheduled = false;
    installStyle();
    try { enhanceGlobalServices(); } catch (err) { console.warn('[LanLens auto-services v5] global UI enhancement failed', err); }
    try { enhanceDeviceServices(); } catch (err) { console.warn('[LanLens auto-services v5] device UI enhancement failed', err); }
    try { enhanceNotifications(); } catch (err) { console.warn('[LanLens auto-services v5] notification localization failed', err); }
  }

  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(enhance);
  }

  async function refreshStatus() {
    if (fetching) return;
    fetching = true;
    try {
      const res = await fetch(STATUS_URL, { credentials: 'same-origin', cache: 'no-store' });
      if (res.ok) statusRows = await res.json();
    } catch (_) {
      // Keep the stock UI usable even if the optional extension endpoint is unavailable.
    } finally {
      fetching = false;
      scheduleEnhance();
    }
  }

  installStyle();
  refreshStatus();
  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', () => { refreshStatus(); scheduleEnhance(); });
  setInterval(refreshStatus, 10000);
})();
