import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

if (process.env.CHROME_INSTANCE_PATH) {
  test.use({ launchOptions: { executablePath: process.env.CHROME_INSTANCE_PATH, args: ['--no-sandbox'] } });
}
const runtimeBody = await readFile(new URL('./fixtures/landsd-3d-runtime.mock.mjs', import.meta.url), 'utf8');
const fixtureHTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<link rel="stylesheet" href="/landsd-3d-map.css"><link rel="stylesheet" href="/map-fullscreen.css">
<style>
body { margin:0; font-family:system-ui; overflow:auto; } .spacer { height:240px; } .tail { height:1800px; }
.detail-map-panel { transform:translate3d(0,0,0); overflow:hidden; width:360px; max-width:calc(100% - 24px); margin:12px; border-radius:20px; --stop-accent:rgb(213, 40, 65); }
.route-map { position:relative; width:calc(100% - 16px); height:300px; margin:8px; box-sizing:border-box; border:3px solid #768; border-radius:18px; }
.detail-map-panel.open .route-map .original-stop { width:18px; height:18px; background:var(--stop-accent); border:0; border-radius:50%; }
.popup-select { padding:8px; } .mask,.fab { position:fixed; bottom:0; right:0; pointer-events:none; }
.mask { z-index:12000; width:12px; height:12px; } .fab { z-index:15000; width:12px; height:12px; }
</style></head><body class="light"><div class="spacer"></div><button id="outside">Outside</button>
<div id="panel" class="detail-map-panel open"><span id="before">Before</span><div id="map" class="route-map" style="height:300px;max-width:330px!important"></div><span id="after">After</span></div>
<div class="tail"></div><div class="mask"></div><div class="fab"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script src="/landsd-3d-map.js"></script><script src="/map-fullscreen.js"></script>
<script>
window.appEscapes=0; window.appBubbleEscapes=0;
document.addEventListener('keydown', e => { if (e.key==='Escape') appEscapes++; }, true);
document.addEventListener('keydown', e => { if (e.key==='Escape') appBubbleEscapes++; });
window.makeMap=function(id) {
  const map=L.map(id,{zoomControl:true,zoomSnap:0}).setView([22.31234567,114.18234567],14.375);
  map.options.zoomSnap=1;
  const counters={clicked:0,selected:0};
  const marker=L.marker(map.getCenter(),{icon:L.divIcon({className:'original-stop',html:'',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(map);
  marker.on('click',()=>counters.clicked++);
  marker.bindPopup('<button class="popup-select">用呢個站</button>',{autoPan:false});
  marker.on('popupopen',e=>{
    const button=e.popup.getElement().querySelector('.popup-select');
    window.originalPopupButton=button;
    button.addEventListener('click',()=>counters.selected++);
  });
  const threeD=BusPulse3DMap.install(map);
  const controller=BusPulseMapFullscreen.install(map);
  const invalidations=[];
  const invalidate=map.invalidateSize;
  map.invalidateSize=function(options){invalidations.push(options);return invalidate.call(this,options);};
  return {map,marker,counters,threeD,controller,invalidations};
};
window.fixture=makeMap('map');
window.originalContainer=fixture.map.getContainer();
window.originalStyle=originalContainer.getAttribute('style');
window.originalParent=originalContainer.parentNode;
window.originalNext=originalContainer.nextSibling;
window.originalBodyStyle=document.body.getAttribute('style');
window.originalRootStyle=document.documentElement.getAttribute('style');
window.makeSecond=function(){
  const panel=document.createElement('div');panel.className='detail-map-panel open';panel.id='panel2';
  const map=document.createElement('div');map.id='map2';map.className='route-map';panel.appendChild(map);document.body.appendChild(panel);
  window.fixture2=makeMap('map2');return fixture2;
};
</script></body></html>`;

async function open(page) {
  const requests = [];
  await page.route('**/tests/map-fullscreen-fixture.html', route => route.fulfill({ contentType:'text/html', body:fixtureHTML }));
  await page.route('**/landsd-3d-runtime.js', route => {
    requests.push(route.request().url());
    return route.fulfill({ contentType:'text/javascript', body:runtimeBody });
  });
  page.on('request', request => {
    if (/\/vendor\/cesium\/.+Cesium\.js/.test(request.url())) requests.push(request.url());
  });
  await page.goto('/tests/map-fullscreen-fixture.html');
  await page.waitForFunction(() => !!window.fixture);
  return requests;
}
const toggle = (page, id='map') => page.locator(`#${id} .buspulse-map-fullscreen-toggle`);
const view = page => page.evaluate(() => ({ lat:fixture.map.getCenter().lat, lng:fixture.map.getCenter().lng, zoom:fixture.map.getZoom() }));
async function expectView(page, expected) {
  await expect.poll(() => view(page)).toEqual({ lat:expect.closeTo(expected.lat,8), lng:expect.closeTo(expected.lng,8), zoom:expect.closeTo(expected.zoom,8) });
}
async function expectViewport(page, id='map') {
  const size = page.viewportSize();
  await expect.poll(() => page.locator(`#${id}`).evaluate(node => {
    const rect=node.getBoundingClientRect(); return { x:rect.x,y:rect.y,width:rect.width,height:rect.height };
  })).toEqual({x:0,y:0,width:size.width,height:size.height});
  await expect(page.locator(`#${id}`)).toHaveCSS('position','fixed');
  await expect(page.locator(`#${id}`)).toHaveCSS('z-index','20000');
  expect(await page.evaluate(id => {
    const node=document.getElementById(id);
    return node.contains(document.elementFromPoint(innerWidth-3,innerHeight-3));
  },id)).toBe(true);
}
async function expectClean(page) {
  await expect(page.locator('.buspulse-map-fullscreen-placeholder')).toHaveCount(0);
  await expect(page.locator('.buspulse-map-fullscreen-context')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveClass(/buspulse-map-fullscreen-active/);
  await expect(page.locator('.buspulse-map-fullscreen')).toHaveCount(0);
}

 test('independent accessible square four-corner control; default 2D loads no SDK; install is idempotent', async ({page}) => {
  const requests=await open(page);
  expect(requests).toEqual([]);
  await expect(page.locator('.buspulse-3d-overlay')).toHaveCount(0);
  await expect(toggle(page)).toHaveAttribute('aria-label','全畫面地圖');
  await expect(toggle(page)).toHaveAttribute('title','全畫面地圖');
  await expect(toggle(page)).toHaveAttribute('aria-pressed','false');
  await expect(toggle(page).locator('svg')).toHaveAttribute('aria-hidden','true');
  expect(await toggle(page).locator('path').getAttribute('d')).toMatch(/M9 3H3v6M15 3h6v6M21 15v6h-6M3 15v6h6/);
  expect(await toggle(page).evaluate(node => node.offsetWidth===node.offsetHeight)).toBe(true);
  await expect(toggle(page)).toHaveCSS('background-color','rgb(255, 255, 255)');
  expect(await page.evaluate(() => BusPulseMapFullscreen.install(fixture.map)===fixture.controller)).toBe(true);
  await expect(page.locator('#map .leaflet-top.leaflet-left > .buspulse-map-fullscreen-control')).toHaveCount(1);
  expect(await page.evaluate(() => fixture.controller.control!==fixture.threeD.control)).toBe(true);
  await page.evaluate(()=>document.body.classList.remove('light'));
  await expect(toggle(page)).toHaveCSS('color','rgb(255, 255, 255)');
  await expect(toggle(page)).toHaveCSS('background-color','rgb(24, 53, 44)');
  expect(await toggle(page).evaluate(node=>getComputedStyle(node).textShadow)).not.toBe('none');
  expect(requests).toEqual([]);
});

for (const dimensions of [{width:390,height:844},{width:1000,height:780}]) {
  test(`same map fills ${dimensions.width}x${dimensions.height}, preserves scoped markers, insertion, dimensions and fractional view over repeated cycles`, async ({page}) => {
    await page.setViewportSize(dimensions);
    const requests=await open(page);
    const initial=await page.locator('#map').boundingBox();
    const initialView=await view(page);
    const marker=page.locator('#map .leaflet-marker-pane .original-stop');
    await expect(marker).toHaveCSS('background-color','rgb(213, 40, 65)');
    for(let cycle=0;cycle<3;cycle++) {
      await toggle(page).click();
      await expectViewport(page);
      await expectView(page,initialView);
      await expect(toggle(page)).toHaveAttribute('aria-label','退出全畫面地圖');
      await expect(toggle(page)).toHaveAttribute('title','退出全畫面地圖');
      await expect(toggle(page)).toHaveAttribute('aria-pressed','true');
      await expect(marker).toHaveCSS('background-color','rgb(213, 40, 65)');
      expect(await page.evaluate(()=>fixture.map.getContainer()===originalContainer)).toBe(true);
      expect(await page.evaluate(()=>Array.from(document.querySelectorAll('.buspulse-map-fullscreen-context')).every(node=>!node.id&&getComputedStyle(node).display==='contents'&&getComputedStyle(node).transform==='none'))).toBe(true);
      await expect(page.locator('#panel')).toHaveCount(1);
      await expect(page.locator('.buspulse-map-fullscreen-placeholder')).toHaveCount(1);
      await toggle(page).click();
      await expectClean(page);
      await expectView(page,initialView);
      expect(await page.evaluate(()=>originalContainer.parentNode===originalParent&&originalContainer.nextSibling===originalNext&&originalContainer.getAttribute('style')===originalStyle)).toBe(true);
      const after=await page.locator('#map').boundingBox();
      expect(after.width).toBe(initial.width);expect(after.height).toBe(initial.height);
      await expect(toggle(page)).toBeFocused();
    }
    expect(requests).toEqual([]);
    expect(await page.evaluate(()=>fixture.invalidations.some(options=>options?.pan===false&&options?.animate===false))).toBe(true);
  });
}

test('Escape is captured before application detail/popup handlers, and only fullscreen exits', async ({page}) => {
  await open(page);
  await page.locator('#map .original-stop').click();
  await expect(page.locator('#map .popup-select')).toBeVisible();
  await toggle(page).click();
  await page.keyboard.press('Escape');
  await expectClean(page);
  expect(await page.evaluate(()=>[appEscapes,appBubbleEscapes])).toEqual([0,0]);
  await expect(page.locator('#map .popup-select')).toBeVisible();
  await expect(toggle(page)).toBeFocused();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(()=>[appEscapes,appBubbleEscapes])).toEqual([1,1]);
});

test('original marker and original popup callback still work before, during and after fullscreen', async ({page}) => {
  await open(page);
  for(const fullscreen of [false,true,false]) {
    if(fullscreen!==await page.evaluate(()=>fixture.controller.isFullscreen)) await toggle(page).click();
    await page.locator('#map .leaflet-marker-pane .original-stop').click();
    const button=page.locator('#map .leaflet-popup-pane .popup-select');
    await expect(button).toBeVisible();
    expect(await button.evaluate(node=>node===originalPopupButton)).toBe(true);
    await button.click();
    await page.evaluate(()=>fixture.map.closePopup());
  }
  expect(await page.evaluate(()=>fixture.counters)).toEqual({clicked:3,selected:3});
  expect(await page.evaluate(()=>fixture.map.hasLayer(fixture.marker))).toBe(true);
});

test('window and visual viewport resizing preserve the current view, with page styles and scroll restored', async ({page}) => {
  await open(page);
  await page.evaluate(()=>{
    document.body.style.position='relative';document.body.style.overflow='auto';document.body.style.width='96%';
    document.documentElement.style.overflow='auto';document.documentElement.style.scrollBehavior='smooth';
    window.savedBody=document.body.style.cssText;window.savedRoot=document.documentElement.style.cssText;
    window.scrollTo({top:480,behavior:'instant'});window.savedScroll=scrollY;
  });
  const savedScroll=await page.evaluate(()=>savedScroll);
  const initialView=await view(page);
  await page.evaluate(()=>fixture.controller.enter());
  await expectViewport(page);
  await expect(page.locator('body')).toHaveCSS('position','fixed');
  for(const dimensions of [{width:1000,height:780},{width:390,height:844}]) {
    await page.setViewportSize(dimensions);
    await expectViewport(page);
    await expectView(page,initialView);
    await page.evaluate(()=>window.visualViewport?.dispatchEvent(new Event('resize')));
    await expectView(page,initialView);
  }
  await page.evaluate(()=>fixture.controller.exit());
  await expectClean(page);
  await expectView(page,initialView);
  expect(await page.evaluate(()=>({body:document.body.style.cssText===savedBody,root:document.documentElement.style.cssText===savedRoot,y:scrollY}))).toEqual({body:true,root:true,y:savedScroll});
});

test('fullscreen control persists in both modes and the 3D container resize observer follows it', async ({page}) => {
  const requests=await open(page);
  await toggle(page).click();
  await page.locator('#map .buspulse-3d-toggle').click();
  await expect.poll(()=>page.evaluate(()=>BusPulse3DMap.getState(fixture.map).phase)).toBe('ready');
  await expectViewport(page);
  await expect(toggle(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-pressed','true');
  expect(requests).toHaveLength(1);
  await page.setViewportSize({width:1000,height:780});
  await expectViewport(page);
  await expect.poll(()=>page.evaluate(()=>__sceneMock.viewers[0].canvas.clientWidth)).toBe(1000);
  await page.locator('#map .buspulse-3d-toggle').click();
  await expect(page.locator('.buspulse-3d-overlay')).toHaveCount(0);
  await expect(toggle(page)).toHaveAttribute('aria-pressed','true');
  await expectViewport(page);
  await toggle(page).click();
  await expectClean(page);
  await page.locator('#map .buspulse-3d-toggle').click();
  await expect.poll(()=>page.evaluate(()=>BusPulse3DMap.getState(fixture.map).phase)).toBe('ready');
  await toggle(page).click();
  await expectViewport(page);
  await expect(toggle(page)).toBeVisible();
  await page.evaluate(()=>fixture.controller.exit());
  await expectClean(page);
  await expect(page.locator('#map .buspulse-3d-overlay')).toBeVisible();
});

test('only one fullscreen map: entering another exits the first, and explicit exit supports panel suspend', async ({page}) => {
  await open(page);
  const initialView=await view(page);
  await toggle(page).click();
  await page.evaluate(()=>{makeSecond();fixture2.controller.enter();});
  await expectViewport(page,'map2');
  await expect(toggle(page)).toHaveAttribute('aria-pressed','false');
  expect(await page.evaluate(()=>fixture.controller.isFullscreen)).toBe(false);
  expect(await page.evaluate(()=>originalContainer.parentNode===originalParent)).toBe(true);
  await expectView(page,initialView);
  await expect(page.locator('.buspulse-map-fullscreen-placeholder')).toHaveCount(1);
  await page.evaluate(()=>fixture2.controller.exit());
  await expectClean(page);
  await page.evaluate(()=>fixture.controller.enter());
  await page.evaluate(()=>fixture.controller.exit()); // Parent calls this on suspend, before hiding the panel.
  await expectClean(page);
  expect(await page.evaluate(()=>fixture.controller.disposed)).toBe(false);
  await toggle(page).click();
  await expectViewport(page);
});

for(const removal of ['dispose','unload','unregister','panel','placeholder','container']) {
  test(`${removal} cleans fullscreen without leaked placeholders, wrappers or body flags`, async ({page}) => {
    await open(page);
    await toggle(page).click();
    await page.evaluate(removal=>{
      if(removal==='dispose') fixture.controller.dispose();
      if(removal==='unload') fixture.map.remove();
      if(removal==='unregister') fixture.map.removeControl(fixture.controller.control);
      if(removal==='panel') document.getElementById('panel').remove();
      if(removal==='placeholder') document.querySelector('.buspulse-map-fullscreen-placeholder').remove();
      if(removal==='container') originalContainer.remove();
    },removal);
    await expectClean(page);
    await expect.poll(()=>page.evaluate(()=>fixture.controller.disposed)).toBe(true);
    expect(await page.evaluate(()=>fixture.controller.isFullscreen)).toBe(false);
    await expect(page.locator('.buspulse-map-fullscreen-toggle')).toHaveCount(0);
    if(['panel','placeholder','container'].includes(removal)) {
      await expect(page.locator('#map')).toHaveCount(0);
      expect(await page.evaluate(()=>originalContainer.isConnected)).toBe(false);
      if(removal==='panel') await expect(page.locator('#panel')).toHaveCount(0);
    } else {
      expect(await page.evaluate(()=>originalContainer.parentNode===originalParent&&originalContainer.getAttribute('style')===originalStyle)).toBe(true);
    }
    expect(await page.evaluate(()=>document.body.style.position)).toBe('');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(()=>appEscapes)).toBe(1);
    await page.evaluate(()=>fixture.controller.dispose());
    await expectClean(page);
  });
}

test('an explicitly disposed live map can be installed again without duplicated controls', async ({page}) => {
  await open(page);
  await page.evaluate(()=>{fixture.controller.dispose();fixture.controller=BusPulseMapFullscreen.install(fixture.map);});
  await expect(toggle(page)).toHaveCount(1);
  await toggle(page).click();
  await expectViewport(page);
  await toggle(page).click();
  await expectClean(page);
});
