import { test, expect } from '@playwright/test';

const item = { co:'KMB', route:'74X', bound:'outbound', dir:'O', service_type:'1', seq:1, stopId:'alarm-stop', stopName:'第一站', dest:'大埔中心' };
const id = 'KMB|74X|O|alarm-stop';

async function prepare(page, enabled = true) {
  await page.addInitScript(({ item, id, enabled }) => {
    if (!localStorage.getItem('test.alarm.initialized')) {
      localStorage.setItem('busboard.items.v1', JSON.stringify([item]));
      localStorage.setItem('busboard.user-defaults.v1', '[]');
      localStorage.setItem('busboard.alarms.v1', JSON.stringify({ [id]:enabled }));
      localStorage.setItem('busboard.alarm-sessions.v1', JSON.stringify(enabled === true ? { [id]:'test-session' } : {}));
      localStorage.setItem('busboard.preferences.v1', JSON.stringify({ webSound:true, notificationsEnabled:true, screenSaverIdle:0 }));
      localStorage.setItem('test.alarm.initialized', '1');
    }
    window.__alarm = { sounds:0, stopped:0, notifications:[], scheduled:[], vibration:[], closed:0 };
    window.confirm = () => true;
    window.alert = () => {};
    class FakeAudioContext {
      state = 'running'; currentTime = 0; destination = {};
      async resume() { this.state = 'running'; }
      createOscillator() { return { frequency:{ value:0 }, connect(){ return this; }, start(){ window.__alarm.sounds++; }, stop(){ window.__alarm.stopped++; } }; }
      createGain() { return { gain:{ setValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){ return this; } }; }
    }
    window.AudioContext = FakeAudioContext;
    window.Notification = class {
      static permission = 'granted';
      static async requestPermission() { return 'granted'; }
      constructor(title, options) { window.__alarm.notifications.push({ title, options }); }
      close() { window.__alarm.closed++; }
    };
    Object.defineProperty(navigator, 'vibrate', { configurable:true, value:value => { window.__alarm.vibration.push(value); return true; } });
    window.__registration = {
      async getNotifications() { return window.__alarm.scheduled.map(n => ({ tag:n.options.tag, data:n.options.data, close(){ window.__alarm.closed++; } })); },
      async showNotification(title, options) { window.__alarm.scheduled.push({ title, options }); }
    };
    if (!localStorage.getItem('test.alarm.real-worker')) Object.defineProperty(navigator, 'serviceWorker', { configurable:true, value:{
      async getRegistration(){ return window.__registration; },
      async register(){ return window.__registration; },
      addEventListener(){}, ready:Promise.resolve(window.__registration)
    } });
  }, { item, id, enabled });
  await page.route(/https:\/\/[^/]*(?:gov\.hk|kmb\.hk)\//, route => route.abort());
  await page.goto('./?smoke=alarm-authorization', { waitUntil:'domcontentloaded' });
  await expect(page.locator('[data-alarm-id]')).toBeVisible();
  await page.evaluate(() => stopLoop());
}

test('off means no audio, notification, vibration or local schedule even with due ETA', async ({ page }) => {
  await prepare(page, false);
  const result = await page.evaluate(async () => {
    const it = items[0], id = uid(it), at = Date.now() + 60000;
    window.TimestampTrigger = class { constructor(at) { this.at = at; } };
    const eta = { iso:new Date(at).toISOString(), min:1 };
    checkAlarms(it, { etas:[eta] });
    scheduleAlarmFallbacks(it, { etas:[eta] });
    await notifyArrival(it, 1, 'off-trip');
    await ringBell({ alarmAuthorized:true }); // A bare boolean is not permission.
    await scheduleNativeLocalAlarm(it, { at, key:String(at) });
    return window.__alarm;
  });
  expect(result.sounds).toBe(0);
  expect(result.notifications).toHaveLength(0);
  expect(result.scheduled).toHaveLength(0);
  expect(result.vibration.filter(value => value !== 0)).toHaveLength(0);
});

test('switching off while audio unlock is pending prevents late oscillator creation', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const id = uid(items[0]);
    const ctx = await unlockAudio();
    let resolve;
    unlockAudio = () => new Promise(r => { resolve = r; });
    const pending = ringBell({ alarmAuthorized:true, alarmId:id, session:alarmSessions[id] });
    await toggleAlarm(id, board.querySelector('[data-alarm-id]'));
    resolve(ctx);
    await pending;
    return window.__alarm.sounds;
  });
  expect(result).toBe(0);
});

test('local notification scheduling rechecks the switch after registration resolves', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const it = items[0], id = uid(it), at = Date.now() + 60000;
    window.TimestampTrigger = class {};
    let resolve;
    notificationRegistration = () => new Promise(r => { resolve = r; });
    const pending = scheduleNativeLocalAlarm(it, { at, key:String(at), session:alarmSessions[id] });
    await toggleAlarm(id, board.querySelector('[data-alarm-id]'));
    resolve(window.__registration);
    await pending;
    return window.__alarm.scheduled;
  });
  expect(result).toHaveLength(0);
});

test('bell stays on during its authorized alert and clicking off stops the sound', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async () => { await notifyArrival(items[0], 1, 'one-trip'); });
  await expect(page.locator('[data-alarm-id]')).toHaveClass(/on/);
  expect(await page.evaluate(() => window.__alarm.sounds)).toBeGreaterThan(0);
  await page.locator('[data-alarm-id]').click({ force:true });
  await expect(page.locator('[data-alarm-id]')).not.toHaveClass(/on/);
  expect(await page.evaluate(() => activeSoundNodes.size)).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem(ALARM_KEY))[uid(items[0])])).toBe(false);
});

test('old session cannot sound after off and on, or after another tab saves off', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const it = items[0], id = uid(it), session = alarmSessions[id], button = board.querySelector('[data-alarm-id]');
    await toggleAlarm(id, button);
    await toggleAlarm(id, button);
    await ringBell({ alarmAuthorized:true, alarmId:id, session });
    localStorage.setItem(ALARM_KEY, JSON.stringify({ [id]:false }));
    await notifyArrival(it, 1, 'old-tab');
    return window.__alarm;
  });
  expect(result.sounds).toBe(0);
  expect(result.notifications).toHaveLength(0);
});

test('clear all cancels active sounds, sessions, plans and pending alerts', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const id = uid(items[0]);
    await ringBell({ alarmAuthorized:true, alarmId:id, session:alarmSessions[id] });
    clearAllArrivalAlarms();
    return { nodes:activeSoundNodes.size, sessions:alarmSessions, plans:alarmPlans, alerts:activeAlarmAlerts.size };
  });
  expect(result).toEqual({ nodes:0, sessions:{}, plans:{}, alerts:0 });
});

test('legacy false strings are not restored as enabled alarms', async ({ page }) => {
  await prepare(page, 'false');
  await expect(page.locator('[data-alarm-id]')).not.toHaveClass(/on/);
  await page.evaluate(async () => { await notifyArrival(items[0], 1, 'invalid-flag'); });
  expect(await page.evaluate(() => window.__alarm.notifications)).toHaveLength(0);
});

test('a delivered alert auto-disarms once after sounding and cannot fire the next bus', async ({ page }) => {
  await page.clock.install();
  await prepare(page);
  await page.evaluate(async () => {
    await notifyArrival(items[0], 1, 'trip-a');
    await notifyArrival(items[0], 1, 'duplicate-trip-a');
  });
  expect(await page.evaluate(() => window.__alarm.notifications.length)).toBe(1);
  await page.clock.runFor(12100);
  await expect(page.locator('[data-alarm-id]')).not.toHaveClass(/on/);
  await page.evaluate(async () => { await notifyArrival(items[0], 1, 'trip-b'); });
  expect(await page.evaluate(() => window.__alarm.notifications.length)).toBe(1);
  expect(await page.evaluate(() => activeSoundNodes.size)).toBe(0);
});

test('switching off while background notification lookup waits blocks every fallback', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    prefs.webSound = false;
    Object.defineProperty(document, 'hidden', { configurable:true, value:true });
    let resolve, started;
    const ready = new Promise(r => { started = r; });
    notificationRegistration = () => new Promise(r => { resolve = r; started(); });
    const pending = notifyArrival(items[0], 1, 'slow-registration');
    await ready;
    await toggleAlarm(uid(items[0]), board.querySelector('[data-alarm-id]'));
    resolve(window.__registration);
    await pending;
    return window.__alarm;
  });
  expect(result.notifications).toHaveLength(0);
  expect(result.scheduled).toHaveLength(0);
});

test('an in-flight scheduled notification is closed if disabled while showNotification waits', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const it = items[0], id = uid(it), at = Date.now() + 60000;
    window.TimestampTrigger = class {};
    let resolve, started;
    const ready = new Promise(r => { started = r; });
    window.__registration.showNotification = async (title, options) => {
      await new Promise(r => { resolve = r; started(); });
      window.__alarm.scheduled.push({ title, options });
    };
    const pending = scheduleNativeLocalAlarm(it, { at, key:String(at), session:alarmSessions[id] });
    await ready;
    await toggleAlarm(id, board.querySelector('[data-alarm-id]'));
    resolve();
    const delivered = await pending;
    return { delivered, closed:window.__alarm.closed, scheduledKeys:localAlarmScheduled.size };
  });
  expect(result.delivered).toBe(false);
  expect(result.closed).toBeGreaterThan(0);
  expect(result.scheduledKeys).toBe(0);
});

test('appearance changes and shell re-renders do not enable or sound a disabled alarm', async ({ page }) => {
  await prepare(page, false);
  const result = await page.evaluate(async () => {
    const it = items[0], id = uid(it), at = Date.now() + 60000;
    prefs.theme = 'light'; prefs.font = 'large'; savePrefs(); applyPrefs(); shell();
    prefs.theme = 'dark'; savePrefs(); applyPrefs(); shell();
    checkAlarms(it, { etas:[{ iso:new Date(at).toISOString(), min:1 }] });
    await notifyArrival(it, 1, 'after-ui-change');
    return { enabled:JSON.parse(localStorage.getItem(ALARM_KEY))[id], sounds:window.__alarm.sounds, notifications:window.__alarm.notifications.length };
  });
  expect(result).toEqual({ enabled:false, sounds:0, notifications:0 });
  await expect(page.locator('[data-alarm-id]')).toHaveAttribute('aria-pressed', 'false');
});

test('retired plans cannot run after re-enabling the same route', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const it = items[0], id = uid(it), button = board.querySelector('[data-alarm-id]');
    const at = Date.now() + 60000;
    const plan = { key:String(at), at, iso:new Date(at).toISOString(), session:alarmSessions[id] };
    await toggleAlarm(id, button); await toggleAlarm(id, button);
    runAlarmPlan(it, plan);
    return window.__alarm;
  });
  expect(result.sounds).toBe(0);
  expect(result.notifications).toHaveLength(0);
});

test('explicit sound preview still works with route alarms off', async ({ page }) => {
  await prepare(page, false);
  expect(await page.evaluate(() => ringBell({ userInitiated:true }))).toBe(true);
  expect(await page.evaluate(() => window.__alarm.sounds)).toBeGreaterThan(0);
});

test('shared-storage off event immediately silences an already active alert', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const id = uid(items[0]);
    await notifyArrival(items[0], 1, 'other-tab-off');
    localStorage.setItem(ALARM_KEY, JSON.stringify({ [id]:false }));
    localStorage.setItem(ALARM_SESSION_KEY, '{}');
    window.dispatchEvent(new StorageEvent('storage', { key:ALARM_KEY }));
    return { nodes:activeSoundNodes.size, alerts:activeAlarmAlerts.size, enabled:alarms[id] };
  });
  expect(result).toEqual({ nodes:0, alerts:0, enabled:false });
  await expect(page.locator('[data-alarm-id]')).not.toHaveClass(/on/);
});

test('manual off and on settings survive reload without changing the alarm session', async ({ page }) => {
  await prepare(page);
  const session = await page.evaluate(() => alarmSessions[uid(items[0])]);
  await page.reload({ waitUntil:'domcontentloaded' });
  await expect(page.locator('[data-alarm-id]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => alarmSessions[uid(items[0])])).toBe(session);
  await page.locator('[data-alarm-id]').click();
  await page.reload({ waitUntil:'domcontentloaded' });
  await expect(page.locator('[data-alarm-id]')).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => alarmSessions[uid(items[0])] || null)).toBeNull();
  expect(await page.evaluate(() => window.__alarm.sounds)).toBe(0);
});

test('real service worker handshake allows the enabled bell and rejects it after off', async ({ page, context }) => {
  await prepare(page);
  await page.evaluate(() => localStorage.setItem('test.alarm.real-worker', '1'));
  const workerReady = context.waitForEvent('serviceworker');
  await page.reload({ waitUntil:'load' });
  const worker = await workerReady;
  await page.evaluate(async () => { await navigator.serviceWorker.ready; stopLoop(); });
  await worker.evaluate(() => {
    self.__delivered = [];
    self.registration.showNotification = async (title, options) => { self.__delivered.push({ title, options }); };
  });
  const result = await page.evaluate(async () => {
    Object.defineProperty(document, 'hidden', { configurable:true, value:true });
    prefs.webSound = false;
    const it = items[0], id = uid(it), session = alarmSessions[id];
    const delivered = await notifyArrival(it, 1, 'real-worker');
    await toggleAlarm(id, board.querySelector('[data-alarm-id]'));
    const registration = await navigator.serviceWorker.ready;
    const staleResult = await new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = e => { channel.port1.close(); resolve(e.data); };
      registration.active.postMessage({ type:'BUS_ARRIVAL_AUTHORIZED', alarmId:id, session, title:'must not sound' }, [channel.port2]);
    });
    return { delivered, staleResult };
  });
  expect(result).toEqual({ delivered:true, staleResult:{ delivered:false } });
  expect(await worker.evaluate(() => self.__delivered.length)).toBe(1);
});

test('deleting a route cancels its active sound and stored authority', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async () => { await notifyArrival(items[0], 1, 'delete-route'); });
  await page.locator('#fab').click({ force:true });
  await expect(page.locator('[data-del]')).toBeInViewport();
  await page.locator('[data-del]').click();
  const state = await page.evaluate(() => ({ items:items.length, sessions:alarmSessions, sounds:activeSoundNodes.size, alerts:activeAlarmAlerts.size }));
  expect(state).toEqual({ items:0, sessions:{}, sounds:0, alerts:0 });
});
