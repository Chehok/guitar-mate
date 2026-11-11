'use strict';
// Display-language layer. Pages are authored in Korean (the default); when English
// is chosen, visible text, labels and later updates are swapped for translations.
// App logic never reads these strings back, so behaviour is identical in both languages.
(function () {
  const STORAGE_KEY = 'guitar-mate:lang';
  const LANGS = ['ko', 'en'];
  let lang = 'ko';
  try { const saved = localStorage.getItem(STORAGE_KEY); if (LANGS.includes(saved)) lang = saved; } catch (_) {}

  const HANGUL = /[가-힣]/;
  const ATTRS = ['aria-label', 'title', 'placeholder', 'data-placeholder', 'alt', 'content', 'aria-roledescription', 'aria-valuetext'];
  const INLINE = new Set(['STRONG', 'B', 'EM', 'BR', 'CODE', 'A', 'SPAN', 'SMALL', 'SUP', 'SUB', 'KBD', 'I', 'MARK', 'ABBR']);
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA']);
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Patterns use {0}, {1}… for values that change at run time. Captured values that
  // are themselves Korean (e.g. "카포 없음") are translated recursively.
  function compile(list) {
    return list.map(([ko, en]) => {
      const parts = ko.split(/\{(\d+)\}/);
      let source = '^';
      const order = [];
      parts.forEach((part, i) => {
        if (i % 2) { order.push(Number(part)); source += '([\\s\\S]*?)'; } else source += escape(part);
      });
      return { re: new RegExp(source + '$'), order, en, weight: parts.filter((_, i) => !(i % 2)).join('').length };
    }).sort((a, b) => b.weight - a.weight);
  }

  const dict = { text: new Map(), html: new Map(), patterns: [], htmlPatterns: [] };
  function load(data) {
    for (const [ko, en] of Object.entries(data.text || {})) dict.text.set(norm(ko), en);
    for (const [ko, en] of Object.entries(data.html || {})) dict.html.set(norm(ko), en);
    dict.patterns = compile(data.patterns || []);
    dict.htmlPatterns = compile(data.htmlPatterns || []);
  }

  function fill(entry, match, translateValue) {
    const values = [];
    entry.order.forEach((index, i) => {
      const part = match[i + 1], lead = part.match(/^\s*/)[0], trail = part.match(/\s*$/)[0];
      values[index] = part.trim() ? lead + translateValue(part) + trail : part;
    });
    return entry.en.replace(/\{(\d+)\}/g, (_, i) => values[Number(i)] ?? '');
  }

  function text(value) {
    if (lang === 'ko' || typeof value !== 'string' || !HANGUL.test(value)) return value;
    const key = norm(value);
    if (dict.text.has(key)) return dict.text.get(key);
    // A leading separator (from concatenation like " · 전주 1개") is kept as is.
    const lead = /^([·,:\s]+)(.*)$/.exec(key);
    if (lead && HANGUL.test(lead[2])) { const rest = text(lead[2]); if (rest !== lead[2]) return lead[1] + rest; }
    for (const entry of dict.patterns) {
      const match = entry.re.exec(key);
      // Short patterns like "{0}프렛" must not swallow whole lists such as "뮤트, 3프렛, 2프렛".
      if (match && !(entry.weight < 6 && match.slice(1).some(part => /, | · /.test(part)))) return fill(entry, match, text);
    }
    if (key.includes(', ')) {
      const parts = key.split(', ');
      const next = parts.map(text);
      if (next.some((part, i) => part !== parts[i])) return next.join(', ');
    }
    // Labels joined with " · " (e.g. "슬래시 코드 · 전위형 · 생략: 5") are translated piece by piece.
    if (key.includes(' · ')) {
      const parts = key.split(' · ');
      const next = parts.map(text);
      if (next.some((part, i) => part !== parts[i])) return next.join(' · ');
    }
    return value;
  }

  function html(value) {
    const key = norm(value);
    if (dict.html.has(key)) return dict.html.get(key);
    for (const entry of dict.htmlPatterns) {
      const match = entry.re.exec(key);
      if (match) return fill(entry, match, part => (HANGUL.test(part) ? text(part) : part));
    }
    return null;
  }

  function translateAttributes(el) {
    if (el.closest('[translate=no]')) return;
    for (const name of ATTRS) {
      const value = el.getAttribute(name);
      if (value && HANGUL.test(value)) {
        const next = text(value);
        if (next !== value) el.setAttribute(name, next);
      }
    }
  }

  function translateTextNode(node) {
    if (node.parentElement?.closest('[translate=no]')) return;
    const value = node.data;
    if (!HANGUL.test(value)) return;
    const next = text(value);
    if (next === value) return;
    const lead = value.match(/^\s*/)[0], trail = value.match(/\s*$/)[0];
    node.data = lead + next + trail;
  }

  // Elements that mix text with simple inline markup are translated as a whole,
  // so word order can change; anything interactive inside is left in place.
  function mixed(el) {
    let hasText = false, hasElement = false;
    for (const child of el.childNodes) {
      if (child.nodeType === 3 && child.data.trim()) hasText = true;
      else if (child.nodeType === 1) { if (!INLINE.has(child.tagName)) return false; hasElement = true; }
    }
    return hasText && hasElement;
  }

  function translateBlock(el) {
    if (el.closest('[translate=no]') || !mixed(el) || !HANGUL.test(el.textContent)) return false;
    const next = html(el.innerHTML);
    if (next === null) return false;
    el.innerHTML = next;
    el.querySelectorAll('*').forEach(translateAttributes);
    return true;
  }

  function translateTree(node) {
    if (node.nodeType === 3) { translateTextNode(node); return; }
    if (node.nodeType !== 1 || SKIP.has(node.tagName) || node.getAttribute('translate') === 'no') return;
    translateAttributes(node);
    // A per-element override (data-i18n-en) wins over the shared dictionary, for tight spots like tabs.
    const own = node.getAttribute('data-i18n-' + lang);
    if (own !== null) { node.textContent = own; return; }
    if (translateBlock(node)) return;
    for (const child of [...node.childNodes]) translateTree(child);
  }

  let observer = null;
  function observe() {
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  function onMutations(records) {
    observer.disconnect();
    for (const record of records) {
      if (record.type === 'childList') {
        if (record.target.nodeType === 1 && translateBlock(record.target)) continue;
        record.addedNodes.forEach(translateTree);
      } else if (record.type === 'characterData') {
        const parent = record.target.parentElement;
        if (!(parent && translateBlock(parent))) translateTextNode(record.target);
      } else if (record.type === 'attributes') translateAttributes(record.target);
    }
    observer.takeRecords();
    observe();
  }

  function setLang(next) {
    if (!LANGS.includes(next) || next === lang) return;
    try { localStorage.setItem(STORAGE_KEY, next); } catch (_) {}
    location.reload();
  }

  window.gmI18n = { get lang() { return lang; }, text, setLang, load, langs: LANGS };

  // Language toggle: any <button data-lang-toggle> offers the other language.
  const toggleStyle = document.createElement('style');
  toggleStyle.textContent = '.lang-toggle{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:8px 10px;border:1px solid var(--line);border-radius:24px;background:transparent;color:var(--muted);font:inherit;font-size:12px;font-weight:650;cursor:pointer;white-space:nowrap}.lang-toggle:hover,.lang-toggle:active{background:var(--soft);color:var(--ink)}';
  document.head.append(toggleStyle);
  function setupToggles() {
    const target = lang === 'en' ? 'ko' : 'en';
    document.querySelectorAll('[data-lang-toggle]').forEach(button => {
      if (button.dataset.ready) return;
      button.dataset.ready = '1';
      button.lang = target;
      button.textContent = target.toUpperCase();
      button.setAttribute('aria-label', target === 'en' ? 'View in English' : '한국어로 보기');
      button.addEventListener('click', () => setLang(target));
    });
  }
  window.addEventListener('DOMContentLoaded', setupToggles, { once: true });

  if (lang === 'ko') return;
  document.documentElement.lang = lang;
  document.documentElement.classList.add('i18n-pending');
  const hide = document.createElement('style');
  hide.textContent = '.i18n-pending body{visibility:hidden}';
  document.head.append(hide);
  const manifest = document.querySelector('link[rel=manifest]');
  if (manifest) manifest.href = './manifest.' + lang + '.webmanifest';

  function start() {
    translateTree(document.documentElement);
    document.documentElement.classList.remove('i18n-pending');
    observer = new MutationObserver(onMutations);
    observe();
  }
  // Translations are defined below this file's runtime (see i18n-en.js); wait for both.
  window.addEventListener('DOMContentLoaded', start, { once: true });
  // Never leave the page hidden if something goes wrong.
  setTimeout(() => document.documentElement.classList.remove('i18n-pending'), 2500);
})();
