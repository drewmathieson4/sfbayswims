// When a person last touched the app (keys or pointer) — the kiosk's idle cursor and its drift back to now read it.
let lastInputAt = performance.now();
export const noteInput = () => { lastInputAt = performance.now(); };
export const idleSeconds = () => (performance.now() - lastInputAt) / 1000;
