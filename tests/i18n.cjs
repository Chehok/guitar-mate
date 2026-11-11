'use strict';
// Language layer: KO default, remembered EN choice, dictionary patterns, and every page wired up.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const read = file => fs.readFileSync(require('path').join(__dirname, '..', file), 'utf8');

function boot(saved) {
  const store = new Map(saved ? [['guitar-mate:lang', saved]] : []);
  const el = () => ({ classList: { add() {}, remove() {} }, append() {}, setAttribute() {}, style: {}, textContent: '' });
  const html = el();
  const context = {
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
    document: { documentElement: html, head: el(), createElement: el, querySelector: () => null, querySelectorAll: () => [] },
    location: { reload() { context.reloaded = true; } },
    addEventListener() {}, setTimeout() {}, MutationObserver: class { observe() {} disconnect() {} takeRecords() {} },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read('i18n.js'), context);
  vm.runInContext(read('i18n-en.js'), context);
  return { i18n: context.gmI18n, store, html, context };
}

{
  const { i18n, html } = boot();
  assert.equal(i18n.lang, 'ko', 'Korean is the default');
  assert.equal(i18n.text('카포 없음'), '카포 없음', 'Korean mode leaves text untouched');
  assert.notEqual(html.lang, 'en');
}
{
  const { i18n, store, context, html } = boot('en');
  assert.equal(i18n.lang, 'en', 'A saved English choice is remembered');
  assert.equal(html.lang, 'en');
  const t = i18n.text;
  assert.equal(t('카포 없음'), 'No capo');
  assert.equal(t('감지 키: G (추정)'), 'Detected key: G (estimated)');
  assert.equal(t('Eb폼 (Capo 4) / G키'), 'Eb shape (Capo 4) / Key G', 'Canvas key stamp');
  assert.equal(t('F키'), 'Key F');
  assert.equal(t('6번 줄 3프렛'), 'String 6, fret 3');
  assert.equal(t('C 운지, 6번 줄부터 뮤트, 3프렛, 2프렛, 0프렛, 1프렛, 0프렛'), 'C shape, from string 6: Muted, fret 3, fret 2, fret 0, fret 1, fret 0', 'Lists are translated item by item');
  assert.equal(t('메이저 · 장3화음 · 베이스 E'), 'Major · major triad · bass E', 'Joined labels are translated piece by piece');
  assert.equal(t('악보 코드 5개 · 전주 1개 · 확인 및 수정'), '5 chords on the sheet · 1 intro · Review and edit');
  assert.equal(t('카포 2 · 원래 키 D 유지 · 코드 모양의 키 C'), 'Capo 2 · original key D kept · chord shapes in C');
  assert.equal(t('G'), 'G', 'Chord names pass through');
  assert.equal(t('알 수 없는 문장'), '알 수 없는 문장', 'Unknown text is left as is rather than mangled');
  i18n.setLang('ko');
  assert.equal(store.get('guitar-mate:lang'), 'ko');
  assert(context.reloaded, 'Switching language reloads the page');
}

// Every page loads the language layer before its content, and the offline cache includes it.
for (const page of ['index.html', 'chord-search.html', 'chord-identifier.html', 'metronome.html', 'score-key-transposer.html', 'guide.html', 'about.html', 'privacy.html']) {
  const html = read(page);
  const at = html.indexOf('src="./i18n.js"');
  assert(at > 0 && at < html.indexOf('</head>') && at < html.indexOf('src="./i18n-en.js"'), page + ' loads i18n.js then i18n-en.js in <head>');
  assert(html.includes('data-lang-toggle') || html.includes('<gm-header'), page + ' offers the language toggle');
}
const sw = read('sw.js');
for (const asset of ['./i18n.js', './i18n-en.js', './manifest.en.webmanifest']) assert(sw.includes(`'${asset}'`), asset + ' is cached for offline use');
const manifest = JSON.parse(read('manifest.en.webmanifest'));
assert.equal(manifest.lang, 'en');
assert.equal(manifest.name, 'Guitar Mate');

console.log('Language layer: KO default, remembered EN, patterns/lists, page wiring and offline cache passed.');
