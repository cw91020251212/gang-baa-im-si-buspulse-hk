/*
 * BusPulse HK LandsD basemap adapter.
 * Uses the official Lands Department Vector Map style/PBF service and its
 * Traditional Chinese label tiles, rendered by MapLibre through Leaflet.
 */
(() => {
  'use strict';

  const STYLE_URL = 'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/vt/basemap/WGS84/resources/styles/root.json';
  const VECTOR_TILE_URL = 'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/vt/basemap/WGS84/tile/{z}/{y}/{x}.pbf';
  const LABEL_TILE_URL = 'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/tc/WGS84/{z}/{x}/{y}.png';
  const ADAPTER_URL = 'https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/dist/leaflet-maplibre-gl.mjs';
  const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const LANDSD_ATTRIBUTION = 'Map from Lands Department';
  const ROUTE_ATTRIBUTION = 'Route data: <a href="https://github.com/hkbus/route-waypoints" target="_blank" rel="noopener">HK Bus Crawling@2021</a>';
  const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';
  const states = new WeakMap();
  let stylePromise = null;
  let adapterPromise = null;

  function absoluteStyleURL(value) {
    if (typeof value !== 'string') return value;
    return new URL(value, STYLE_URL).href.replace(/%7B/gi, '{').replace(/%7D/gi, '}');
  }

  function loadOfficialStyle() {
    if (!stylePromise) {
      stylePromise = fetch(STYLE_URL, { mode: 'cors' })
        .then(response => {
          if (!response.ok) throw new Error(`LandsD style HTTP ${response.status}`);
          return response.json();
        })
        .then(style => {
          if (!style || style.version !== 8 || !style.sources || !Array.isArray(style.layers)) {
            throw new Error('Unexpected LandsD Vector Map style format');
          }
          const vectorSource = Object.values(style.sources).find(source => source?.type === 'vector');
          if (!vectorSource) throw new Error('LandsD style has no vector source');
          delete vectorSource.url;
          vectorSource.tiles = [VECTOR_TILE_URL];
          vectorSource.attribution = LANDSD_ATTRIBUTION;
          if (style.glyphs) style.glyphs = absoluteStyleURL(style.glyphs);
          if (typeof style.sprite === 'string') style.sprite = absoluteStyleURL(style.sprite);
          style.sources['buspulse-landsd-tc-labels'] = {
            type: 'raster',
            tiles: [LABEL_TILE_URL],
            minzoom: 8,
            maxzoom: 20,
            tileSize: 256
          };
          style.layers.push({
            id: 'buspulse-landsd-tc-label-overlay',
            type: 'raster',
            source: 'buspulse-landsd-tc-labels',
            paint: { 'raster-opacity': 1 }
          });
          return style;
        })
        .catch(error => {
          stylePromise = null;
          throw error;
        });
    }
    return stylePromise;
  }

  function loadLeafletAdapter() {
    if (typeof window.L?.maplibreGL === 'function') return Promise.resolve(window.L.maplibreGL);
    if (!adapterPromise) {
      adapterPromise = import(ADAPTER_URL)
        .then(module => {
          const factory = module.maplibreGL || module.default;
          if (typeof factory !== 'function') throw new Error('MapLibre–Leaflet adapter did not export maplibreGL');
          // The adapter is an ESM class built against the same Leaflet release.
          // Leaflet's public layer contract is interoperable with the app's global build.
          window.L.maplibreGL = factory;
          if (module.MaplibreGL) window.L.MaplibreGL = module.MaplibreGL;
          return factory;
        })
        .catch(error => {
          adapterPromise = null;
          throw error;
        });
    }
    return adapterPromise;
  }

  function mapIsUsable(map) {
    try {
      const container = map?.getContainer?.();
      return !!container && container.isConnected && !map._removed;
    } catch {
      return false;
    }
  }

  function createLogoControl(map) {
    const control = window.L.control({ position: 'bottomleft' });
    control.onAdd = () => {
      const link = window.L.DomUtil.create('a', 'landsd-leaflet-credit');
      link.href = 'https://www.landsd.gov.hk/';
      link.target = '_blank';
      link.rel = 'noopener';
      link.title = '香港地政總署官方地圖';
      link.setAttribute('aria-label', 'Map from Lands Department');
      const logo = window.L.DomUtil.create('img', '', link);
      logo.src = new URL('assets/landsd-logo.png', document.baseURI).href;
      logo.alt = 'Lands Department';
      const text = window.L.DomUtil.create('span', '', link);
      text.textContent = LANDSD_ATTRIBUTION;
      window.L.DomEvent.disableClickPropagation(link);
      return link;
    };
    control.addTo(map);
    return control;
  }

  function clearTimer(state) {
    if (state.watchdog) clearTimeout(state.watchdog);
    state.watchdog = null;
  }

  function removeLayer(map, layer) {
    if (!map || !layer) return;
    try {
      if (map.hasLayer(layer)) map.removeLayer(layer);
    } catch {}
  }

  function removeLandsD(state) {
    clearTimer(state);
    removeLayer(state.map, state.glLayer);
    state.glLayer = null;
    state.glMap = null;
    state.ready = false;
    if (state.logoControl) {
      try { state.map.removeControl(state.logoControl); } catch {}
      state.logoControl = null;
    }
    try { state.map.attributionControl?.removeAttribution(LANDSD_ATTRIBUTION); } catch {}
  }

  function removeFallback(state) {
    removeLayer(state.map, state.fallbackLayer);
    state.fallbackLayer = null;
  }

  function fallbackToOSM(state, error) {
    if (state.disposed || state.suspended || !mapIsUsable(state.map)) return state;
    removeLandsD(state);
    if (!state.fallbackLayer) {
      state.fallbackLayer = window.L.tileLayer(OSM_TILE_URL, {
        maxZoom: 19,
        attribution: OSM_ATTRIBUTION,
        crossOrigin: true
      }).addTo(state.map);
    }
    state.error = error || new Error('LandsD basemap unavailable');
    console.warn('[BusPulse map] LandsD basemap unavailable; using OpenStreetMap fallback.', state.error);
    return state;
  }

  function getState(map) {
    let state = states.get(map);
    if (state) return state;
    state = {
      map,
      generation: 0,
      pending: null,
      suspended: false,
      disposed: false,
      ready: false,
      glLayer: null,
      glMap: null,
      logoControl: null,
      fallbackLayer: null,
      watchdog: null,
      error: null,
      observer: null
    };
    states.set(map, state);
    if (map.attributionControl) map.attributionControl.addAttribution(ROUTE_ATTRIBUTION);
    map.once('unload', () => {
      state.disposed = true;
      state.suspended = true;
      state.generation++;
      clearTimer(state);
      state.observer?.disconnect();
      state.observer = null;
    });

    // Some route sheets replace their DOM without an explicit Leaflet remove.
    // Tear down the map in that case so MapLibre releases its WebGL context.
    if (typeof MutationObserver !== 'undefined' && document.body) {
      const container = map.getContainer();
      state.observer = new MutationObserver(() => {
        if (container?.isConnected || state.disposed) return;
        state.observer?.disconnect();
        state.observer = null;
        state.disposed = true;
        state.suspended = true;
        state.generation++;
        clearTimer(state);
        try { map.remove(); } catch {}
      });
      state.observer.observe(document.body, { childList: true, subtree: true });
    }
    return state;
  }

  function addToMap(map) {
    const state = getState(map);
    state.suspended = false;
    if (state.disposed || !mapIsUsable(map)) return Promise.resolve(state);
    if (state.glLayer || state.pending) return state.pending || Promise.resolve(state);

    removeFallback(state);
    const generation = ++state.generation;
    const task = Promise.all([loadOfficialStyle(), loadLeafletAdapter()])
      .then(([baseStyle, maplibreGL]) => {
        if (state.disposed || state.suspended || generation !== state.generation || !mapIsUsable(map)) return state;
        const style = JSON.parse(JSON.stringify(baseStyle));
        state.glLayer = maplibreGL({
          style,
          interactive: false,
          pane: 'tilePane',
          maxZoom: 19
        }).addTo(map);
        state.glMap = state.glLayer.getMaplibreMap();
        state.logoControl = createLogoControl(map);
        state.error = null;
        state.ready = false;
        state.glMap.once('load', () => {
          if (state.disposed || state.suspended || generation !== state.generation) return;
          state.ready = true;
          clearTimer(state);
        });
        state.watchdog = setTimeout(() => {
          if (!state.ready && !state.disposed && !state.suspended && generation === state.generation) {
            fallbackToOSM(state, new Error('LandsD basemap did not finish loading within 30 seconds'));
          }
        }, 30000);
        return state;
      })
      .catch(error => {
        if (!state.disposed && !state.suspended && generation === state.generation) fallbackToOSM(state, error);
        return state;
      })
      .finally(() => {
        if (state.pending === task) state.pending = null;
      });
    state.pending = task;
    return task;
  }

  function suspend(map) {
    const state = states.get(map);
    if (!state || state.disposed) return;
    state.suspended = true;
    state.generation++;
    state.pending = null;
    removeLandsD(state);
    removeFallback(state);
  }

  function resume(map) {
    const state = states.get(map);
    if (!state || state.disposed) return addToMap(map);
    if (!state.suspended && (state.glLayer || state.pending)) return state.pending || Promise.resolve(state);
    removeLandsD(state);
    removeFallback(state);
    state.suspended = false;
    return addToMap(map);
  }

  window.BusPulseLandsDMap = Object.freeze({
    addToMap,
    suspend,
    resume,
    getState: map => states.get(map) || null,
    urls: Object.freeze({ style: STYLE_URL, vectorTiles: VECTOR_TILE_URL, labels: LABEL_TILE_URL })
  });
})();
