'use strict';

const practiceMenu = [
  ['tuner', './', '튜닝'],
  ['chords', './chord-search.html', '코드 검색'],
  ['identify', './chord-identifier.html', '코드 판별'],
  ['metronome', './metronome.html', '메트로놈'],
  ['score', './score-key-transposer.html', '악보 키 변환'],
];

class GuitarMateHeader extends HTMLElement {
  connectedCallback() {
    if (this.firstElementChild) return;
    const active = this.getAttribute('active');
    const guide = active === 'metronome' ? './guide.html#example-metronome' : './guide.html';
    const links = practiceMenu.map(([id, href, label]) =>
      `<a id="${id}-tab" href="${href}"${id === active ? ' aria-current="page"' : ''}>${label}</a>`
    ).join('');
    this.innerHTML = `
      <header>
        <div class="site-header-bar">
          <a class="brand" href="./"><img src="./favicon.svg" width="40" height="40" alt=""><span class="brand-name">기타메이트<span class="brand-subtitle">기타 연습 도우미</span></span></a>
          <div class="install-action">
            <a class="guide-launch" href="${guide}">사용 가이드</a>
            <button id="install-button" type="button" hidden>홈 화면에 추가</button>
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
    setupHomeScreenInstall(this.querySelector('#install-button'), this.querySelector('#install-guide'));
  }
}

class GuitarMateFooter extends HTMLElement {
  connectedCallback() {
    if (this.firstElementChild) return;
    this.innerHTML = `<footer>
      한 번 열어 두면, 오프라인에서도 연습을 이어가세요. 소리는 기기의 음량과 무음 설정을 확인해 주세요.<br>
      <a href="./about.html">소개 · 문의</a> · <a href="./privacy.html">개인정보처리방침</a>
    </footer>`;
  }
}

function setupHomeScreenInstall(installButton, installGuide) {
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
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js', {scope: './'}).catch(() => {}));
}
