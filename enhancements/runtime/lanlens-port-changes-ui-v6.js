(() => {
  'use strict';

  const EVENTS = {
    port_opened: '发现新端口',
    port_offline: '端口离线',
  };

  const VALUE_ZH = {
    untracked: '未发现',
    online: '在线',
    offline: '离线',
  };

  let scheduled = false;

  function currentLanguage() {
    try {
      const stored = window.localStorage.getItem('lanlens.language');
      if (stored) return stored;
    } catch (_) {}
    const cookie = document.cookie
      .split(';')
      .map(v => v.trim())
      .find(v => v.startsWith('lanlens_language='));
    return cookie ? cookie.split('=')[1] : 'en';
  }

  function ensureFilterOptions(zh) {
    const select = Array.from(document.querySelectorAll('select')).find(el =>
      Array.from(el.options).some(opt => opt.value === 'online_state_changed')
    );
    if (!select) return;

    Object.entries(EVENTS).forEach(([value, label]) => {
      let option = Array.from(select.options).find(opt => opt.value === value);
      if (!option) {
        option = document.createElement('option');
        option.value = value;
        option.textContent = value.replace(/_/g, ' ');
        select.appendChild(option);
      }
      if (!option.dataset.llPortOriginalText) {
        option.dataset.llPortOriginalText = value.replace(/_/g, ' ');
      }
      option.textContent = zh ? label : option.dataset.llPortOriginalText;
    });
  }

  function eventKeyFromText(text) {
    const raw = String(text || '').trim().toLowerCase();
    if (raw === 'port opened' || raw === 'port_opened' || raw === '发现新端口') return 'port_opened';
    if (raw === 'port offline' || raw === 'port_offline' || raw === '端口离线') return 'port_offline';
    return null;
  }

  function enhanceRow(row, zh) {
    const badge = Array.from(row.querySelectorAll('span')).find(el => eventKeyFromText(el.textContent));
    if (!badge) return;

    const key = eventKeyFromText(badge.textContent);
    if (!badge.dataset.llPortOriginalText) badge.dataset.llPortOriginalText = badge.textContent || '';
    badge.textContent = zh ? EVENTS[key] : badge.dataset.llPortOriginalText;

    const detail = Array.from(row.querySelectorAll('p')).find(el => {
      const text = el.textContent || '';
      return text.includes('·') && !el.classList.contains('rounded-md');
    });
    if (detail) {
      if (!detail.dataset.llPortOriginalText) detail.dataset.llPortOriginalText = detail.textContent || '';
      const raw = detail.dataset.llPortOriginalText;
      detail.textContent = zh ? raw.replace(/\s*·\s*port_scan\s*$/i, ' · 端口扫描') : raw;
    }

    Array.from(row.querySelectorAll('p.rounded-md')).forEach(el => {
      if (!el.dataset.llPortOriginalText) el.dataset.llPortOriginalText = el.textContent || '';
      const raw = el.dataset.llPortOriginalText;
      el.textContent = zh ? (VALUE_ZH[raw.toLowerCase()] || raw) : raw;
    });
  }

  function enhance() {
    scheduled = false;
    if (!/\/changes\/?$/.test(window.location.pathname)) return;
    const zh = currentLanguage() === 'zh';
    ensureFilterOptions(zh);
    document.querySelectorAll('div.divide-y > button').forEach(row => enhanceRow(row, zh));
  }

  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(enhance);
  }

  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', scheduleEnhance);
  window.addEventListener('storage', scheduleEnhance);
  scheduleEnhance();
})();
