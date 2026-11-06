/* BusPulse: optional LandsD textured scene over the application's original Leaflet map. */
(() => {
  'use strict';

  const states = new WeakMap();
  const DEFAULT_FOVY = 2 * Math.atan(1 / 3);
  const FRAME_MS = 60; // Dirty-only projection, at most ~17 Hz; never a polling/render loop.
  let active = null;
  let runtimePromise = null;

  function loadRuntime() {
    if (!runtimePromise) {
      runtimePromise = import(new URL('landsd-3d-runtime.js', document.baseURI).href)
        .catch(error => { runtimePromise = null; throw error; });
    }
    return runtimePromise;
  }

  function usable(state) {
    return !state.disposed && state.container.isConnected && !state.map._removed;
  }

  function updateControl(state) {
    const on = state.mode === '3d';
    state.button.textContent = on ? '2D' : '3D';
    state.button.title = on ? '返回 2D 地圖' : '地政總署實景 3D';
    state.button.setAttribute('aria-label', state.button.title);
    state.button.setAttribute('aria-pressed', String(on));
    state.button.setAttribute('aria-busy', String(state.loading));
    state.zoomTools.hidden = !on;
    state.container.classList.toggle('buspulse-is-3d', on);
    if (state.status) {
      const labels = { loading: '載入實景 3D…', preview: '實景預覽', refining: '提高模型細節…', ready: '', error: '3D 暫時無法使用，已返回 2D' };
      state.status.textContent = labels[state.phase] || '';
      state.status.hidden = !state.status.textContent;
    }
  }

  function requestProjection(state) {
    if (!state.viewer || state.mode !== '3d' || state.frameTimer !== null) return;
    const wait = Math.max(0, FRAME_MS - (performance.now() - state.lastFrame));
    state.frameTimer = setTimeout(() => {
      state.frameTimer = null;
      if (!usable(state)) { dispose(state); return; }
      if (!state.viewer || state.mode !== '3d') return;
      state.lastFrame = performance.now();
      try {
        if (state.cameraDirty) {
          state.cameraDirty = false;
          cameraToLeaflet(state);
        }
        state.records.forEach(record => updateRecord(state, record));
        projectPopup(state);
      } catch (error) {
        fail(state, error);
      }
    }, wait);
  }

  function render(state) {
    state.viewer?.scene.requestRender();
    requestProjection(state);
  }

  function height(state) {
    return state.viewer.canvas.clientHeight || state.container.clientHeight || 1;
  }

  function fovy(state) {
    return state.viewer.camera.frustum.fovy || DEFAULT_FOVY;
  }

  function leafletToCamera(state) {
    if (!state.viewer || state.syncing || !state.map._loaded) return;
    const centre = state.map.getCenter();
    const range = state.runtime.zoomToRange(state.map.getZoom(), centre.lat, height(state), fovy(state));
    state.syncing = true;
    try {
      // Target the same mathematical ground point (not a building roof). A tighter
      // downward view on narrow maps keeps near buildings out of the foreground.
      const pitch = state.container.clientWidth <= 600 ? -60 : -55;
      state.viewer.camera.lookAt(state.C.Cartesian3.fromDegrees(centre.lng, centre.lat),
        new state.C.HeadingPitchRange(state.viewer.camera.heading || 0, pitch * Math.PI / 180, range));
      state.viewer.camera.lookAtTransform(state.C.Matrix4.IDENTITY);
    } finally { state.syncing = false; }
    render(state);
  }

  function cameraToLeaflet(state) {
    if (!state.viewer || state.syncing || !state.map._loaded) return;
    const C = state.C;
    const camera = state.viewer.camera;
    const canvas = state.viewer.canvas;
    // Never globe.pick: textured meshes/terrain must not move the shared centre.
    const point = camera.pickEllipsoid(new C.Cartesian2(
      (canvas.clientWidth || state.container.clientWidth) / 2,
      height(state) / 2
    ), C.Ellipsoid.WGS84);
    if (!point) return;
    const ll = C.Cartographic.fromCartesian(point, C.Ellipsoid.WGS84);
    const lat = C.Math.toDegrees(ll.latitude);
    const lng = C.Math.toDegrees(ll.longitude);
    const range = C.Cartesian3.distance(camera.positionWC, point);
    const zoom = state.runtime.rangeToZoom(range, lat, height(state), fovy(state));
    if (![lat, lng, zoom].every(Number.isFinite)) return;
    const previous = state.map.getCenter();
    if (Math.abs(previous.lat - lat) < 1e-8 && Math.abs(previous.lng - lng) < 1e-8
      && Math.abs(state.map.getZoom() - zoom) < 1e-7) return;
    state.syncing = true;
    const snap = state.map.options.zoomSnap;
    try {
      // Leaflet otherwise rounds a fractional Cesium scale to its default integer.
      // Restore the application's interaction preference immediately afterwards.
      state.map.options.zoomSnap = 0;
      state.map.setView([lat, lng], zoom, { animate: false });
    } finally {
      state.map.options.zoomSnap = snap;
      state.syncing = false;
    }
  }

  function project(state, latlng) {
    if (!latlng || !Number.isFinite(latlng.lat) || !Number.isFinite(latlng.lng)) return null;
    const C = state.C;
    const world = C.Cartesian3.fromDegrees(latlng.lng, latlng.lat, 0);
    const camera = state.viewer.camera;
    if (C.Cartesian3.dot && camera.directionWC) {
      const direction = C.Cartesian3.subtract(world, camera.positionWC, new C.Cartesian3());
      if (C.Cartesian3.dot(direction, camera.directionWC) <= 0) return null;
    }
    return C.SceneTransforms.worldToWindowCoordinates(state.viewer.scene, world);
  }

  function place(state, node, latlng, anchor = [0, 0]) {
    const point = project(state, latlng);
    const w = state.viewer.canvas.clientWidth || state.container.clientWidth;
    const h = height(state);
    const visible = point && point.x >= -150 && point.y >= -150 && point.x <= w + 150 && point.y <= h + 150;
    node.hidden = !visible;
    if (visible) {
      node.style.transform = `translate3d(${point.x - anchor[0]}px,${point.y - anchor[1]}px,0)`;
      node.dataset.lat = String(latlng.lat);
      node.dataset.lng = String(latlng.lng);
    }
  }

  function originalClick(record, event) {
    if (record.layer.options.interactive === false) return;
    event.preventDefault();
    event.stopPropagation();
    record.layer.fire('click', { latlng: record.layer.getLatLng(), originalEvent: event });
  }

  function markerElement(record) {
    const layer = record.layer;
    const icon = layer.options.icon?.options || {};
    let node;
    // Clone appearance only, never the original popup or its event-bearing nodes.
    if (layer._icon) node = layer._icon.cloneNode(true);
    else if ('html' in icon) {
      node = document.createElement('div');
      if (icon.html instanceof HTMLElement) node.appendChild(icon.html.cloneNode(true));
      else node.innerHTML = icon.html || '';
      node.className = `leaflet-marker-icon ${icon.className || ''}`;
    } else {
      node = document.createElement('img');
      node.src = icon.iconUrl || '';
      node.className = `leaflet-marker-icon ${icon.className || ''}`;
    }
    node.removeAttribute('id');
    node.removeAttribute('tabindex');
    node.style.transform = 'none';
    node.style.left = '0px';
    node.style.top = '0px';
    node.style.marginLeft = '0px';
    node.style.marginTop = '0px';
    node.style.pointerEvents = 'none';
    const size = icon.iconSize ? window.L.point(icon.iconSize) : null;
    if (size) { node.style.width = `${size.x}px`; node.style.height = `${size.y}px`; }
    return { node, size, icon };
  }

  function updateMarker(state, record) {
    const { node, size, icon } = markerElement(record);
    const signature = node.outerHTML;
    if (record.signature !== signature) {
      record.dom.replaceChildren(node);
      record.signature = signature;
    }
    const anchor = icon.iconAnchor ? window.L.point(icon.iconAnchor) : size ? size.divideBy(2) : window.L.point(0, 0);
    record.dom.style.opacity = String(record.layer.options.opacity ?? 1);
    record.dom.style.zIndex = String(1000 + (record.layer.options.zIndexOffset || 0));
    record.dom.title = record.layer.options.title || '';
    setInteractive(record);
    place(state, record.dom, record.layer.getLatLng(), [anchor.x, anchor.y]);
  }

  function setInteractive(record) {
    const interactive = record.layer.options.interactive !== false;
    record.dom.style.pointerEvents = interactive ? 'auto' : 'none';
    record.dom.setAttribute('aria-hidden', String(!interactive));
    if (interactive) {
      record.dom.setAttribute('role', 'button');
      record.dom.setAttribute('aria-label', record.layer.options.title || '地圖標記');
    } else record.dom.removeAttribute('role');
    record.dom.tabIndex = interactive && record.layer.options.keyboard !== false ? 0 : -1;
  }

  function updateCircle(state, record) {
    const options = record.layer.options;
    const radius = record.layer.getRadius();
    const weight = options.stroke === false ? 0 : (options.weight ?? 3);
    const half = radius + weight / 2;
    const signature = JSON.stringify([radius, weight, options.color, options.opacity, options.fill, options.fillColor, options.fillOpacity]);
    if (record.signature !== signature) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', String(half * 2));
      svg.setAttribute('height', String(half * 2));
      const circle = document.createElementNS(svg.namespaceURI, 'circle');
      Object.entries({ cx: half, cy: half, r: radius, stroke: options.color || '#3388ff',
        'stroke-width': weight, 'stroke-opacity': options.opacity ?? 1,
        fill: options.fill === false ? 'none' : options.fillColor || options.color || '#3388ff',
        'fill-opacity': options.fillOpacity ?? 0.2 }).forEach(([key, value]) => circle.setAttribute(key, String(value)));
      svg.appendChild(circle);
      record.dom.replaceChildren(svg);
      record.signature = signature;
    }
    record.dom.style.zIndex = '800';
    setInteractive(record);
    place(state, record.dom, record.layer.getLatLng(), [half, half]);
  }

  function lineParts(latlngs, result = []) {
    if (!Array.isArray(latlngs) || !latlngs.length) return result;
    if (typeof latlngs[0]?.lat === 'number') {
      if (latlngs.length > 1) result.push(latlngs);
    } else latlngs.forEach(part => lineParts(part, result));
    return result;
  }

  function updateLine(state, record) {
    const options = record.layer.options;
    const parts = lineParts(record.layer.getLatLngs());
    const signature = JSON.stringify([parts, options.color, options.weight, options.opacity, options.stroke]);
    if (signature === record.signature) return;
    record.entities.forEach(entity => state.viewer.entities.remove(entity));
    record.entities = [];
    if (options.stroke !== false) {
      const material = state.C.Color.fromCssColorString(options.color || '#3388ff').withAlpha(options.opacity ?? 1);
      parts.forEach(part => {
        record.entities.push(state.viewer.entities.add({ polyline: {
          positions: state.C.Cartesian3.fromDegreesArray(part.flatMap(ll => [ll.lng, ll.lat])),
          // Ground batches otherwise reorder overlapping opaque/translucent
          // strokes: the original grey casing must remain BELOW the red route.
          width: options.weight ?? 3, material, clampToGround: true, zIndex: record.lineOrder
        } }));
      });
    }
    record.signature = signature;
    state.viewer.scene.requestRender();
  }

  function updateRecord(state, record) {
    if (record.kind === 'marker') updateMarker(state, record);
    else if (record.kind === 'circle') updateCircle(state, record);
    else updateLine(state, record);
  }

  function addLayer(state, layer) {
    if (!state.viewer || state.records.has(layer)) return;
    const L = window.L;
    const kind = layer instanceof L.Marker ? 'marker'
      : layer instanceof L.CircleMarker ? 'circle'
        : layer instanceof L.Polyline ? 'line' : null;
    if (!kind) return;
    const record = { layer, kind, entities: [], dom: null, signature: null };
    if (kind === 'line') record.lineOrder = ++state.lineOrder;
    state.records.set(layer, record);
    record.onChange = () => requestProjection(state);
    layer.on('move', record.onChange);
    if (kind !== 'line') {
      record.dom = document.createElement('div');
      record.dom.className = `buspulse-3d-marker buspulse-3d-${kind}`;
      record.dom.dataset.leafletId = String(L.stamp(layer));
      record.dom.addEventListener('click', event => originalClick(record, event));
      record.dom.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') originalClick(record, event);
      });
      state.markers.appendChild(record.dom);
    }
    updateRecord(state, record);
  }

  function removeLayer(state, layer) {
    const record = state.records.get(layer);
    if (!record) return;
    layer.off('move', record.onChange);
    record.dom?.remove();
    record.entities.forEach(entity => state.viewer?.entities.remove(entity));
    state.records.delete(layer);
    render(state);
  }

  function restorePopup(state) {
    const record = state.popup;
    if (!record) return;
    state.popup = null;
    record.observer?.disconnect();
    // The whole original Leaflet popup is moved, so getElement(), content-node
    // listeners and Leaflet's original close button remain exactly the same.
    if (state.map.hasLayer(record.popup) && record.parent?.isConnected) {
      if (record.next?.parentNode === record.parent) record.parent.insertBefore(record.element, record.next);
      else record.parent.appendChild(record.element);
      record.element.style.transform = record.transform;
      try { record.popup._updatePosition(); } catch {}
    }
    record.wrapper.remove();
  }

  function movePopup(state, popup) {
    if (!state.viewer || state.mode !== '3d' || !state.map.hasLayer(popup)) return;
    if (state.popup?.popup === popup) return;
    restorePopup(state);
    const element = popup.getElement();
    if (!element?.parentNode) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'buspulse-3d-popup';
    state.markers.appendChild(wrapper);
    const record = { popup, element, wrapper, parent: element.parentNode,
      next: element.nextSibling, transform: element.style.transform, observer: null };
    state.popup = record;
    wrapper.appendChild(element);
    record.observer = new MutationObserver(() => requestProjection(state));
    record.observer.observe(element, { attributes: true, childList: true, subtree: true, characterData: true });
    projectPopup(state);
  }

  function projectPopup(state) {
    const record = state.popup;
    if (!record) return;
    if (!state.map.hasLayer(record.popup)) { restorePopup(state); return; }
    const ll = record.popup._source?.getLatLng?.() || record.popup.getLatLng();
    place(state, record.wrapper, ll);
    // Keep Leaflet's computed left/bottom/popupAnchor and layout, replacing only
    // its map-pane translation with our screen-space wrapper's translation.
    if (record.element.style.transform !== 'none') record.element.style.transform = 'none';
  }

  function watchScene(state) {
    const scene = state.viewer.scene;
    const camera = state.viewer.camera;
    const clickHandler = state.clickHandler = new state.C.ScreenSpaceEventHandler(state.viewer.canvas);
    clickHandler.setInputAction(movement => {
      const point = camera.pickEllipsoid(movement.position, state.C.Ellipsoid.WGS84);
      if (!point) return;
      const coordinate = state.C.Cartographic.fromCartesian(point, state.C.Ellipsoid.WGS84);
      const event = { latlng: window.L.latLng(state.C.Math.toDegrees(coordinate.latitude),
        state.C.Math.toDegrees(coordinate.longitude)), originalEvent: movement };
      // Preserve Leaflet's own popup closeOnClick and map closePopupOnClick rules.
      state.map.fire('preclick', event);
      state.map.fire('click', event);
    }, state.C.ScreenSpaceEventType.LEFT_CLICK);
    const changed = () => {
      if (!state.syncing) state.cameraDirty = true;
      requestProjection(state);
    };
    const removers = [camera.changed.addEventListener(changed), camera.moveEnd.addEventListener(changed),
      scene.postRender.addEventListener(() => requestProjection(state)),
      scene.renderError.addEventListener((_scene, error) => fail(state, error || new Error('3D rendering failed')))];
    const lost = event => { event.preventDefault(); fail(state, new Error('WebGL context lost')); };
    state.viewer.canvas.addEventListener('webglcontextlost', lost);
    state.sceneCleanup = () => {
      removers.forEach(remove => { if (typeof remove === 'function') remove(); });
      state.viewer?.canvas.removeEventListener('webglcontextlost', lost);
      state.clickHandler?.destroy();
      state.clickHandler = null;
    };
    state.paneObserver = new MutationObserver(() => requestProjection(state));
    state.paneObserver.observe(state.map.getPane('mapPane'), {
      attributes: true, childList: true, characterData: true, subtree: true
    });
    // Leaflet setIcon/setStyle have no public change event; observe their original
    // DOM, rather than patching layer methods or continuously polling bus data.
    if (typeof ResizeObserver !== 'undefined') {
      state.resizeObserver = new ResizeObserver(() => {
        if (!state.viewer || !usable(state)) return;
        try { state.viewer.resize(); leafletToCamera(state); } catch (error) { fail(state, error); }
      });
      state.resizeObserver.observe(state.container);
    }
  }

  function pauseLeafletInput(state) {
    state.handlers = [];
    ['dragging', 'scrollWheelZoom', 'doubleClickZoom', 'boxZoom', 'keyboard', 'touchZoom'].forEach(name => {
      const handler = state.map[name];
      if (handler?.enabled()) { state.handlers.push(handler); handler.disable(); }
    });
  }

  async function start(state) {
    if (!usable(state) || state.mode === '3d') return;
    if (active && active !== state) stop(active, true);
    active = state;
    const generation = ++state.generation;
    const abort = state.abort = new AbortController();
    state.mode = '3d';
    state.loading = true;
    state.phase = 'loading';
    state.pending = 0;
    state.error = null;
    state.overlay = document.createElement('div');
    state.overlay.className = 'buspulse-3d-overlay';
    state.host = document.createElement('div');
    state.host.className = 'buspulse-3d-canvas';
    state.markers = document.createElement('div');
    state.markers.className = 'buspulse-3d-markers';
    state.status = document.createElement('div');
    state.status.className = 'buspulse-3d-status';
    state.status.setAttribute('role', 'status');
    state.overlay.append(state.host, state.markers, state.status);
    const source = document.createElement('div');
    source.className = 'buspulse-3d-source';
    source.innerHTML = '3D: &copy; <a href="https://www.landsd.gov.hk/en/spatial-data/open-data.html" target="_blank" rel="noopener">HKSAR Government · Lands Department</a>';
    state.overlay.appendChild(source);
    state.container.appendChild(state.overlay);
    window.L.DomEvent.disableClickPropagation(state.overlay);
    window.L.DomEvent.disableScrollPropagation(state.overlay);
    pauseLeafletInput(state);
    updateControl(state);
    const current = () => usable(state) && state.mode === '3d' && generation === state.generation && !abort.signal.aborted;
    try {
      state.hooks.suspendBasemap?.();
      const runtime = await loadRuntime();
      if (!current()) return;
      state.runtime = runtime;
      const C = await runtime.loadCesium();
      if (!current()) return;
      const config = runtime.getLandsD3DConfig();
      if (!config) throw new Error('LandsD 3D configuration unavailable');
      state.C = C;
      state.viewer = new C.Viewer(state.host, {
        baseLayer: false, terrainProvider: new C.EllipsoidTerrainProvider(),
        requestRenderMode: true, maximumRenderTimeChange: Infinity, shouldAnimate: false,
        animation: false, timeline: false, baseLayerPicker: false, geocoder: false,
        homeButton: false, sceneModePicker: false, navigationHelpButton: false,
        fullscreenButton: false, vrButton: false, infoBox: false, selectionIndicator: false,
        automaticallyTrackDataSourceClocks: false
      });
      state.viewer.scene.screenSpaceCameraController.enableTilt = true;
      state.viewer.scene.screenSpaceCameraController.enableLook = false;
      state.viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
      watchScene(state);
      leafletToCamera(state);
      state.map.eachLayer(layer => addLayer(state, layer));
      if (state.map._popup) queueMicrotask(() => movePopup(state, state.map._popup));
      const release = await runtime.attachLandsDScene(C, state.viewer, config, value => {
        if (!current()) return;
        state.phase = value.phase;
        state.pending = value.pending;
        if (value.phase === 'error') { fail(state, new Error('LandsD 3D models unavailable')); return; }
        state.loading = value.phase === 'loading';
        updateControl(state);
        requestProjection(state);
      }, abort.signal);
      if (!current()) { if (typeof release === 'function') release(); return; }
      state.sceneDisposer = release;
      state.loading = false;
      updateControl(state);
      render(state);
    } catch (error) {
      if (current()) fail(state, error);
    }
  }

  function stop(state, resumeBasemap) {
    const was3d = state.mode === '3d';
    if (state.viewer && usable(state)) {
      try { cameraToLeaflet(state); } catch {}
    }
    state.generation++;
    state.abort?.abort();
    state.abort = null;
    if (state.frameTimer !== null) clearTimeout(state.frameTimer);
    state.frameTimer = null;
    state.paneObserver?.disconnect();
    state.paneObserver = null;
    state.resizeObserver?.disconnect();
    state.resizeObserver = null;
    restorePopup(state);
    state.sceneCleanup?.();
    state.sceneCleanup = null;
    if (typeof state.sceneDisposer === 'function') {
      try { state.sceneDisposer(); } catch {}
    }
    state.sceneDisposer = null;
    state.records.forEach(record => record.layer.off('move', record.onChange));
    state.records.clear();
    if (state.viewer) {
      try { if (!state.viewer.isDestroyed()) state.viewer.destroy(); } catch {}
      state.viewer = null;
    }
    state.overlay?.remove();
    state.overlay = state.host = state.markers = state.status = null;
    state.mode = '2d';
    state.loading = false;
    state.pending = 0;
    state.cameraDirty = false;
    if (active === state) active = null;
    if (usable(state)) state.handlers.forEach(handler => handler.enable());
    state.handlers = [];
    updateControl(state);
    if (was3d && resumeBasemap && usable(state)) {
      try {
        const pending = state.hooks.resumeBasemap?.();
        pending?.catch?.(error => console.warn('[BusPulse 3D] Basemap resume failed.', error));
      } catch (error) { console.warn('[BusPulse 3D] Basemap resume failed.', error); }
    }
  }

  function fail(state, error) {
    if (state.mode !== '3d') return;
    state.error = error;
    state.phase = 'error';
    stop(state, true);
    state.button.title = '3D 暫時無法使用，按此重試';
    state.button.setAttribute('aria-label', state.button.title);
    console.warn('[BusPulse 3D] Returning to 2D.', error);
  }

  function dispose(state) {
    if (state.disposed) return;
    state.fullscreen?.dispose();
    state.disposed = true;
    stop(state, false);
    state.observer?.disconnect();
    state.observer = null;
    state.map.off(state.events);
    try { state.map.removeControl(state.control); } catch {}
  }

  function install(map, hooks = {}) {
    const existing = states.get(map);
    if (existing) return existing.controller;
    const state = { map, hooks, container: map.getContainer(), mode: '2d', phase: 'ready',
      loading: false, pending: 0, viewer: null, disposed: false, error: null,
      generation: 0, abort: null, records: new Map(), handlers: [], popup: null,
      frameTimer: null, lastFrame: 0, syncing: false, cameraDirty: false, lineOrder: 0 };
    states.set(map, state);
    state.fullscreen = window.BusPulseMapFullscreen?.install(map);
    const control = state.control = window.L.control({ position: 'topleft' });
    control.onAdd = () => {
      const root = window.L.DomUtil.create('div', 'leaflet-bar buspulse-3d-control');
      state.button = document.createElement('button');
      state.button.type = 'button';
      state.button.className = 'buspulse-3d-toggle';
      root.appendChild(state.button);
      state.zoomTools = document.createElement('div');
      state.zoomTools.className = 'buspulse-3d-zoom';
      [['+', 1, '放大 3D 地圖'], ['−', -1, '縮小 3D 地圖']].forEach(([text, direction, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.setAttribute('aria-label', label);
        button.addEventListener('click', () => {
          if (state.mode !== '3d' || !state.viewer) return;
          cameraToLeaflet(state);
          state.map.setZoom(state.map.getZoom() + direction, { animate: false });
        });
        state.zoomTools.appendChild(button);
      });
      root.appendChild(state.zoomTools);
      state.button.addEventListener('click', () => {
        if (state.mode === '3d') stop(state, true);
        else void start(state);
      });
      window.L.DomEvent.disableClickPropagation(root);
      window.L.DomEvent.disableScrollPropagation(root);
      return root;
    };
    control.addTo(map);
    state.events = {
      layeradd: event => { if (state.mode === '3d') addLayer(state, event.layer); },
      layerremove: event => { removeLayer(state, event.layer); },
      move: () => { if (state.mode === '3d') leafletToCamera(state); },
      zoom: () => { if (state.mode === '3d') leafletToCamera(state); },
      resize: () => { if (state.mode === '3d') leafletToCamera(state); },
      popupopen: event => {
        // Leaflet fires map.popupopen before marker.popupopen. Wait for ALL original
        // marker handlers to attach their .popup-select/.getoff-select listeners.
        const generation = state.generation;
        queueMicrotask(() => { if (state.generation === generation) movePopup(state, event.popup); });
      },
      popupclose: event => { if (state.popup?.popup === event.popup) restorePopup(state); },
      unload: () => dispose(state)
    };
    map.on(state.events);
    state.observer = new MutationObserver(() => { if (!state.container.isConnected) dispose(state); });
    if (document.body) state.observer.observe(document.body, { childList: true, subtree: true });
    state.controller = Object.freeze({
      toggle: () => state.mode === '3d' ? stop(state, true) : start(state),
      setMode: mode => mode === '3d' ? start(state) : stop(state, true),
      suspend: () => { state.fullscreen?.exit(); stop(state, false); },
      getState: () => state
    });
    updateControl(state);
    return state.controller;
  }

  window.BusPulse3DMap = Object.freeze({ install,
    suspend: map => { const state = states.get(map); if (state) { state.fullscreen?.exit(); stop(state, false); } },
    getState: map => states.get(map) || null
  });
})();
