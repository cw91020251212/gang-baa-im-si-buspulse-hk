/* BusPulse: CSS viewport fullscreen for the SAME Leaflet/optional 3D container.
 * No native Fullscreen API or SDK is required, including on mobile Safari.
 */
(() => {
  'use strict';
  const states = new WeakMap();
  let active = null;
  const MAP_CLASS = 'buspulse-map-fullscreen';
  const BODY_CLASS = 'buspulse-map-fullscreen-active';
  const expand = 'M9 3H3v6M15 3h6v6M21 15v6h-6M3 15v6h6';
  const contract = 'M3 9h6V3M15 3v6h6M21 15h-6v6M9 21v-6H3';

  function saveProperties(element, properties) {
    return properties.map(name => [name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]);
  }
  function restoreProperties(element, saved) {
    saved.forEach(([name, value, priority]) => {
      if (value) element.style.setProperty(name, value, priority);
      else element.style.removeProperty(name);
    });
  }
  function updateButton(state) {
    const label = state.fullscreen ? '退出全畫面地圖' : '全畫面地圖';
    state.button.title = label;
    state.button.setAttribute('aria-label', label);
    state.button.setAttribute('aria-pressed', String(state.fullscreen));
    state.path.setAttribute('d', state.fullscreen ? contract : expand);
  }

  function createContext(state) {
    const ancestors = [];
    for (let node = state.parent; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      ancestors.unshift(node);
    }
    let root = null;
    let host = null;
    ancestors.forEach(ancestor => {
      // Class-only shells retain selectors such as .detail-map-panel.open .route-map.
      // No IDs, controls, listeners or map nodes are cloned.
      const shell = document.createElement('div');
      shell.className = ancestor.className;
      shell.classList.add('buspulse-map-fullscreen-context');
      const computed = getComputedStyle(ancestor);
      for (let i = 0; i < computed.length; i++) {
        const name = computed[i];
        if (name.startsWith('--')) shell.style.setProperty(name, computed.getPropertyValue(name));
      }
      Object.entries({ display: 'contents', position: 'static', transform: 'none', translate: 'none', rotate: 'none', scale: 'none',
        perspective: 'none', filter: 'none', 'backdrop-filter': 'none', 'clip-path': 'none', clip: 'auto',
        overflow: 'visible', contain: 'none', 'content-visibility': 'visible', visibility: 'visible',
        opacity: '1', isolation: 'auto', 'will-change': 'auto', animation: 'none', transition: 'none' })
        .forEach(([name, value]) => shell.style.setProperty(name, value, 'important'));
      if (host) host.appendChild(shell);
      else root = shell;
      host = shell;
    });
    state.context = root;
    if (root) document.body.appendChild(root);
    return host || document.body;
  }

  function resize(state) {
    if (state.disposed || !state.container.isConnected || !state.map._loaded) return;
    const map = state.map;
    const before = map.getSize();
    // ResizeObserver reports once on installation too. Calling invalidateSize
    // with unchanged dimensions clears Leaflet's exact cached centre and adds
    // a subpixel drift before 3D even opens; do not invalidate an unchanged map.
    if (before.x === state.container.clientWidth && before.y === state.container.clientHeight) return;
    const center = map.getCenter();
    const zoom = map.getZoom();
    map.invalidateSize({ pan: false, animate: false });
    const after = map.getSize();
    // Leaflet's pan:false alone shifts the geographic centre when the size changes.
    // Reset the view without animation, retaining a fractional 3D zoom as well.
    if (!before.equals(after)) {
      const snap = map.options.zoomSnap;
      try {
        map.options.zoomSnap = 0;
        map.setView(center, zoom, { reset: true, animate: false });
      } finally { map.options.zoomSnap = snap; }
    }
  }
  function refresh(state) {
    resize(state);
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    state.frame = requestAnimationFrame(() => {
      state.frame = null;
      resize(state);
    });
  }

  function lockPage(state) {
    const body = document.body;
    const root = document.documentElement;
    state.page = {
      body, root, x: window.scrollX, y: window.scrollY,
      bodyStyles: saveProperties(body, ['position', 'top', 'left', 'width', 'overflow', 'overscroll-behavior']),
      rootStyles: saveProperties(root, ['overflow', 'overscroll-behavior']),
      hadFlag: body.classList.contains(BODY_CLASS)
    };
    body.classList.add(BODY_CLASS);
    Object.entries({ position: 'fixed', top: `-${state.page.y}px`, left: `-${state.page.x}px`, width: '100%', overflow: 'hidden', 'overscroll-behavior': 'none' })
      .forEach(([name, value]) => body.style.setProperty(name, value, 'important'));
    root.style.setProperty('overflow', 'hidden', 'important');
    root.style.setProperty('overscroll-behavior', 'none', 'important');
  }
  function unlockPage(state) {
    const page = state.page;
    if (!page) return;
    state.page = null;
    restoreProperties(page.body, page.bodyStyles);
    restoreProperties(page.root, page.rootStyles);
    if (!page.hadFlag) page.body.classList.remove(BODY_CLASS);
    // Ignore the application's smooth-scroll preference for exact restoration.
    const scrollBehavior = saveProperties(page.root, ['scroll-behavior']);
    page.root.style.setProperty('scroll-behavior', 'auto', 'important');
    window.scrollTo(page.x, page.y);
    restoreProperties(page.root, scrollBehavior);
  }

  function enter(state) {
    if (state.disposed || state.fullscreen || !state.container.isConnected || !document.body) return false;
    if (active && active !== state) exit(active);
    const container = state.container;
    const parent = container.parentNode;
    if (!parent || !parent.isConnected) return false;
    const computed = getComputedStyle(container);
    const placeholder = document.createElement('div');
    placeholder.className = 'buspulse-map-fullscreen-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    // Preserve the insertion point AND occupied space (including flex/grid layout).
    ['width', 'height', 'box-sizing', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'display', 'flex', 'align-self', 'order', 'grid-area']
      .forEach(name => placeholder.style.setProperty(name, computed.getPropertyValue(name)));
    placeholder.style.visibility = 'hidden';
    placeholder.style.pointerEvents = 'none';
    state.parent = parent;
    state.placeholder = placeholder;
    state.style = container.getAttribute('style');
    state.hadClass = container.classList.contains(MAP_CLASS);
    state.previousFocus = document.activeElement;
    // Leaflet 1.9.4's window handler invalidates again in a later animation
    // frame, clearing _lastCenter even after our precise view reset. While
    // fullscreen, this controller alone owns resizing; restore Leaflet on exit.
    state.nativeResizePaused = !!state.map.options.trackResize && typeof state.map._onResize === 'function';
    if (state.nativeResizePaused) {
      window.L.DomEvent.off(window, 'resize', state.map._onResize, state.map);
      window.L.Util.cancelAnimFrame(state.map._resizeRequest);
    }
    // Save/lock before insertion: browser scroll anchoring can otherwise move the
    // page by one map height when a placeholder is inserted above the viewport.
    lockPage(state);
    parent.insertBefore(placeholder, container);
    state.fullscreen = true;
    active = state;
    container.classList.add(MAP_CLASS);
    createContext(state).appendChild(container);
    // Inline important overrides also defeat an original inline important size.
    Object.entries({ position: 'fixed', inset: '0', width: '100vw', height: CSS.supports('height', '100dvh') ? '100dvh' : '100vh',
      'min-width': '0', 'min-height': '0', 'max-width': 'none', 'max-height': 'none', margin: '0',
      padding: '0', border: '0', 'border-radius': '0', 'z-index': '20000', transform: 'none', 'box-sizing': 'border-box' })
      .forEach(([name, value]) => container.style.setProperty(name, value, 'important'));
    window.addEventListener('keydown', state.onEscape, true);
    updateButton(state);
    refresh(state);
    state.button.focus({ preventScroll: true });
    return true;
  }

  function exit(state) {
    if (!state.fullscreen) return false;
    state.fullscreen = false;
    if (active === state) active = null;
    window.removeEventListener('keydown', state.onEscape, true);
    const container = state.container;
    const placeholder = state.placeholder;
    // Never resurrect a panel or a container removed by the application.
    const restore = container.isConnected && placeholder?.isConnected
      && state.parent?.isConnected && placeholder.parentNode === state.parent;
    if (restore) state.parent.insertBefore(container, placeholder);
    else container.remove();
    placeholder?.remove();
    state.context?.remove();
    state.context = null;
    state.placeholder = null;
    state.parent = null;
    if (!state.hadClass) container.classList.remove(MAP_CLASS);
    if (state.style === null) container.removeAttribute('style');
    else container.setAttribute('style', state.style);
    state.style = null;
    unlockPage(state);
    updateButton(state);
    if (!state.disposed && restore) refresh(state);
    if (state.nativeResizePaused && !state.disposed && restore) {
      window.L.DomEvent.on(window, 'resize', state.map._onResize, state.map);
    }
    state.nativeResizePaused = false;
    const focus = state.button.isConnected ? state.button : state.previousFocus;
    if (focus?.isConnected && typeof focus.focus === 'function') focus.focus({ preventScroll: true });
    state.previousFocus = null;
    return true;
  }

  function dispose(state, fromControl = false, unloaded = false) {
    if (state.disposed) return;
    if (!unloaded) exit(state);
    state.disposed = true;
    if (unloaded) exit(state);
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    state.frame = null;
    state.observer?.disconnect();
    state.resizeObserver?.disconnect();
    window.removeEventListener('resize', state.onResize);
    window.visualViewport?.removeEventListener('resize', state.onResize);
    window.removeEventListener('keydown', state.onEscape, true);
    state.map.off('unload', state.onUnload);
    state.button.removeEventListener('click', state.onClick);
    if (!fromControl) state.control.remove();
    states.delete(state.map);
  }

  function install(map) {
    const existing = states.get(map);
    if (existing) return existing.controller;
    if (!window.L || !map || typeof map.getContainer !== 'function') {
      throw new TypeError('BusPulseMapFullscreen.install requires a Leaflet map');
    }
    const state = { map, container: map.getContainer(), fullscreen: false, disposed: false, frame: null };
    const control = state.control = window.L.control({ position: 'topleft' });
    state.onClick = () => state.fullscreen ? exit(state) : enter(state);
    state.onResize = () => refresh(state);
    state.onUnload = () => dispose(state, false, true);
    state.onEscape = event => {
      if (active !== state || !state.fullscreen || (event.key !== 'Escape' && event.key !== 'Esc')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      exit(state);
    };
    control.onAdd = () => {
      const root = window.L.DomUtil.create('div', 'leaflet-bar buspulse-map-fullscreen-control');
      const button = state.button = document.createElement('button');
      button.type = 'button';
      button.className = 'buspulse-map-fullscreen-toggle';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      state.path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      svg.appendChild(state.path);
      button.appendChild(svg);
      root.appendChild(button);
      button.addEventListener('click', state.onClick);
      window.L.DomEvent.disableClickPropagation(root);
      window.L.DomEvent.disableScrollPropagation(root);
      updateButton(state);
      return root;
    };
    control.onRemove = () => dispose(state, true);
    state.controller = Object.freeze({
      enter: () => enter(state),
      exit: () => exit(state),
      toggle: () => state.fullscreen ? exit(state) : enter(state),
      dispose: () => dispose(state),
      get isFullscreen() { return state.fullscreen; },
      get disposed() { return state.disposed; },
      control
    });
    states.set(map, state);
    control.addTo(map);
    map.on('unload', state.onUnload);
    window.addEventListener('resize', state.onResize);
    window.visualViewport?.addEventListener('resize', state.onResize);
    if (typeof ResizeObserver !== 'undefined') {
      state.resizeObserver = new ResizeObserver(() => resize(state));
      state.resizeObserver.observe(state.container);
    }
    state.observer = new MutationObserver(() => {
      if (!state.container.isConnected || (state.fullscreen && (!state.placeholder?.isConnected
        || state.placeholder.parentNode !== state.parent))) dispose(state);
    });
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
    return state.controller;
  }

  window.BusPulseMapFullscreen = Object.freeze({ install });
})();
