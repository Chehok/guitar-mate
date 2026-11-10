'use strict';

const guideLink = document.querySelector('.guide-launch');
const usageDialog = document.createElement('dialog');
usageDialog.className = 'usage-dialog';
usageDialog.setAttribute('aria-labelledby', 'usage-dialog-title');
usageDialog.innerHTML = `
  <div class="usage-dialog-bar">
    <h2 id="usage-dialog-title">사용 가이드</h2>
    <form method="dialog"><button type="submit" autofocus>닫기</button></form>
  </div>
  <iframe title="기타메이트 사용 예시"></iframe>
`;

if (guideLink && typeof usageDialog.showModal === 'function') {
  const frame = usageDialog.querySelector('iframe');
  guideLink.setAttribute('aria-haspopup', 'dialog');
  document.body.append(usageDialog);
  guideLink.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (!frame.hasAttribute('src')) frame.src = guideLink.href;
    usageDialog.showModal();
  });
  usageDialog.addEventListener('close', () => guideLink.focus());
  window.addEventListener('message', event => {
    if (event.source === frame.contentWindow && event.data === 'guitar-mate:close-guide' && usageDialog.open) {
      usageDialog.close();
    }
  });
}
