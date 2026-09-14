(() => {
  'use strict';

  const EVENT_ZH = {
    device_discovered: '发现设备',
    device_updated: '设备信息变化',
    online_state_changed: '在线状态变化',
    ip_changed: 'IP 地址变化',
    hostname_changed: '主机名变化',
    device_archived: '设备已归档',
    device_unarchived: '设备已取消归档',
    maintenance_updated: '维护状态变化',
    device_merged: '设备已合并',
    cmdb_id_generated: '已生成 CMDB ID',
  };

  const FIELD_ZH = {
    ip_address: 'IP 地址',
    hostname: '主机名',
    is_online: '在线状态',
    is_archived: '归档状态',
    mac_address: 'MAC 地址',
    maintenance: '维护状态',
  };

  const SOURCE_ZH = {
    scan: '扫描',
    monitor: '监控',
    refresh_status: '状态刷新',
    manual: '手动',
    dhcp: 'DHCP',
    arp: 'ARP',
    discovery: '发现',
  };

  const EVENT_LABEL_TO_KEY = Object.fromEntries(
    Object.keys(EVENT_ZH).map(key => [key.replace(/_/g, ' '), key]),
  );

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

  function setLocalizedText(el, translated, zh) {
    if (!el) return;
    if (!el.dataset.llChangesOriginalText) {
      el.dataset.llChangesOriginalText = el.textContent || '';
    }
    const desired = zh ? translated : el.dataset.llChangesOriginalText;
    if (el.textContent !== desired) el.textContent = desired;
  }

  function eventKeyFromLabel(text) {
    const normalized = String(text || '').trim().toLowerCase();
    return EVENT_LABEL_TO_KEY[normalized] || null;
  }

  function zhBoolean(value, field) {
    const raw = String(value ?? '').trim();
    const lower = raw.toLowerCase();
    if (field === 'is_online') {
      if (lower === 'true') return '在线';
      if (lower === 'false') return '离线';
    }
    if (field === 'is_archived') {
      if (lower === 'true') return '已归档';
      if (lower === 'false') return '未归档';
    }
    if (lower === 'true') return '是';
    if (lower === 'false') return '否';
    if (lower === 'none' || lower === 'null') return '无';
    return raw;
  }

  function translateRelativeTime(text) {
    const raw = String(text || '').trim();
    if (!raw) return raw;
    if (/前$|刚刚$/.test(raw)) return raw;
    if (/^just now$/i.test(raw)) return '刚刚';
    if (/^less than a minute ago$/i.test(raw)) return '不到 1 分钟前';
    if (/^a minute ago$/i.test(raw)) return '1 分钟前';
    if (/^an hour ago$/i.test(raw)) return '1 小时前';
    if (/^a day ago$/i.test(raw)) return '1 天前';

    const patterns = [
      [/^about (\d+) hours? ago$/i, '大约 $1 小时前'],
      [/^(\d+) seconds? ago$/i, '$1 秒前'],
      [/^(\d+) minutes? ago$/i, '$1 分钟前'],
      [/^(\d+) hours? ago$/i, '$1 小时前'],
      [/^(\d+) days? ago$/i, '$1 天前'],
      [/^about (\d+) days? ago$/i, '大约 $1 天前'],
      [/^(\d+) weeks? ago$/i, '$1 周前'],
      [/^about (\d+) months? ago$/i, '大约 $1 个月前'],
      [/^(\d+) months? ago$/i, '$1 个月前'],
      [/^about (\d+) years? ago$/i, '大约 $1 年前'],
      [/^(\d+) years? ago$/i, '$1 年前'],
    ];
    for (const [re, replacement] of patterns) {
      if (re.test(raw)) return raw.replace(re, replacement);
    }
    return raw;
  }

  function translateDetail(original) {
    const raw = String(original || '').trim();
    const parts = raw.split('·').map(v => v.trim());
    if (parts.length < 2) return FIELD_ZH[raw] || raw;
    const field = parts[0];
    const source = parts.slice(1).join(' · ');
    return `${FIELD_ZH[field] || field} · ${SOURCE_ZH[source] || source}`;
  }

  function enhanceFilters(zh) {
    document.querySelectorAll('select option').forEach(option => {
      const key = option.value;
      if (!EVENT_ZH[key]) return;
      if (!option.dataset.llChangesOriginalText) {
        option.dataset.llChangesOriginalText = option.textContent || '';
      }
      const desired = zh ? EVENT_ZH[key] : option.dataset.llChangesOriginalText;
      if (option.textContent !== desired) option.textContent = desired;
    });
  }

  function enhanceRow(row, zh) {
    const badge = Array.from(row.querySelectorAll('span')).find(el => {
      const original = el.dataset.llChangesOriginalText || el.textContent || '';
      return !!eventKeyFromLabel(original);
    });

    let eventKey = null;
    if (badge) {
      const original = badge.dataset.llChangesOriginalText || badge.textContent || '';
      eventKey = eventKeyFromLabel(original);
      if (eventKey) setLocalizedText(badge, EVENT_ZH[eventKey], zh);
    }

    const detailEl = Array.from(row.querySelectorAll('p')).find(el => {
      const original = el.dataset.llChangesOriginalText || el.textContent || '';
      return original.includes('·') && !el.classList.contains('rounded-md');
    });

    let field = '';
    if (detailEl) {
      const original = detailEl.dataset.llChangesOriginalText || detailEl.textContent || '';
      field = original.split('·')[0].trim();
      setLocalizedText(detailEl, translateDetail(original), zh);
    }

    const valueEls = Array.from(row.querySelectorAll('p.rounded-md'));
    valueEls.forEach(el => {
      if (!el.dataset.llChangesOriginalText) {
        el.dataset.llChangesOriginalText = el.textContent || '';
      }
      const original = el.dataset.llChangesOriginalText;
      const translated = zhBoolean(original, field);
      const desired = zh ? translated : original;
      if (el.textContent !== desired) el.textContent = desired;
    });

    const timeEl = Array.from(row.children).find(el =>
      el instanceof HTMLElement &&
      el.classList.contains('text-xs') &&
      el.classList.contains('text-text-subtle')
    );
    if (timeEl) {
      if (!timeEl.dataset.llChangesOriginalText) {
        timeEl.dataset.llChangesOriginalText = timeEl.textContent || '';
      }
      const original = timeEl.dataset.llChangesOriginalText;
      const desired = zh ? translateRelativeTime(original) : original;
      if (timeEl.textContent !== desired) timeEl.textContent = desired;
    }
  }

  function enhance() {
    scheduled = false;
    if (!/\/changes\/?$/.test(window.location.pathname)) return;
    const zh = currentLanguage() === 'zh';
    enhanceFilters(zh);
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
