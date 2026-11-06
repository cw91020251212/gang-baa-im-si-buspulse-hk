// Shared ParkPulse ground-scale and bounded model detail policy.
const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6_378_137;
const DEFAULT_FOVY = 2 * Math.atan(1 / 3);
const clampZoom = (zoom) => Math.max(8, Math.min(22, Number.isFinite(zoom) ? zoom : 14));
/** Match the same ground scale without rounding fractional Leaflet zooms. */
export function zoomToRange(zoom, latitude, canvasHeight, fovy = DEFAULT_FOVY) {
    const metresPerPixel = EARTH_CIRCUMFERENCE * Math.cos(latitude * Math.PI / 180) / (256 * 2 ** clampZoom(zoom));
    return metresPerPixel * Math.max(1, canvasHeight) / (2 * Math.tan(fovy / 2));
}
export function rangeToZoom(range, latitude, canvasHeight, fovy = DEFAULT_FOVY) {
    const metresPerPixel = Math.max(0.001, range) * 2 * Math.tan(fovy / 2) / Math.max(1, canvasHeight);
    return clampZoom(Math.log2(EARTH_CIRCUMFERENCE * Math.cos(latitude * Math.PI / 180) / (256 * metresPerPixel)));
}
/** Fine visible-region meshes after the initial quick layer; bounded GPU cache. */
export function sceneQuality(deviceMemory, hardwareConcurrency) {
    const constrained = (deviceMemory !== undefined && deviceMemory <= 4)
        || (hardwareConcurrency !== undefined && hardwareConcurrency <= 4);
    return { previewError: 16, intermediateError: constrained ? 12 : 8, finalError: constrained ? 8 : 4,
        cacheBytes: (constrained ? 128 : 256) * 1024 * 1024 };
}
