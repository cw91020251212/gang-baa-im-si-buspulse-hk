// Bridge tests deliberately stub Cesium, not Leaflet. This does NOT validate
// textured LandsD assets, SDK rendering or real 3D tile model quality.
const R = 6378137;
const rad = degrees => degrees * Math.PI / 180;
const degrees = radians => radians * 180 / Math.PI;
const metrics = window.__sceneMock = {
  sdkLoads: 0, created: 0, destroyed: 0, disposedScenes: 0, renderRequests: 0,
  pickEllipsoidCalls: 0, viewers: [], aborts: 0, handlers: [], destroyedHandlers: 0
};
class Event {
  listeners = new Set();
  addEventListener(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  raiseEvent(...args) { [...this.listeners].forEach(fn => fn(...args)); }
}
class Cartesian3 {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  static fromDegrees(lng, lat, altitude = 0) {
    const radius = R + altitude, phi = rad(lat), lambda = rad(lng);
    return new Cartesian3(radius * Math.cos(phi) * Math.cos(lambda), radius * Math.cos(phi) * Math.sin(lambda), radius * Math.sin(phi));
  }
  static fromDegreesArray(values) {
    const points = [];
    for (let i = 0; i < values.length; i += 2) points.push(Cartesian3.fromDegrees(values[i], values[i + 1]));
    return points;
  }
  static distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
  static subtract(a, b, target) { return Object.assign(target, { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }); }
  static dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
}
class Cartesian2 { constructor(x, y) { Object.assign(this, { x, y }); } }
class ScreenSpaceEventHandler {
  constructor(canvas) { this.canvas = canvas; this.actions = new Map(); this.destroyed = false; metrics.handlers.push(this); }
  setInputAction(callback, type) { this.actions.set(type, callback); }
  trigger(type, movement) { this.actions.get(type)?.(movement); }
  destroy() { if (!this.destroyed) metrics.destroyedHandlers++; this.destroyed = true; this.actions.clear(); }
}
const Cartographic = {
  fromCartesian(point) {
    return { longitude: Math.atan2(point.y, point.x), latitude: Math.atan2(point.z, Math.hypot(point.x, point.y)), height: Math.hypot(point.x, point.y, point.z) - R };
  }
};
class Viewer {
  constructor(host, options) {
    if (window.__mockScenario === 'gpu-error') throw new Error('fixture GPU failure');
    metrics.created++;
    metrics.viewers.push(this);
    this.options = options;
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'width:100%;height:100%;display:block';
    host.appendChild(this.canvas);
    this.destroyed = false;
    const viewer = this;
    this.camera = {
      changed: new Event(), moveEnd: new Event(), heading: 0,
      frustum: { fovy: 2 * Math.atan(1 / 3) },
      positionWC: Cartesian3.fromDegrees(114.17, 22.3, 1000),
      setView({ destination, orientation }) {
        this.positionWC = destination;
        this.lastView = { destination, orientation };
        const ll = Cartographic.fromCartesian(destination);
        this.centre = { lat: degrees(ll.latitude), lng: degrees(ll.longitude) };
        const ground = Cartesian3.fromDegrees(this.centre.lng, this.centre.lat);
        const d = Cartesian3.subtract(ground, destination, new Cartesian3());
        const length = Math.hypot(d.x, d.y, d.z);
        this.directionWC = new Cartesian3(d.x / length, d.y / length, d.z / length);
        this.changed.raiseEvent();
      },
      lookAt(target, offset) {
        const ll = Cartographic.fromCartesian(target);
        const up = new Cartesian3(target.x / R, target.y / R, target.z / R);
        const south = new Cartesian3(Math.sin(ll.latitude) * Math.cos(ll.longitude), Math.sin(ll.latitude) * Math.sin(ll.longitude), -Math.cos(ll.latitude));
        const rise = -offset.range * Math.sin(offset.pitch), back = offset.range * Math.cos(offset.pitch);
        this.positionWC = new Cartesian3(target.x + up.x * rise + south.x * back, target.y + up.y * rise + south.y * back, target.z + up.z * rise + south.z * back);
        this.centre = { lat: degrees(ll.latitude), lng: degrees(ll.longitude) };
        this.directionWC = new Cartesian3((target.x - this.positionWC.x) / offset.range, (target.y - this.positionWC.y) / offset.range, (target.z - this.positionWC.z) / offset.range);
        this.heading = offset.heading;
        this.lastLookAt = { target, offset };
        this.changed.raiseEvent();
      },
      lookAtTransform() {},
      pickEllipsoid(point, ellipsoid) {
        metrics.pickEllipsoidCalls++;
        this.lastPick = { point, ellipsoid };
        return Cartesian3.fromDegrees(this.centre.lng, this.centre.lat);
      }
    };
    this.scene = {
      camera: this.camera, canvas: this.canvas,
      postRender: new Event(), renderError: new Event(), screenSpaceCameraController: {},
      globe: { pick() { throw new Error('Bridge must not pick textured geometry'); } },
      requestRender() {
        metrics.renderRequests++;
        queueMicrotask(() => { if (!viewer.destroyed) viewer.scene.postRender.raiseEvent(viewer.scene); });
      }
    };
    this.entities = {
      values: [],
      add(value) { this.values.push(value); return value; },
      remove(value) { const i = this.values.indexOf(value); if (i >= 0) this.values.splice(i, 1); }
    };
  }
  resize() {}
  isDestroyed() { return this.destroyed; }
  destroy() { if (!this.destroyed) metrics.destroyed++; this.destroyed = true; this.host.replaceChildren(); }
}
const C = {
  Viewer, Cartesian2, Cartesian3, Cartographic, ScreenSpaceEventHandler,
  ScreenSpaceEventType: { LEFT_CLICK: 'LEFT_CLICK' }, Ellipsoid: { WGS84: {} },
  HeadingPitchRange: class { constructor(heading, pitch, range) { Object.assign(this, { heading, pitch, range }); } },
  Matrix4: { IDENTITY: {} },
  Math: { toDegrees: degrees }, EllipsoidTerrainProvider: class {},
  Color: { fromCssColorString(color) { return { withAlpha(alpha) { return { color, alpha }; } }; } },
  SceneTransforms: {
    worldToWindowCoordinates(scene, point) {
      const ll = Cartographic.fromCartesian(point);
      const camera = scene.camera;
      const range = Cartographic.fromCartesian(camera.positionWC).height;
      const mpp = range * 2 * Math.tan(camera.frustum.fovy / 2) / scene.canvas.clientHeight;
      return { x: scene.canvas.clientWidth / 2 + rad(degrees(ll.longitude) - camera.centre.lng) * R * Math.cos(rad(camera.centre.lat)) / mpp,
        y: scene.canvas.clientHeight / 2 - rad(degrees(ll.latitude) - camera.centre.lat) * R / mpp };
    }
  }
};
export async function loadCesium() {
  metrics.sdkLoads++;
  if (window.__mockScenario === 'slow-sdk') await new Promise(resolve => setTimeout(resolve, 250));
  if (window.__mockScenario === 'sdk-error') throw new Error('fixture SDK load failure');
  window.Cesium = C;
  return C;
}
export function getLandsD3DConfig() {
  return { kind: '3dtiles', urls: ['https://data.map.gov.hk/api/3d-data/3dtiles/f2/tileset.json'], attribution: 'Lands Department' };
}
export async function attachLandsDScene(_C, _viewer, _config, onState, signal) {
  let disposed = false;
  const release = () => { if (!disposed) metrics.disposedScenes++; disposed = true; };
  signal.addEventListener('abort', () => { metrics.aborts++; release(); }, { once: true });
  onState({ phase: 'loading', pending: 1 });
  if (window.__mockScenario === 'slow-scene') await new Promise(resolve => setTimeout(resolve, 250));
  if (!signal.aborted) {
    onState({ phase: 'preview', pending: 1 });
    onState({ phase: 'refining', pending: 1 });
    onState({ phase: window.__mockScenario === 'model-error' ? 'error' : 'ready', pending: 0 });
  }
  return release;
}
export function zoomToRange(zoom, latitude, canvasHeight, fovy = 2 * Math.atan(1 / 3)) {
  return 2 * Math.PI * R * Math.cos(rad(latitude)) / (256 * 2 ** zoom) * canvasHeight / (2 * Math.tan(fovy / 2));
}
export function rangeToZoom(range, latitude, canvasHeight, fovy = 2 * Math.atan(1 / 3)) {
  return Math.log2(2 * Math.PI * R * Math.cos(rad(latitude)) * canvasHeight / (256 * range * 2 * Math.tan(fovy / 2)));
}
