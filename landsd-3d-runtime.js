// Adapted from ParkPulse c660f16: verified official model loading and cancellable retries.
import { sceneQuality } from './scene3d.js';
export const CESIUM_VERSION = '1.147.0';
/** Official published 3D Tiles endpoint; no website-internal credentials. */
export const LANDSD_PHOTOREAL_URL = 'https://data.map.gov.hk/api/3d-data/3dtiles/f2/tileset.json';
export const LANDSD_3D_ATTRIBUTION = '© HKSAR Government, Lands Department';
let sdkPromise;
/** Optional owner-supplied configuration; public official data is the default. */
export function getLandsD3DConfig(env = globalThis.BusPulse3DConfig ?? {}) {
    const urls = (env.VITE_LANDSD_3D_URL || LANDSD_PHOTOREAL_URL).split(';').map(url => url.trim()).filter(Boolean);
    if (!urls.length || urls.some(value => { try {
        const url = new URL(value);
        return url.protocol !== 'https:' || !!url.username || !!url.password;
    }
    catch {
        return true;
    } }))
        return null;
    return { kind: '3dtiles', urls, apiKey: env.VITE_LANDSD_3D_API_KEY || undefined, attribution: LANDSD_3D_ATTRIBUTION };
}
/** Standalone, versioned workers avoid bundler worker/base-path incompatibility. */
export function loadCesium() {
    const global = window;
    if (global.Cesium)
        return Promise.resolve(global.Cesium);
    if (sdkPromise)
        return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
        const base = new URL(`vendor/cesium/${CESIUM_VERSION}/`, import.meta.url).href;
        global.CESIUM_BASE_URL = base;
        if (!document.querySelector('link[data-buspulse-cesium]')) {
            const style = document.createElement('link');
            style.rel = 'stylesheet';
            style.href = `${base}Widgets/widgets.css`;
            style.dataset.buspulseCesium = 'true';
            document.head.append(style);
        }
        const script = document.createElement('script');
        script.src = `${base}Cesium.js`;
        script.async = true;
        const timeout = window.setTimeout(() => fail(new Error('3D SDK loading timed out')), 30_000);
        const fail = (error) => { window.clearTimeout(timeout); script.remove(); reject(error); };
        script.onload = () => { window.clearTimeout(timeout); global.Cesium ? resolve(global.Cesium) : fail(new Error('3D SDK did not initialize')); };
        script.onerror = () => fail(new Error('3D SDK could not be loaded'));
        document.head.append(script);
    }).catch(error => { sdkPromise = undefined; throw error; });
    return sdkPromise;
}
/** Current-view meshes refine automatically, including already-cached detail. */
export async function attachLandsDScene(C, viewer, config, onState, signal) {
    const hardware = navigator;
    const quality = sceneQuality(hardware.deviceMemory, hardware.hardwareConcurrency);
    const models = [];
    const cleanup = [];
    const timers = new Set();
    const retryDelays = new Map();
    // 0=no mesh, 1=quick preview, 2=intermediate, 3=fine, 4=settled.
    const state = new Map();
    let active = true;
    let renderedFrames = 0;
    let firstVisible = false;
    let lastLoadRender = 0;
    let watchdog;
    let reported = '';
    const alive = () => active && !signal.aborted && !viewer.isDestroyed();
    const emit = (value) => {
        if (!alive())
            return;
        const key = `${value.phase}:${value.pending}`;
        if (key === reported)
            return;
        reported = key;
        onState(value);
    };
    const report = () => {
        const values = [...state.values()];
        const pending = values.reduce((sum, value) => sum + value.pending, 0);
        const phase = values.length === 0 ? 'loading' : values.every(value => value.stage === 4 && value.pending === 0) ? 'ready'
            : values.some(value => value.stage >= 2) || (firstVisible && pending > 0) ? 'refining' : firstVisible ? 'preview' : 'loading';
        emit({ phase, pending });
    };
    const dispose = () => {
        if (!active)
            return;
        active = false;
        signal.removeEventListener('abort', dispose);
        for (const timer of timers)
            window.clearTimeout(timer);
        timers.clear();
        for (const [timer, resolve] of retryDelays) {
            window.clearTimeout(timer);
            resolve(false);
        }
        retryDelays.clear();
        cleanup.forEach(remove => remove());
        for (const model of models) {
            if (model.isDestroyed())
                continue;
            if (!viewer.isDestroyed() && viewer.scene.primitives.contains(model))
                viewer.scene.primitives.remove(model);
            else
                model.destroy();
        }
    };
    if (signal.aborted)
        return dispose;
    signal.addEventListener('abort', dispose, { once: true });
    for (const key of new Set(config.urls.map(url => { const target = new URL(url); return `${target.hostname}:${target.port || '443'}`; }))) {
        const previous = C.RequestScheduler.requestsByServer[key];
        C.RequestScheduler.requestsByServer[key] = Math.min(typeof previous === 'number' ? previous : 6, 6);
        cleanup.push(() => { if (previous === undefined)
            delete C.RequestScheduler.requestsByServer[key];
        else
            C.RequestScheduler.requestsByServer[key] = previous; });
    }
    emit({ phase: 'loading', pending: 0 });
    // Metadata may succeed while indispensable child meshes/decoders fail.
    watchdog = window.setTimeout(() => {
        if (!alive() || firstVisible)
            return;
        // Isolated detail failures after a usable preview never trigger this fallback.
        emit({ phase: 'error', pending: 0 });
        dispose();
    }, 120_000);
    timers.add(watchdog);
    // Deferred/throttled requests need real frame numbers, not only idle checks.
    // A rate-limited warmup stops as soon as the visible scene has settled.
    cleanup.push(viewer.scene.postUpdate.addEventListener(() => {
        if (!alive() || ![...state].some(([model, current]) => !model.tilesLoaded || current.stage === 2 || current.stage === 3))
            return;
        const now = performance.now();
        if (now - lastLoadRender < 100)
            return;
        lastLoadRender = now;
        viewer.scene.requestRender();
    }));
    // allTilesLoaded is not guaranteed to fire when the next quality uses cached tiles.
    cleanup.push(viewer.scene.postRender.addEventListener(() => {
        if (!alive())
            return;
        renderedFrames++;
        for (const [model, current] of state) {
            if (current.stage < 2 || current.stage === 4 || !model.tilesLoaded || renderedFrames <= current.appliedFrame)
                continue;
            if (current.stage === 2) {
                current.stage = 3;
                current.appliedFrame = renderedFrames;
                model.maximumScreenSpaceError = quality.finalError;
                viewer.scene.requestRender();
            }
            else if (current.stage === 3)
                current.stage = 4;
        }
        report();
    }));
    try {
        await Promise.all(config.urls.map(async (url) => {
            // Resource derivation preserves this owner's optional query key for child tiles.
            const resource = new C.Resource({
                url, queryParameters: config.apiKey ? { key: config.apiKey } : undefined,
                retryAttempts: 2,
                retryCallback: (_resource, error) => {
                    if (!alive() || [400, 401, 403, 404, 405, 410].includes(error?.statusCode ?? 0))
                        return false;
                    return new Promise(resolve => {
                        const timer = window.setTimeout(() => { retryDelays.delete(timer); resolve(alive()); }, 750);
                        retryDelays.set(timer, resolve);
                    });
                },
            });
            const model = await C.Cesium3DTileset.fromUrl(resource, {
                maximumScreenSpaceError: quality.previewError,
                cacheBytes: quality.cacheBytes, maximumCacheOverflowBytes: quality.cacheBytes,
                progressiveResolutionHeightFraction: 0.3, preloadFlightDestinations: true,
                cullRequestsWhileMoving: true, dynamicScreenSpaceError: true,
            });
            if (!alive()) {
                model.destroy();
                return;
            }
            models.push(model);
            const current = { stage: 0, pending: 0, appliedFrame: renderedFrames };
            state.set(model, current);
            cleanup.push(model.tileVisible.addEventListener(tile => {
                if (!alive() || current.stage !== 0)
                    return;
                const content = tile.content;
                if (!content || !(content.geometryByteLength > 0 || content.trianglesLength > 0 || content.pointsLength > 0))
                    return;
                firstVisible = true;
                if (watchdog !== undefined) {
                    window.clearTimeout(watchdog);
                    timers.delete(watchdog);
                    watchdog = undefined;
                }
                current.stage = 1;
                report();
                const timer = window.setTimeout(() => {
                    timers.delete(timer);
                    if (!alive())
                        return;
                    current.stage = 2;
                    current.appliedFrame = renderedFrames;
                    model.maximumScreenSpaceError = quality.intermediateError;
                    viewer.scene.requestRender();
                    report();
                }, 500);
                timers.add(timer);
                // Do not gate the centre's finest detail on distant intermediate tiles.
                const fineTimer = window.setTimeout(() => {
                    timers.delete(fineTimer);
                    if (!alive() || current.stage >= 3)
                        return;
                    current.stage = 3;
                    current.appliedFrame = renderedFrames;
                    model.maximumScreenSpaceError = quality.finalError;
                    viewer.scene.requestRender();
                    report();
                }, 1_250);
                timers.add(fineTimer);
            }));
            cleanup.push(model.tileFailed.addEventListener(() => {
                if (alive() && !firstVisible)
                    viewer.scene.requestRender();
            }));
            cleanup.push(model.loadProgress.addEventListener((requests, processing) => {
                current.pending = requests + processing;
                report();
            }));
            viewer.scene.primitives.add(model);
            viewer.scene.requestRender();
        }));
        report();
        return dispose;
    }
    catch (error) {
        emit({ phase: 'error', pending: 0 });
        dispose();
        throw error;
    }
}

export { zoomToRange, rangeToZoom } from './scene3d.js';
