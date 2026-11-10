'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const script=html.slice(html.indexOf('// Home-screen installation:'),html.indexOf("if('serviceWorker' in navigator"));
assert.match(html,/<button id="install-button"[^>]* hidden>/);
assert.match(html.match(/<header>[\s\S]*?<\/header>/)[0],/id="install-button"/);
assert(!/<footer>[\s\S]*?id="install-button"[\s\S]*?<\/footer>/.test(html));
assert.equal((html.match(/id="install-button"/g)||[]).length,1);
assert.match(html,/<form method="dialog"><button autofocus>닫기<\/button>/);
function setup(userAgent='',installed=false,legacyStandalone=false,maxTouchPoints=0){
  const handlers={},clicks={};
  const button={hidden:true,addEventListener:(name,fn)=>{clicks[name]=fn;}};
  const guide={open:false,showModal(){this.open=true;},close(){this.open=false;},addEventListener:(name,fn)=>{guide['on'+name]=fn;},querySelector:()=>null};
  const media={matches:installed,addEventListener:(name,fn)=>{handlers.media=fn;}};
  vm.runInNewContext(script,{
    $:id=>id==='install-button'?button:guide,
    navigator:{userAgent,standalone:legacyStandalone,maxTouchPoints},
    window:{matchMedia:query=>{assert.equal(query,'(display-mode: standalone)');return media;},
      addEventListener:(name,fn)=>{handlers[name]=fn;}}
  });
  return {button,guide,media,handlers,click:()=>clicks.click(),offer(prompt=async()=>{},userChoice=Promise.resolve({outcome:'accepted'})){
    let prevented=false;
    handlers.beforeinstallprompt({preventDefault(){prevented=true;},prompt,userChoice});
    assert(prevented);
  }};
}
(async()=>{
  for(const ua of ['Desktop Chrome','Android Chrome']){
    const app=setup(ua);assert(app.button.hidden);
    let calls=0,resolveChoice;
    app.offer(async()=>{calls++;},new Promise(resolve=>{resolveChoice=resolve;}));
    assert(!app.button.hidden);
    const clicked=app.click();assert(app.button.hidden);
    await app.click();assert.equal(calls,1,'Prompt must only be used once');
    resolveChoice({outcome:'dismissed'});await clicked;assert(app.button.hidden);
    app.offer();assert(!app.button.hidden);
    app.handlers.appinstalled();assert(app.button.hidden);
    app.offer();assert(app.button.hidden,'Installed app must stay hidden');
  }
  const rejected=setup();rejected.offer(async()=>{throw Error('unavailable');});
  await rejected.click();assert(rejected.button.hidden);
  for(const [ua,touches] of [['iPhone CriOS/130 Mobile Safari',0],['iPad CriOS/130 Mobile Safari',0],['iPhone Version/18 Safari',0],['iPad Safari',0],['iPod Safari',0],['Macintosh Version/18 Safari',5]]){
    const app=setup(ua,false,false,touches);
    assert(!app.button.hidden);await app.click();assert(app.guide.open);
    app.guide.close();assert(!app.guide.open);
    await app.click();app.media.matches=true;app.handlers.media();
    assert(app.button.hidden);assert(!app.guide.open);
    app.media.matches=false;app.handlers.media();assert(!app.button.hidden);
    app.handlers.appinstalled();assert(app.button.hidden);
    assert(setup(ua,false,true,touches).button.hidden);
  }
  for(const browser of ['FxiOS','EdgiOS','OPiOS'])assert(setup(`iPhone ${browser} Safari`).button.hidden);
  assert(setup('Macintosh Safari',false,false,0).button.hidden);
  for(const ua of ['Android Chrome','Desktop Chrome','iPhone Safari']){
    const app=setup(ua,true);app.offer();assert(app.button.hidden);await app.click();assert(!app.guide.open);
  }
  {const app=setup('iPhone CriOS/130');assert(!app.button.hidden);await app.click();assert(app.guide.open);
    app.guide.onclick({target:{}});assert(app.guide.open,'Dialog content clicks keep it open');
    app.guide.onclick({target:app.guide});assert(!app.guide.open,'Backdrop click closes');}
  assert(setup('Android Chrome CriOS-less').button.hidden,'Android without prompt stays hidden');
  assert.match(html,/id="install-step-1"/);assert.match(html,/실제 화면과 다를 수 있어요/);
  console.log('Install prompt, iOS guide, browser exclusions and standalone lifecycle passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
