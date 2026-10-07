(() => {
  'use strict';

  const API = 'https://mapapi.geodata.gov.hk/gs/api/v1.0.0';
  const LANDSD_STYLE_URL = `${API}/vt/basemap/WGS84/resources/styles/root.json`;
  const LANDSD_TILE_URL = `${API}/vt/basemap/WGS84/tile/{z}/{y}/{x}.pbf`;
  const LANDSD_LABEL_TILE_URL = `${API}/xyz/label/hk/tc/WGS84/{z}/{x}/{y}.png`;
  const initial = { center: [22.282, 114.158], zoom: 15 };
  const places = {
    central: { center: [22.282, 114.158], zoom: 15 },
    kowloon: { center: [22.316, 114.169], zoom: 15 },
    shatin: { center: [22.382, 114.188], zoom: 15 },
    tuenmun: { center: [22.391, 113.978], zoom: 15 }
  };

  const $ = (id) => document.getElementById(id);
  const fmt = (ms) => ms < 1000 ? `${Math.round(ms)} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`;
  const timers = { osm: performance.now(), landsd: performance.now() };
  const totals = { osm: 0, landsd: 0 };
  const failures = { osm: 0, landsd: 0 };
  let syncEnabled = true;
  let applyingSync = false;
  let syncUnlock;
  let osmMap;
  let landsdMap;
  let landsdStyleReady = false;

  function markFirst(which) {
    const el = $(`${which}-first`);
    if (el.dataset.done) return;
    el.dataset.done = '1';
    el.textContent = fmt(performance.now() - timers[which]);
  }

  function markReady(which) {
    const el = $(`${which}-ready`);
    if (el.dataset.done) return;
    el.dataset.done = '1';
    el.textContent = fmt(performance.now() - timers[which]);
    const state = $(`${which}-state`);
    state.textContent = failures[which]
      ? `首屏已完成；有 ${failures[which]} 個圖塊／地圖資源未載入，速度結果只供參考。`
      : `首屏瓦片載入完成；${totals[which]} 個地圖圖塊事件。`;
    state.className = `state-line ${failures[which] ? 'error' : 'ready'}`;
  }

  function bumpTiles(which, amount = 1) {
    totals[which] += amount;
    $(`${which}-count`).textContent = `${totals[which]} 塊`;
  }

  function recordFailure(which, reason = '') {
    failures[which] += 1;
    const detail = reason ? `（${reason.slice(0, 100)}）` : '';
    $(`${which}-state`).textContent = `有 ${failures[which]} 個圖塊／地圖資源載入失敗${detail}`;
    $(`${which}-state`).className = 'state-line error';
  }

  function resolveMapTemplate(template, baseUrl) {
    const placeholders = [];
    const protectedTemplate = template.replace(/\{[^}]+\}/g, (placeholder) => {
      const token = `__LANDSD_TEMPLATE_${placeholders.length}__`;
      placeholders.push(placeholder);
      return token;
    });
    return new URL(protectedTemplate, baseUrl).href.replace(
      /__LANDSD_TEMPLATE_(\d+)__/g,
      (_, index) => placeholders[Number(index)]
    );
  }

  function applyOfficialSource(style) {
    const source = style.sources?.esri;
    if (!source || source.type !== 'vector') {
      throw new Error('官方樣式內找不到預期的 ESRI 向量圖層。');
    }
    // 使用官方 PBF 瓦片模板；明確保留 WGS84 大小寫及 z/y/x 順序。
    delete source.url;
    source.tiles = [LANDSD_TILE_URL];
    source.attribution = 'Map from Lands Department';
    style.sources['buspulse-traditional-chinese-labels'] = {
      type: 'raster',
      tiles: [LANDSD_LABEL_TILE_URL],
      tileSize: 256,
      minzoom: 8,
      maxzoom: 20,
      attribution: 'Map from Lands Department'
    };
    style.layers.push({
      id: 'buspulse-traditional-chinese-labels',
      type: 'raster',
      source: 'buspulse-traditional-chinese-labels',
      paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 }
    });
    if (!style.glyphs) throw new Error('官方樣式沒有提供地圖文字字型（glyphs）網址。');
    style.glyphs = resolveMapTemplate(style.glyphs, LANDSD_STYLE_URL);
    if (style.sprite) style.sprite = resolveMapTemplate(style.sprite, LANDSD_STYLE_URL);
    return style;
  }

  async function createLandsDMap() {
    const response = await fetch(LANDSD_STYLE_URL, { mode: 'cors' });
    if (!response.ok) throw new Error(`地政總署樣式 API 回應 HTTP ${response.status}`);
    const style = applyOfficialSource(await response.json());
    const center = osmMap.getCenter();

    landsdMap = new maplibregl.Map({
      container: 'landsd-map',
      style,
      center: [center.lng, center.lat],
      zoom: osmMap.getZoom(),
      minZoom: 8,
      maxZoom: 19,
      attributionControl: false,
      renderWorldCopies: false,
      fadeDuration: 0,
      canvasContextAttributes: { antialias: false }
    });
    landsdMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    landsdMap.on('error', (event) => {
      const message = event.error?.message || String(event.error || '未知 MapLibre 錯誤');
      recordFailure('landsd', message);
    });
    landsdMap.on('sourcedata', (event) => {
      if (event.sourceId === 'esri' && event.sourceDataType === 'content') {
        bumpTiles('landsd');
        markFirst('landsd');
      }
    });
    landsdMap.once('load', () => { landsdStyleReady = true; });
    landsdMap.on('idle', () => {
      if (landsdStyleReady) markReady('landsd');
    });
    linkViews();
  }

  function setTargetView(target, center, zoom) {
    if (applyingSync) return;
    applyingSync = true;
    if (syncUnlock) window.clearTimeout(syncUnlock);
    if (target === 'landsd') landsdMap?.jumpTo({ center: [center[1], center[0]], zoom });
    else osmMap.setView(center, zoom, { animate: false });
    syncUnlock = window.setTimeout(() => { applyingSync = false; }, 220);
  }

  function linkViews() {
    if (!landsdMap) return;
    osmMap.on('moveend', () => {
      if (!syncEnabled || applyingSync) return;
      const center = osmMap.getCenter();
      setTargetView('landsd', [center.lat, center.lng], osmMap.getZoom());
    });
    landsdMap.on('moveend', () => {
      if (!syncEnabled || applyingSync) return;
      const center = landsdMap.getCenter();
      setTargetView('osm', [center.lat, center.lng], landsdMap.getZoom());
    });
  }

  function start() {
    if (!window.L || !window.maplibregl) {
      for (const which of ['osm', 'landsd']) {
        $(`${which}-state`).textContent = '地圖程式載入失敗；請重新整理頁面或確認網絡。';
        $(`${which}-state`).className = 'state-line error';
      }
      return;
    }

    osmMap = L.map('osm-map', { zoomControl: true, preferCanvas: true }).setView(initial.center, initial.zoom);
    const osmTiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      crossOrigin: true,
      keepBuffer: 0,
      updateWhenIdle: true,
      updateWhenZooming: false
    });
    osmTiles.on('tileload', () => { bumpTiles('osm'); markFirst('osm'); });
    osmTiles.on('tileerror', () => recordFailure('osm'));
    osmTiles.once('load', () => markReady('osm'));
    osmTiles.addTo(osmMap);

    const place = $('place');
    const syncSelectedPosition = () => {
      const view = places[place.value] || initial;
      osmMap.setView(view.center, view.zoom, { animate: false });
      landsdMap?.jumpTo({ center: [view.center[1], view.center[0]], zoom: view.zoom });
    };
    place.addEventListener('change', syncSelectedPosition);
    $('sync').addEventListener('change', (event) => { syncEnabled = event.target.checked; });
    $('reset').addEventListener('click', syncSelectedPosition);

    const observer = new ResizeObserver(() => {
      osmMap.invalidateSize({ pan: false });
      landsdMap?.resize();
    });
    observer.observe($('osm-map'));
    observer.observe($('landsd-map'));

    createLandsDMap().catch((error) => {
      recordFailure('landsd', error?.message || String(error));
    });

    window.setTimeout(() => {
      for (const which of ['osm', 'landsd']) {
        if (!$(`${which}-ready`).dataset.done && failures[which] === 0) {
          $(`${which}-state`).textContent = '仍在載入；慢網絡下請稍候。';
        }
      }
    }, 15000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
