import {test,expect} from '@playwright/test';
const item={co:'KMB',route:'74X',bound:'outbound',dir:'O',service_type:'1',seq:1,stopId:'s1',stopName:'上車站',origin:'起點',dest:'下車站'};
test.use({serviceWorkers:'block'});
async function prepare(page){
  await page.clock.install({time:new Date('2026-10-20T00:00:00Z')});
  await page.addInitScript(item=>{
    localStorage.clear();localStorage.setItem('buspulse.first-use-tour.v1','1');localStorage.setItem('busboard.items.v1',JSON.stringify([item]));localStorage.setItem('busboard.user-defaults.v1','[]');
    window.geoWatches=new Map();window.nextWatch=0;window.notifications=[];window.errors=[];
    addEventListener('error',e=>errors.push(e.message));
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{watchPosition(ok,error){const id=++nextWatch;geoWatches.set(id,{ok,error});return id;},clearWatch(id){geoWatches.delete(id);}}});
    class N {static permission='granted';constructor(title,options){notifications.push({title,options});}close(){}}
    window.Notification=N;
    window.emit=(latitude,longitude=114.2,accuracy=10)=>[...geoWatches.values()].forEach(w=>w.ok({coords:{latitude,longitude,accuracy,speed:null},timestamp:Date.now()}));
  },item);
  await page.route('**/v1/transport/kmb/route-stop/**',r=>r.fulfill({json:{data:[1,2,3,4].map(seq=>({seq,stop:'s'+seq}))}}));
  await page.route('**/v1/transport/kmb/stop',r=>r.fulfill({json:{data:[22.30,22.302,22.392,22.394].map((lat,i)=>({stop:'s'+(i+1),name_tc:['上車站','隧道前站','隧道後站','下車站'][i],name_en:'STOP '+(i+1),lat:String(lat),long:'114.2'}))}}));
  await page.route('**/v1/transport/kmb/route-eta/**',r=>r.fulfill({json:{data:[]}}));
  await page.route('**/search.kmb.hk/**',r=>r.fulfill({json:{result:false}}));
  await page.route('**/raw.githubusercontent.com/**',r=>r.fulfill({status:404,body:'fixture has no official geometry'}));
  await page.goto('./?prototype=trip-progress',{waitUntil:'domcontentloaded'});
  await page.locator('[data-detail-id]').click();
  await expect(page.locator('.stop-row')).toHaveCount(4);
}
async function arm(page){
  await page.locator('[data-detail-getoff-open]').click();await page.locator('[data-getoff-pick="4"]').click();await page.locator('[data-getoff-confirm]').click();
  await page.locator('[data-trip-start]').click();
}
async function moveToTunnel(page){
  await page.evaluate(()=>emit(22.30));
  await page.clock.fastForward(20000);await page.evaluate(()=>emit(22.301));
  await page.clock.fastForward(20000);await page.evaluate(()=>emit(22.302));
}
test('explicit boarding selection remains separate from browsing and reminder GPS',async({page})=>{
  await prepare(page);
  await expect(page.locator('[data-trip-start]')).toBeDisabled();
  await page.locator('[data-detail-stop="3"]').click();
  await expect(page.locator('[data-trip-boarding]')).toHaveValue('1');
  expect(await page.evaluate(()=>geoWatches.size)).toBe(0);
  await arm(page);
  expect(await page.evaluate(()=>geoWatches.size)).toBe(1);
  await expect(page.locator('[data-trip-status]')).toContainText('等待');
  await moveToTunnel(page);
  await expect(page.locator('[data-trip-status]')).toContainText('GPS');
  await expect(page.locator('[data-trip-plan]')).toContainText('长站距');
  expect(await page.evaluate(()=>tripProgressSnapshot().seq)).toBe(2);
  expect(await page.evaluate(()=>notifications.length)).toBe(0);
  await expect(page.locator('[data-trip-marker]')).toContainText('第 2 至第 3 站');
  expect(await page.evaluate(()=>busSaverTimer)).toBeNull();
});
test('six minute GPS gap advances only estimated progress, never sends an alighting notification, then GPS corrects backward',async({page})=>{
  await prepare(page);await arm(page);await moveToTunnel(page);
  const before=await page.evaluate(()=>tripProgressSnapshot().progress);
  const requests=[];page.on('request',r=>requests.push(r.url()));
  await page.clock.fastForward(6*60000);await page.evaluate(()=>renderRouteDetail());
  const estimated=await page.evaluate(()=>tripProgressSnapshot());
  expect(estimated.status).toBe('estimated');expect(estimated.progress).toBeGreaterThan(before);expect(estimated.progress).toBeLessThan(1);expect(estimated.seq).toBe(2);
  await expect(page.locator('[data-trip-status]')).toContainText('低信心');
  await expect(page.locator('[data-trip-marker]')).toContainText('估算／低信心');
  await expect(page.locator('#busSaver')).not.toHaveClass(/on/);
  await page.locator('.trip-progress').screenshot({path:'/workspace/BusPulseHK-trip-progress-local-preview.png'});
  expect(await page.evaluate(()=>notifications.length)).toBe(0);
  expect(requests.some(url=>/22\.3|114\.2|latitude|longitude/.test(url))).toBe(false);
  await page.evaluate(()=>emit(22.303));
  const corrected=await page.evaluate(()=>tripProgressSnapshot());
  expect(corrected.status).toBe('gps');expect(corrected.progress).toBeLessThan(estimated.progress);
  expect(await page.evaluate(()=>notifications.length)).toBe(0);
  expect(await page.evaluate(()=>errors)).toEqual([]);
});
test('stop, target change and closing clear session, while original reminder remains independent',async({page})=>{
  await prepare(page);await arm(page);await moveToTunnel(page);
  await page.locator('[data-trip-stop]').click();
  expect(await page.evaluate(()=>tripProgressSession)).toBeNull();expect(await page.evaluate(()=>geoWatches.size)).toBe(1);
  await page.locator('[data-trip-start]').click();
  await page.locator('[data-detail-getoff-change]').click();await page.locator('[data-getoff-pick="3"]').click();await page.locator('[data-getoff-confirm]').click();
  expect(await page.evaluate(()=>tripProgressSession)).toBeNull();
  await page.locator('[data-trip-start]').click();
  await page.evaluate(()=>closeRouteDetail({history:false}));
  expect(await page.evaluate(()=>tripProgressSession)).toBeNull();
  expect(await page.evaluate(()=>geoWatches.size)).toBe(1);
});
test('small screen, light mode and large font keep trip controls within viewport',async({page})=>{
  await prepare(page);await arm(page);await moveToTunnel(page);await page.clock.fastForward(6*60000);await page.evaluate(()=>{document.body.classList.add('light','font-large');renderRouteDetail();});
  for(const width of [320,390,768]){
    await page.setViewportSize({width,height:844});
    expect(await page.locator('.trip-progress').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})).toBe(true);
    expect(await page.locator('[data-trip-stop]').evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  }
});
