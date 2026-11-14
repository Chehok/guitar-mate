'use strict';

const practiceMenu = [
  ['tuner', './', '튜닝', 'Tuner'],
  ['chords', './chord-search.html', '코드 검색', 'Chords'],
  ['identify', './chord-identifier.html', '코드 판별', 'Identify'],
  ['metronome', './metronome.html', '메트로놈', 'Metronome'],
  ['score', './score-key-transposer.html', '악보 키 변환', 'Transpose'],
];

class GuitarMateHeader extends HTMLElement {
  connectedCallback() {
    if (this.firstElementChild) return;
    const active = this.getAttribute('active');
    const guide = active === 'metronome' ? './guide.html#example-metronome' : './guide.html';
    const links = practiceMenu.map(([id, href, label, short]) =>
      `<a id="${id}-tab" href="${href}" data-i18n-en="${short}"${id === active ? ' aria-current="page"' : ''}>${label}</a>`
    ).join('');
    this.innerHTML = `
      <header>
        <div class="site-header-bar">
          <a class="brand" href="./"><img src="./favicon.svg" width="40" height="40" alt=""><span class="brand-name">기타메이트<span class="brand-subtitle">기타 연습 도우미</span></span></a>
          <div class="install-action">
            <button class="lang-toggle" type="button" translate="no" data-lang-toggle></button>
            <a class="guide-launch" href="${guide}">가이드</a>
            <button id="install-button" type="button" data-i18n-en="Install" hidden>앱 설치</button>
            <button id="share-button" type="button" hidden>링크 공유</button>
            <span class="badge">오프라인 지원</span>
          </div>
        </div>
        <nav class="mode-tabs" aria-label="연습 모드">${links}</nav>
      </header>
      <dialog id="install-guide" class="install-guide" aria-labelledby="install-guide-title" aria-describedby="install-guide-description">
        <h2 id="install-guide-title">홈 화면에 추가</h2>
        <p id="install-guide-description">Chrome에서 공유 메뉴로 홈 화면에 추가하세요.</p>
        <ol class="install-steps">
          <li><span class="step-no" aria-hidden="true">1</span><div class="step-art" aria-hidden="true"><span class="mock-bar"><span>🔒 기타메이트</span><b>⬆️ 공유</b></span></div><p id="install-step-1">주소창 오른쪽의 공유 아이콘(⬆️)을 누르세요.</p></li>
          <li><span class="step-no" aria-hidden="true">2</span><div class="step-art" aria-hidden="true"><span class="mock-row">➕ 홈 화면에 추가</span></div><p>목록을 아래로 밀어 <strong>홈 화면에 추가</strong>를 고르세요.</p></li>
          <li><span class="step-no" aria-hidden="true">3</span><div class="step-art" aria-hidden="true"><img src="./icons/icon-192.png" width="40" height="40" alt=""><span class="mock-row">기타메이트 · <b>추가</b></span></div><p>이름을 확인하고 <strong>추가</strong>를 누르면 홈 화면에 아이콘이 생겨요 🏠</p></li>
        </ol>
        <p class="install-note">그림은 이해를 돕는 설명용이며 실제 화면과 다를 수 있어요. iOS 16.4 이상이 필요하고, 추가된 아이콘이 앱처럼 열릴지는 iOS 설정에 따라 달라요. 직접 따라 해야 추가됩니다.</p>
        <form method="dialog"><button type="submit" autofocus>닫기</button></form>
      </dialog>`;
    setupHomeScreenInstall(this.querySelector('#install-button'), this.querySelector('#install-guide'), this.querySelector('#share-button'));
  }
}

class GuitarMateFooter extends HTMLElement {
  connectedCallback() {
    if (this.firstElementChild) return;
    this.innerHTML = `<footer>
      한 번 열어 두면 오프라인에서도 연습할 수 있어요. 소리는 기기의 음량과 무음 설정을 확인해 주세요.<br>
      <a href="./about.html">소개 · 문의</a> · <a href="./privacy.html">개인정보처리방침</a>
    </footer>`;
  }
}

function setupHomeScreenInstall(installButton, installGuide, shareButton) {
  const standalone = window.matchMedia('(display-mode: standalone)');
  const userAgent = navigator.userAgent;
  const iosDevice = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1);
  const iosChrome = iosDevice && /CriOS/.test(userAgent);
  const iosSafari = iosDevice && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
  const iosGuide = iosSafari || iosChrome;
  let installPrompt = null;
  let appInstalled = false;
  const isInstalled = () => appInstalled || standalone.matches || navigator.standalone === true;

  function updateInstallButton() {
    installButton.hidden = isInstalled() || (!installPrompt && !iosGuide);
    // In the installed app there's no address bar, so offer a way to pass the link on instead.
    if (shareButton) shareButton.hidden = !isInstalled();
    if (isInstalled() && installGuide.open) installGuide.close();
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    updateInstallButton();
  });
  window.addEventListener('appinstalled', () => {
    appInstalled = true;
    installPrompt = null;
    updateInstallButton();
  });
  standalone.addEventListener('change', updateInstallButton);
  shareButton?.addEventListener('click', async () => {
    const link = location.origin + location.pathname;
    let copied = false;
    try { await navigator.clipboard.writeText(link); copied = true; } catch (_) {
      // Older WebViews: copy through a hidden text field.
      const field = document.createElement('textarea');
      field.value = link; field.setAttribute('readonly', ''); field.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.append(field); field.select();
      try { copied = document.execCommand('copy'); } catch (_) {}
      field.remove();
    }
    shareButton.textContent = copied ? '링크 복사됨' : '복사하지 못했어요';
    clearTimeout(shareButton._reset);
    shareButton._reset = setTimeout(() => { shareButton.textContent = '링크 공유'; }, 2000);
  });
  installButton.addEventListener('click', async () => {
    if (isInstalled()) {
      updateInstallButton();
      return;
    }
    if (installPrompt) {
      const prompt = installPrompt;
      installPrompt = null;
      installButton.hidden = true;
      try {
        await prompt.prompt();
        await prompt.userChoice;
      } catch (_) {
        // The browser can offer a new prompt after dismissal or failure.
      }
    } else if (iosGuide && !installGuide.open) {
      installGuide.showModal();
    }
  });
  if (iosSafari) {
    installGuide.querySelector('#install-guide-description').textContent = 'Safari에서 공유 메뉴로 홈 화면에 추가하세요.';
    installGuide.querySelector('#install-step-1').textContent = '공유 아이콘(⬆️)을 누르세요.';
  }
  installGuide.addEventListener('click', event => {
    if (event.target === installGuide) installGuide.close();
  });
  updateInstallButton();
}

customElements.define('gm-header', GuitarMateHeader);
customElements.define('gm-footer', GuitarMateFooter);

if ('serviceWorker' in navigator && window.isSecureContext) {
  // Installed apps (iOS especially) are often resumed rather than reopened, so they never ask for a new
  // version on their own. Check on load and whenever the app comes back to the screen, and reload into
  // the new version once it takes over, unless the page is busy (e.g. the metronome is playing).
  const sw = navigator.serviceWorker;
  const hadController = Boolean(sw.controller);
  let registration = null, reloadPending = false, lastCheck = 0;
  const busy = () => { try { return Boolean(window.guitarMateBusy && window.guitarMateBusy()); } catch (_) { return false; } };
  const reloadIfIdle = () => { if (reloadPending && !busy()) { reloadPending = false; location.reload(); } };
  const check = () => {
    if (!registration || Date.now() - lastCheck < 30000) return;
    lastCheck = Date.now();
    registration.update().catch(() => {});
  };
  window.addEventListener('load', () => {
    sw.register('./sw.js', {scope: './', updateViaCache: 'none'}).then(reg => { registration = reg; check(); }).catch(() => {});
  });
  sw.addEventListener('controllerchange', () => {
    if (!hadController) return; // first install: the page is already current
    reloadPending = true;
    reloadIfIdle();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { check(); reloadIfIdle(); }
  });
  window.addEventListener('pageshow', event => { if (event.persisted) { check(); reloadIfIdle(); } });
}

// On phones the on-screen keyboard can cover the field being typed in (and its button and hint).
// Once the keyboard is up, scroll so the field's whole form — or the element marked
// data-keyboard-keep — sits just above it.
if (typeof window !== 'undefined' && window.visualViewport && typeof document !== 'undefined') {
  const viewport = window.visualViewport;
  const typing = el => el && el.matches && el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=button]):not([type=submit]),textarea');
  let field = null, timer = 0, spacer = null;
  // A field near the end of the page can't scroll any higher by itself: while the keyboard is up,
  // a spacer as tall as the keyboard goes after the page.
  const space = () => {
    const covered = Math.max(0, Math.round(window.innerHeight - viewport.height));
    if (field && covered > 80) {
      if (!spacer) { spacer = document.createElement('div'); spacer.setAttribute('aria-hidden', 'true'); spacer.className = 'keyboard-space'; }
      spacer.style.height = covered + 'px';
      if (!spacer.isConnected) document.body.appendChild(spacer);
    } else if (spacer && spacer.isConnected) spacer.remove();
  };
  const fit = () => {
    space();
    if (!field || document.activeElement !== field) return;
    const box = (field.closest('[data-keyboard-keep]') || field.closest('form') || field).getBoundingClientRect();
    const top = viewport.offsetTop + 12, bottom = viewport.offsetTop + viewport.height - 12;
    let by = 0;
    if (box.bottom > bottom) by = Math.min(box.bottom - bottom, box.top - top); // keep its top in view too
    else if (box.top < top) by = box.top - top;
    if (Math.abs(by) > 2) window.scrollBy({top: by, behavior: 'smooth'});
  };
  const later = ms => { clearTimeout(timer); timer = setTimeout(fit, ms); };
  document.addEventListener('focusin', event => { if (typing(event.target)) { field = event.target; later(350); } });
  document.addEventListener('focusout', () => { field = null; clearTimeout(timer); later(250); });
  viewport.addEventListener('resize', () => later(field ? 120 : 0));
}
