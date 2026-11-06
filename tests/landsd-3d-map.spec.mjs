import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// The actual Leaflet 1.9.4 build is used. Only Cesium/runtime is stubbed: these
// tests validate the bridge, not LandsD textured model correctness (checked live
// separately by the integration suite).
if (process.env.CHROME_INSTANCE_PATH) {
  test.use({ launchOptions: { executablePath: process.env.CHROME_INSTANCE_PATH, args: ['--no-sandbox'] } });
}
const runtimeBody = await readFile(new URL('./fixtures/landsd-3d-runtime.mock.mjs', import.meta.url), 'utf8');
const fixtureHTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<link rel="stylesheet" href="/landsd-3d-map.css">
<style>body{margin:0;font-family:system-ui}.map{width:360px;height:300px;position:relative;margin:12px}
.image-stop-marker-wrap{background:none;border:0}.image-stop-marker{display:block;width:18px;height:18px;background:#e52635;border-radius:50%}.image-stop-marker.selected{background:#07583d}
.eta-bus{background:#07583d;color:white;width:30px;height:20px}.popup-select{padding:8px}</style>
</head><body><button id="outside">Unchanged outside control</button><div id="map" class="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script src="/landsd-3d-map.js"></script>
<script>
window.makeMap = function(id, mapOptions = {}) {
  const map = L.map(id, { zoomControl: true, attributionControl: true, zoomSnap: 0, ...mapOptions }).setView([22.3, 114.17], 14.375);
  map.options.zoomSnap = 1;
  const counters = { suspended:0, resumed:0, clicked:0, selected:0, popupClosed:0, busClicked:0 };
  const icon = selected => L.divIcon({className:'image-stop-marker-wrap', html:'<span class="image-stop-marker'+(selected?' selected':'')+'"></span>',iconSize:[18,18],iconAnchor:[9,9],popupAnchor:[0,-9]});
  const marker = L.marker([22.3,114.17], {icon:icon(false),title:'Original stop'}).addTo(map);
  marker.on('click', e => { counters.clicked++; window.lastClick=e; marker.setIcon(icon(true)); });
  marker.bindPopup('<b>第 1 站</b><br><button class="popup-select" data-stop-id="stop-1">用呢個站</button>');
  marker.on('popupopen', e => {
    const button = e.popup.getElement().querySelector('.popup-select');
    window.originalPopupButton = button;
    button.addEventListener('click', () => counters.selected++);
  });
  map.on('popupclose', () => counters.popupClosed++);
  const bus = L.marker([22.3001,114.1702], { interactive:false, keyboard:false, icon:L.divIcon({className:'eta-bus',html:'<span>307</span>',iconSize:[30,20],iconAnchor:[15,10]}) }).addTo(map);
  bus.on('click', () => counters.busClicked++);
  const gps = L.circleMarker([22.3002,114.1701], { radius:7,color:'#fff',weight:3,fillColor:'#36e0a0',fillOpacity:0.95 }).addTo(map);
  const route = L.polyline([[[22.3,114.17],[22.301,114.171]],[[22.301,114.171],[22.302,114.172]]],{color:'#e52635',weight:3,opacity:0.98}).addTo(map);
  const controller = BusPulse3DMap.install(map, {suspendBasemap:()=>{counters.suspended++},resumeBasemap:()=>{counters.resumed++}});
  return {map,marker,bus,gps,route,counters,controller};
};
window.fixture = makeMap('map');
window.outsideClicks=0; document.querySelector('#outside').onclick=()=>outsideClicks++;
</script></body></html>`;

async function open(page, scenario = '') {
  const runtimeRequests = [];
  await page.addInitScript(value => { window.__mockScenario = value; }, scenario);
  await page.route('**/tests/landsd-3d-fixture.html', route => route.fulfill({ contentType: 'text/html', body: fixtureHTML }));
  await page.route('**/landsd-3d-runtime.js', route => {
    runtimeRequests.push(route.request().url());
    return route.fulfill({ contentType: 'text/javascript', body: runtimeBody });
  });
  await page.goto('/tests/landsd-3d-fixture.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.fixture);
  return runtimeRequests;
}
async function enable(page, id = 'map') {
  await page.locator(`#${id} .buspulse-3d-toggle`).click();
  await expect.poll(() => page.evaluate(id => {
    const map = id === 'map' ? fixture.map : fixture2.map;
    return BusPulse3DMap.getState(map).phase;
  }, id)).toBe('ready');
  await expect(page.locator(`#${id} .buspulse-3d-overlay`)).toBeVisible();
}
const projected = (page, name) => page.evaluate(name => String(L.stamp(fixture[name])), name)
  .then(id => page.locator(`#map .buspulse-3d-marker[data-leaflet-id="${id}"]`));

test('defaults to the same 2D map without any runtime/SDK load; stable installation and outside controls', async ({ page }) => {
  const requests = await open(page);
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => typeof window.__sceneMock)).toBe('undefined');
  await expect(page.locator('#map .buspulse-3d-toggle')).toHaveText('3D');
  await expect(page.locator('#map .buspulse-3d-overlay')).toHaveCount(0);
  await expect(page.locator('#map .leaflet-map-pane')).toHaveCSS('visibility', 'visible');
  await expect(page.locator('#map .leaflet-marker-pane .image-stop-marker')).toBeVisible();
  expect(await page.evaluate(() => BusPulse3DMap.install(fixture.map) === fixture.controller)).toBe(true);
  expect(await page.evaluate(() => fixture.counters)).toMatchObject({ suspended: 0, resumed: 0 });
  await page.locator('#outside').click();
  expect(await page.evaluate(() => outsideClicks)).toBe(1);
});

test('mirrors live original markers, GPS and nested route strokes, without changing layers or callbacks', async ({ page }) => {
  const requests = await open(page);
  await enable(page);
  expect(requests).toHaveLength(1);
  await expect(page.locator('#map .leaflet-map-pane')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('#map .leaflet-control-zoom')).toBeHidden();
  await expect(page.locator('#map .buspulse-3d-zoom')).toBeVisible();
  expect(await page.evaluate(() => [fixture.marker,fixture.bus,fixture.gps,fixture.route].every(layer => fixture.map.hasLayer(layer)))).toBe(true);
  const stop = await projected(page, 'marker');
  await expect(stop.locator('.image-stop-marker-wrap .image-stop-marker')).toBeVisible();
  await expect(stop).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 171, 141)');
  const gps = await projected(page, 'gps');
  await expect(gps.locator('circle')).toHaveAttribute('fill', '#36e0a0');
  await expect(gps.locator('circle')).toHaveAttribute('fill-opacity', '0.95');
  expect(await page.evaluate(() => __sceneMock.viewers[0].entities.values.map(e => ({ count:e.polyline.positions.length, ...e.polyline.material, width:e.polyline.width, clamp:e.polyline.clampToGround })))).toEqual([
    { count:2, color:'#e52635', alpha:0.98, width:3, clamp:true },
    { count:2, color:'#e52635', alpha:0.98, width:3, clamp:true }
  ]);
  const options = await page.evaluate(() => {
    const options = __sceneMock.viewers[0].options;
    return { baseLayer:options.baseLayer,requestRenderMode:options.requestRenderMode,maximum:options.maximumRenderTimeChange===Infinity,shouldAnimate:options.shouldAnimate,animation:options.animation,timeline:options.timeline };
  });
  expect(options).toEqual({ baseLayer:false,requestRenderMode:true,maximum:true,shouldAnimate:false,animation:false,timeline:false });
  await page.evaluate(() => {
    fixture.bus.setLatLng([22.3003,114.1703]);
    fixture.bus.setIcon(L.divIcon({className:'eta-bus updated',html:'<span>88X</span>',iconSize:[42,24],iconAnchor:[21,12]}));
    fixture.gps.setLatLng([22.3004,114.1704]).setStyle({fillColor:'#ff625c'});
    fixture.route.setLatLngs([[[22.3,114.17],[22.304,114.174]],[[22.304,114.174],[22.305,114.175]]]).setStyle({color:'#07583d',weight:5,opacity:0.7});
  });
  const bus = await projected(page, 'bus');
  await expect(bus.locator('.eta-bus.updated')).toHaveText('88X');
  await expect(bus.locator('.eta-bus.updated')).toHaveCSS('width', '42px');
  await expect(bus).toHaveAttribute('data-lat', '22.3003');
  await expect(bus).toHaveCSS('pointer-events', 'none');
  await bus.evaluate(node => node.dispatchEvent(new MouseEvent('click', { bubbles:true })));
  expect(await page.evaluate(() => fixture.counters.busClicked)).toBe(0);
  await expect(gps).toHaveAttribute('data-lat', '22.3004');
  await expect(gps.locator('circle')).toHaveAttribute('fill', '#ff625c');
  await expect.poll(() => page.evaluate(() => __sceneMock.viewers[0].entities.values[0].polyline.material)).toEqual({color:'#07583d',alpha:0.7});
  await stop.click();
  expect(await page.evaluate(() => ({count:fixture.counters.clicked,lat:lastClick.latlng.lat,original:lastClick.originalEvent instanceof MouseEvent}))).toEqual({count:1,lat:22.3,original:true});
  await expect(stop.locator('.image-stop-marker.selected')).toBeVisible();
  await page.evaluate(() => {
    window.addedMarker=L.marker([22.3,114.17],{icon:L.divIcon({html:'new',iconSize:[20,20]})}).addTo(fixture.map);
    fixture.map.removeLayer(fixture.gps);
    fixture.map.removeLayer(fixture.route);
  });
  await expect(gps).toHaveCount(0);
  expect(await page.evaluate(() => __sceneMock.viewers[0].entities.values.length)).toBe(0);
  await expect(page.locator('#map .buspulse-3d-marker')).toHaveCount(3);
  await page.evaluate(() => addedMarker.remove());
  await expect(page.locator('#map .buspulse-3d-marker')).toHaveCount(2);
});

test('uses the latest original Leaflet image icon, class, size and anchor', async ({ page }) => {
  await open(page);
  await enable(page);
  await page.evaluate(() => {
    const image = color => 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="28"><rect width="20" height="28" fill="'+color+'"/></svg>');
    window.imageURL = image('red');
    window.imageMarker = L.marker([22.3,114.17], {icon:L.icon({iconUrl:imageURL,className:'original-image',iconSize:[20,28],iconAnchor:[10,28]})}).addTo(fixture.map);
    window.changedImageURL = image('green');
  });
  const image = page.locator('#map .buspulse-3d-marker .original-image');
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', await page.evaluate(() => imageURL));
  await expect(image).toHaveCSS('width', '20px');
  await expect(image.locator('..')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 170, 122)');
  await page.evaluate(() => imageMarker.setIcon(L.icon({iconUrl:changedImageURL,className:'original-image selected-image',iconSize:[26,32],iconAnchor:[13,32]})));
  await expect(image).toHaveClass(/selected-image/);
  await expect(image).toHaveAttribute('src', await page.evaluate(() => changedImageURL));
  await expect(image).toHaveCSS('height', '32px');
  await expect(image.locator('..')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 167, 118)');
});

test('moves the original popup AFTER popupopen handlers and retains selection and original close listeners', async ({ page }) => {
  await open(page);
  await enable(page);
  await (await projected(page, 'marker')).click();
  const button = page.locator('#map .buspulse-3d-popup .popup-select');
  await expect(button).toBeVisible();
  expect(await button.evaluate(node => node === window.originalPopupButton)).toBe(true);
  expect(await button.evaluate(node => fixture.marker.getPopup().getElement().contains(node))).toBe(true);
  await button.click();
  expect(await page.evaluate(() => fixture.counters.selected)).toBe(1);
  await page.locator('#map .buspulse-3d-popup .leaflet-popup-close-button').click();
  await expect(page.locator('#map .buspulse-3d-popup')).toHaveCount(0);
  expect(await page.evaluate(() => fixture.counters.popupClosed)).toBe(1);
  await (await projected(page, 'marker')).click();
  await expect(button).toBeVisible();
  await page.locator('#map .buspulse-3d-toggle').click();
  await expect(page.locator('#map .buspulse-3d-overlay')).toHaveCount(0);
  const restored = page.locator('#map .leaflet-popup-pane .popup-select');
  await expect(restored).toBeVisible();
  expect(await restored.evaluate(node => node === window.originalPopupButton)).toBe(true);
  await restored.click();
  expect(await page.evaluate(() => fixture.counters.selected)).toBe(2);
  await page.locator('#map .leaflet-popup-close-button').click();
  expect(await page.evaluate(() => fixture.counters.popupClosed)).toBe(2);
});

test('forwards blank canvas clicks to Leaflet popup rules and destroys the Cesium click handler on stop', async ({ page }) => {
  await open(page);
  await enable(page);
  await page.evaluate(() => {
    fixture.map.on('preclick', event => { window.lastPreclick = event; });
    fixture.map.on('click', event => { window.lastMapClick = event; });
  });
  const clickCanvas = () => page.evaluate(() => __sceneMock.handlers.at(-1).trigger('LEFT_CLICK', {
    position: new Cesium.Cartesian2(15, 20)
  }));

  await (await projected(page, 'marker')).click();
  await expect(page.locator('#map .buspulse-3d-popup .popup-select')).toBeVisible();
  await clickCanvas();
  await expect(page.locator('#map .buspulse-3d-popup')).toHaveCount(0);
  expect(await page.evaluate(() => ({
    closed:fixture.counters.popupClosed,
    preclick:[lastPreclick.latlng.lat,lastPreclick.latlng.lng],
    click:[lastMapClick.latlng.lat,lastMapClick.latlng.lng],
    original:lastMapClick.originalEvent.position.x
  }))).toEqual({closed:1,preclick:[22.3,114.17],click:[22.3,114.17],original:15});

  await page.evaluate(() => { fixture.marker.getPopup().options.closeOnClick = false; });
  await (await projected(page, 'marker')).click();
  await expect(page.locator('#map .buspulse-3d-popup .popup-select')).toBeVisible();
  await clickCanvas();
  await expect(page.locator('#map .buspulse-3d-popup .popup-select')).toBeVisible();
  expect(await page.evaluate(() => fixture.counters.popupClosed)).toBe(1);

  await page.locator('#map .buspulse-3d-toggle').click();
  expect(await page.evaluate(() => ({destroyed:__sceneMock.handlers[0].destroyed,count:__sceneMock.destroyedHandlers})))
    .toEqual({destroyed:true,count:1});

  await page.evaluate(() => {
    const element = document.createElement('div');
    element.id = 'map2';
    element.className = 'map';
    document.body.appendChild(element);
    window.fixture2 = makeMap('map2', { closePopupOnClick:false });
  });
  await enable(page, 'map2');
  const markerId = await page.evaluate(() => String(L.stamp(fixture2.marker)));
  await page.locator(`#map2 .buspulse-3d-marker[data-leaflet-id="${markerId}"]`).click();
  await expect(page.locator('#map2 .buspulse-3d-popup .popup-select')).toBeVisible();
  await clickCanvas();
  await expect(page.locator('#map2 .buspulse-3d-popup .popup-select')).toBeVisible();
  expect(await page.evaluate(() => fixture2.counters.popupClosed)).toBe(0);
  await page.locator('#map2 .buspulse-3d-toggle').click();
  expect(await page.evaluate(() => __sceneMock.destroyedHandlers)).toBe(2);
});

test('keeps fractional centre/zoom roundtrip and lets original GPS/setView/fitBounds drive the camera', async ({ page }) => {
  await open(page);
  await enable(page);
  expect(await page.evaluate(() => fixture.map.getZoom())).toBeCloseTo(14.375, 6);
  await page.evaluate(() => fixture.map.setView([22.3123,114.1824],17,{animate:false}));
  await expect.poll(() => page.evaluate(() => __sceneMock.viewers[0].camera.centre)).toMatchObject({lat:expect.closeTo(22.3123,6),lng:expect.closeTo(114.1824,6)});
  await page.evaluate(() => fixture.map.fitBounds([[22.31,114.18],[22.32,114.19]],{animate:false,maxZoom:15}));
  expect(await page.evaluate(() => {
    const centre=fixture.map.getCenter(), camera=__sceneMock.viewers[0].camera.centre;
    return Math.abs(centre.lat-camera.lat)<1e-7 && Math.abs(centre.lng-camera.lng)<1e-7;
  })).toBe(true);
  await page.evaluate(() => {
    const viewer=__sceneMock.viewers[0];
    const lat=22.321234,lng=114.191234,zoom=14.625;
    const range=2*Math.PI*6378137*Math.cos(lat*Math.PI/180)/(256*2**zoom)*viewer.canvas.clientHeight/(2*Math.tan(viewer.camera.frustum.fovy/2));
    viewer.camera.setView({destination:Cesium.Cartesian3.fromDegrees(lng,lat,range),orientation:{heading:0,pitch:-Math.PI/2,roll:0}});
    viewer.camera.moveEnd.raiseEvent();
  });
  await expect.poll(() => page.evaluate(() => fixture.map.getZoom())).toBeCloseTo(14.625, 6);
  await page.locator('#map .buspulse-3d-toggle').click();
  const view=await page.evaluate(() => ({lat:fixture.map.getCenter().lat,lng:fixture.map.getCenter().lng,zoom:fixture.map.getZoom(),snap:fixture.map.options.zoomSnap,dragging:fixture.map.dragging.enabled(),pickCalls:__sceneMock.pickEllipsoidCalls}));
  expect(view.lat).toBeCloseTo(22.321234, 6);
  expect(view.lng).toBeCloseTo(114.191234, 6);
  expect(view.zoom).toBeCloseTo(14.625, 6);
  expect(view.snap).toBe(1);
  expect(view.dragging).toBe(true);
  expect(view.pickCalls).toBeGreaterThan(0);
});

test('suspend never resumes a hidden basemap; single viewer, unload and disconnected DOM release resources', async ({ page }) => {
  await open(page);
  await enable(page);
  await page.evaluate(() => BusPulse3DMap.suspend(fixture.map));
  await expect(page.locator('#map .buspulse-3d-toggle')).toHaveText('3D');
  expect(await page.evaluate(() => ({...fixture.counters,destroyed:__sceneMock.destroyed,disposedScenes:__sceneMock.disposedScenes}))).toMatchObject({suspended:1,resumed:0,destroyed:1,disposedScenes:1});
  await enable(page);
  await page.evaluate(() => {
    const el=document.createElement('div'); el.id='map2'; el.className='map'; document.body.appendChild(el);
    window.fixture2=makeMap('map2');
  });
  await enable(page,'map2');
  await expect(page.locator('#map .buspulse-3d-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => __sceneMock.viewers.filter(viewer=>!viewer.destroyed).length)).toBe(1);
  expect(await page.evaluate(() => fixture.counters.resumed)).toBe(1);
  await page.evaluate(() => fixture2.map.remove());
  expect(await page.evaluate(() => ({disposed:BusPulse3DMap.getState(fixture2.map).disposed,records:BusPulse3DMap.getState(fixture2.map).records.size,resumed:fixture2.counters.resumed,live:__sceneMock.viewers.filter(v=>!v.destroyed).length}))).toEqual({disposed:true,records:0,resumed:0,live:0});
  await enable(page);
  await page.evaluate(() => fixture.map.getContainer().remove());
  await expect.poll(() => page.evaluate(() => BusPulse3DMap.getState(fixture.map).disposed)).toBe(true);
  expect(await page.evaluate(() => ({live:__sceneMock.viewers.filter(v=>!v.destroyed).length,resumed:fixture.counters.resumed,observer:BusPulse3DMap.getState(fixture.map).observer}))).toEqual({live:0,resumed:1,observer:null});
});

test('cancels SDK startup and delayed scene attachment without resurrecting a closed viewer', async ({ page }) => {
  await open(page,'slow-sdk');
  await page.locator('#map .buspulse-3d-toggle').click();
  await expect.poll(() => page.evaluate(() => window.__sceneMock?.sdkLoads)).toBe(1);
  await page.locator('#map .buspulse-3d-toggle').click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => __sceneMock.created)).toBe(0);
  await expect(page.locator('#map .buspulse-3d-overlay')).toHaveCount(0);
  await page.evaluate(() => window.__mockScenario='slow-scene');
  await page.locator('#map .buspulse-3d-toggle').click();
  await expect.poll(() => page.evaluate(() => __sceneMock.created)).toBe(1);
  await page.evaluate(() => BusPulse3DMap.suspend(fixture.map));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => ({created:__sceneMock.created,destroyed:__sceneMock.destroyed,disposed:__sceneMock.disposedScenes,mode:BusPulse3DMap.getState(fixture.map).mode,resumed:fixture.counters.resumed}))).toEqual({created:1,destroyed:1,disposed:1,mode:'2d',resumed:1});
});

for (const scenario of ['sdk-error','gpu-error','model-error']) {
  test(`${scenario} restores the original 2D map and makes retry available`, async ({ page }) => {
    await open(page,scenario);
    await page.locator('#map .buspulse-3d-toggle').click();
    await expect.poll(() => page.evaluate(() => BusPulse3DMap.getState(fixture.map).phase)).toBe('error');
    await expect(page.locator('#map .buspulse-3d-overlay')).toHaveCount(0);
    await expect(page.locator('#map .leaflet-map-pane')).toHaveCSS('visibility', 'visible');
    await expect(page.locator('#map .leaflet-marker-pane .image-stop-marker')).toBeVisible();
    await expect(page.locator('#map .buspulse-3d-toggle')).toHaveText('3D');
    expect(await page.evaluate(() => fixture.counters.resumed)).toBe(1);
    expect(await page.evaluate(() => fixture.map.hasLayer(fixture.marker) && fixture.map.dragging.enabled())).toBe(true);
    await page.evaluate(() => window.__mockScenario='');
    await enable(page);
  });
}

test('render/context failures fall back and an idle bridge does not create a busy render loop', async ({ page }) => {
  await open(page);
  await enable(page);
  await page.waitForTimeout(200);
  const renders=await page.evaluate(() => __sceneMock.renderRequests);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => __sceneMock.renderRequests)).toBe(renders);
  await page.evaluate(() => __sceneMock.viewers[0].scene.renderError.raiseEvent(__sceneMock.viewers[0].scene,new Error('fixture render failure')));
  await expect(page.locator('#map .buspulse-3d-overlay')).toHaveCount(0);
  await enable(page);
  await page.evaluate(() => __sceneMock.viewers[1].canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true})));
  await expect(page.locator('#map .buspulse-3d-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => __sceneMock.destroyed)).toBe(2);
});
