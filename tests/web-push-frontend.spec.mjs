import {test, expect} from '@playwright/test';

const item = {co:'KMB',route:'74X',dir:'O',service_type:'1',seq:1,stopId:'push-stop',stopName:'第一站',dest:'大埔中心'};
const id = 'KMB|74X|O|push-stop';
async function prepare(page, {enabled=false, existing=false, permission='granted'} = {}) {
  await page.addInitScript(({item,id,enabled,existing,permission}) => {
    localStorage.setItem('busboard.items.v1', JSON.stringify([item]));
    localStorage.setItem('busboard.user-defaults.v1','[]');
    localStorage.setItem('busboard.alarms.v1',JSON.stringify({[id]:enabled}));
    localStorage.setItem('busboard.alarm-sessions.v1',JSON.stringify(enabled ? {[id]:'existing-session'} : {}));
    localStorage.setItem('busboard.preferences.v1',JSON.stringify({notificationsEnabled:true,screenSaverIdle:0,webSound:true}));
    window.alert=()=>{};
    window.__push={posts:[],states:[],creates:[],keyCalls:0,audio:0,fail:false};
    window.AudioContext=class {constructor(){window.__push.audio++;}};
    window.Audio=class {constructor(){window.__push.audio++;}};
    window.Notification=class {static permission=permission;static async requestPermission(){return this.permission;}};
    Object.defineProperty(window,'PushManager',{configurable:true,value:class {}});
    const subscription={toJSON(){return {endpoint:'https://fcm.googleapis.com/fcm/send/mock',keys:{p256dh:'mock',auth:'mock'}};}};
    window.__push.subscription=existing ? subscription : null;
    const registration={
      active:{postMessage(data,ports){window.__push.states.push(data);if(data.type === 'SYNC_WEB_PUSH_STATE') setTimeout(()=>ports[0].postMessage({ok:true}),0);}},
      pushManager:{
        async getSubscription(){return window.__push.subscription;},
        async subscribe(options){window.__push.creates.push({userVisibleOnly:options.userVisibleOnly,keyLength:options.applicationServerKey.length});if(window.__subscribeGate) await window.__subscribeGate;return window.__push.subscription=subscription;}
      },
      async getNotifications(){return [];},async showNotification(){}
    };
    Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{async getRegistration(){return registration;},async register(){return registration;},ready:Promise.resolve(registration),addEventListener(){}}});
    const realFetch=window.fetch.bind(window);
    window.fetch=async (url,options={})=>{
      if(String(url).startsWith('https://gang-baa-im-si-buspulse-hk.buspulse-hk.workers.dev')) {
        if(String(url).endsWith('/vapid-public-key')) {
          window.__push.keyCalls++;
          return new Response(JSON.stringify({publicKey:btoa(String.fromCharCode(4,...Array(64).fill(1)))}),{status:200});
        }
        const body=JSON.parse(options.body);window.__push.posts.push(body);
        if(window.__postGate) await window.__postGate;
        return new Response(JSON.stringify(window.__push.fail ? {ok:false,error:'database_write_failed'} : {ok:true,registeredRoutes:body.routes.length}),{status:window.__push.fail ? 503 : 200});
      }
      return realFetch(url,options);
    };
  }, {item,id,enabled,existing,permission});
  await page.route(/https:\/\/[^/]*(?:gov\.hk|kmb\.hk)\//,route=>route.abort());
  await page.goto('./?smoke=web-push',{waitUntil:'load'});
  await page.evaluate(async()=>{stopLoop();clearTimeout(webPushSyncTimer);await syncWebPushWatches(false);});
}

test('boot never prompts, fetches a key or creates a subscription implicitly',async({page})=>{
  await prepare(page,{enabled:true});
  expect(await page.evaluate(()=>({creates:__push.creates,keyCalls:__push.keyCalls,posts:__push.posts}))).toEqual({creates:[],keyCalls:0,posts:[]});
  await expect(page.locator('.app-version')).toHaveText('V1.0');
});

test('explicit bell action creates standard PushManager subscription and syncs current route session without web audio',async({page})=>{
  await prepare(page);
  const result=await page.evaluate(async()=>{await toggleAlarm(uid(items[0]),null);return {creates:__push.creates,keyCalls:__push.keyCalls,last:__push.posts.at(-1),audio:__push.audio,state:webPushStatus};});
  expect(result.creates).toEqual([{userVisibleOnly:true,keyLength:65}]);
  expect(result.keyCalls).toBe(1);expect(result.audio).toBe(0);
  expect(result.last.routes).toHaveLength(1);
  expect(result.last.routes[0]).toMatchObject({id,co:'KMB',dir:'O',seq:1,leadMinutes:2});
  expect(result.last.routes[0].session).toBeTruthy();
  expect(result.state.state).toBe('registered');
});

test('turning off persists empty local consent and sends empty backend routes',async({page})=>{
  await prepare(page,{enabled:true,existing:true});
  const result=await page.evaluate(async()=>{deactivateAlarm(uid(items[0]));await syncWebPushWatches(false);return {last:__push.posts.at(-1),state:__push.states.at(-1)};});
  expect(result.last.routes).toEqual([]);expect(result.state.watches).toEqual([]);
});

test('off while browser subscribe waits cannot restore a stale backend watch',async({page})=>{
  await prepare(page,{enabled:true});
  await page.evaluate(()=>{window.__subscribeGate=new Promise(resolve=>window.__finishSubscribe=resolve);window.__pending=syncWebPushWatches(true);});
  await expect.poll(()=>page.evaluate(()=>__push.creates.length)).toBe(1);
  const result=await page.evaluate(async()=>{deactivateAlarm(uid(items[0]));window.__finishSubscribe();await window.__pending;await syncWebPushWatches(false);return {last:__push.posts.at(-1),state:__push.states.at(-1)};});
  expect(result.last.routes).toEqual([]);expect(result.state.watches).toEqual([]);
});

test('pause clears watches while resume reuses the subscription without custom sound',async({page})=>{
  await prepare(page,{enabled:true,existing:true});
  const result=await page.evaluate(async()=>{await toggleNotificationSetting();const paused=__push.posts.at(-1).routes;await toggleNotificationSetting();return {paused,last:__push.posts.at(-1).routes,creates:__push.creates,audio:__push.audio};});
  expect(result.paused).toEqual([]);expect(result.last).toHaveLength(1);expect(result.creates).toEqual([]);expect(result.audio).toBe(0);
});

test('revoked permission clears existing subscription watches without creating another subscription',async({page})=>{
  await prepare(page,{enabled:true,existing:true,permission:'denied'});
  const result=await page.evaluate(()=>({last:__push.posts.at(-1),state:__push.states.at(-1),creates:__push.creates}));
  expect(result.last.routes).toEqual([]);expect(result.state.enabled).toBe(false);expect(result.creates).toEqual([]);
});

test('backend failures are reported honestly rather than marked registered',async({page})=>{
  await prepare(page,{enabled:true,existing:true});
  const result=await page.evaluate(async()=>{__push.fail=true;const result=await syncWebPushWatches(false);return {result,status:webPushStatus};});
  expect(result.result).toEqual({ok:false,error:'database_write_failed'});expect(result.status.state).toBe('error');
});

test('serialized writes finish with latest off state when an earlier HTTP request is delayed',async({page})=>{
  await prepare(page,{enabled:true,existing:true});
  await page.evaluate(()=>{window.__postGate=new Promise(resolve=>window.__finishPost=resolve);window.__first=syncWebPushWatches(false);});
  await expect.poll(()=>page.evaluate(()=>__push.posts.length)).toBeGreaterThan(1);
  const result=await page.evaluate(async()=>{deactivateAlarm(uid(items[0]));window.__second=syncWebPushWatches(false);window.__postGate=null;window.__finishPost();await window.__first;await window.__second;return __push.posts.at(-1).routes;});
  expect(result).toEqual([]);
});

test('local consent is revoked before a delayed backend request finishes',async({page})=>{
  await prepare(page,{enabled:true,existing:true});
  await page.evaluate(()=>{window.__postGate=new Promise(resolve=>window.__finishPost=resolve);window.__pending=syncWebPushWatches(false);});
  await expect.poll(()=>page.evaluate(()=>__push.posts.length)).toBeGreaterThan(1);
  await page.evaluate(()=>deactivateAlarm(uid(items[0])));
  await expect.poll(()=>page.evaluate(()=>__push.states.at(-1).watches.length)).toBe(0);
  await page.evaluate(async()=>{window.__postGate=null;window.__finishPost();await window.__pending;await syncWebPushWatches(false);});
  expect(await page.evaluate(()=>__push.posts.at(-1).routes)).toEqual([]);
});

test('persisted off state prevents a stale in-memory route being re-registered',async({page})=>{
  await prepare(page,{enabled:true,existing:true});
  const routes=await page.evaluate(async()=>{localStorage.setItem(ALARM_KEY,'{}');await syncWebPushWatches(false);return __push.posts.at(-1).routes;});
  expect(routes).toEqual([]);
});

test('cross-tab notification pause updates local consent and backend watches',async({page})=>{
  await prepare(page,{enabled:true,existing:true});
  const result=await page.evaluate(async()=>{
    const next=JSON.stringify({...prefs,notificationsEnabled:false});
    localStorage.setItem(PREF_KEY,next);
    window.dispatchEvent(new StorageEvent('storage',{key:PREF_KEY,newValue:next}));
    await syncWebPushWatches(false);
    return {routes:__push.posts.at(-1).routes,state:__push.states.at(-1)};
  });
  expect(result.routes).toEqual([]);expect(result.state.enabled).toBe(false);
});

test('off/on creates a new authorized session without replacing the subscription',async({page})=>{
  await prepare(page,{enabled:true,existing:true});
  const result=await page.evaluate(async()=>{
    const before=alarmSessions[uid(items[0])];deactivateAlarm(uid(items[0]));await toggleAlarm(uid(items[0]),null);
    return {before,watch:__push.posts.at(-1).routes[0],state:__push.states.at(-1),creates:__push.creates};
  });
  expect(result.watch.session).not.toBe(result.before);
  expect(result.state.watches).toEqual([{id,session:result.watch.session}]);
  expect(result.creates).toEqual([]);
});
