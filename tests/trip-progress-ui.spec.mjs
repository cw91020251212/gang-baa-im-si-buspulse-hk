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
    window.emit=(latitude,longitude=114.2,accuracy=10,timestamp=Date.now())=>[...geoWatches.values()].forEach(w=>w.ok({coords:{latitude,longitude,accuracy,speed:null},timestamp}));
  },item);
  await page.route('**/v1/transport/kmb/route-stop/**',r=>r.fulfill({json:{data:[1,2,3,4].map(seq=>({seq,stop:'s'+seq}))}}));
  await page.route('**/v1/transport/kmb/stop',r=>r.fulfill({json:{data:[22.30,22.302,22.392,22.394].map((lat,i)=>({stop:'s'+(i+1),name_tc:['上車站','隧道前站','隧道後站','下車站'][i],name_en:'STOP '+(i+1),lat:String(lat),long:'114.2'}))}}));
  await page.route('**/v1/transport/kmb/route-eta/**',r=>r.fulfill({json:{data:[]}}));
  await page.route('**/search.kmb.hk/**',r=>r.fulfill({json:{result:false}}));
  await page.route('**/raw.githubusercontent.com/**',r=>r.fulfill({status:404,body:'fixture has no official geometry'}));
  await page.goto('./',{waitUntil:'domcontentloaded'});
  await page.locator('[data-detail-id]').click();
  await expect(page.locator('.stop-row')).toHaveCount(4);
}
async function gps(page){await page.locator('[data-detail-gps]').click();}
async function arm(page,target='4'){
  await page.locator('[data-detail-getoff-open],[data-detail-getoff-change]').click();
  await page.locator('[data-getoff-pick="'+target+'"]').click();
  await page.locator('[data-getoff-confirm]').click();
}
async function moveToTunnel(page){
  await page.evaluate(()=>emit(22.30));
  await page.clock.fastForward(20000);await page.evaluate(()=>emit(22.301));
  await page.clock.fastForward(20000);await page.evaluate(()=>emit(22.302));
}
async function currentPosition(page){return page.locator('[data-trip-marker]').evaluate(e=>parseFloat(e.style.top));}

test('uses only the existing route timeline, with a single own-position marker and no inference panels',async({page})=>{
  await prepare(page);
  await expect(page.locator('.stop-timeline')).toHaveCount(1);
  await expect(page.locator('.trip-progress,.trip-stop-timeline,[data-trip-boarding]')).toHaveCount(0);
  await expect(page.locator('.detail-inference,.bus-front-marker,.summary-buses')).toHaveCount(0);
  await expect(page.locator('#routeDetailBody')).not.toContainText(/我的行程|测试版|測試版|信心度|百分比/);
  await expect(page.locator('[data-trip-marker]')).toHaveCount(0);
  await gps(page);await page.evaluate(()=>emit(22.393));
  await expect(page.locator('.stop-timeline>[data-trip-marker]')).toHaveCount(1);
  await expect(page.locator('[data-trip-marker]')).toHaveAttribute('aria-label',/隧道後站與下車站之間/);
  await expect(page.locator('[data-trip-marker]')).toHaveText('你');
  expect(await page.evaluate(()=>tripProgressSnapshot().seq)).toBe(3);
  await page.evaluate(()=>{deriveVirtualBusSegments=()=>{throw Error('must not infer a bus');};renderRouteDetail();});
  expect(await page.evaluate(()=>errors)).toEqual([]);
});

test('the marker moves along the original stop line while ordinary taps keep viewing the chosen ETA',async({page})=>{
  await prepare(page);await gps(page);await page.evaluate(()=>emit(22.30));
  const before=await currentPosition(page);
  await page.clock.fastForward(20000);await page.evaluate(()=>emit(22.301));
  const halfway=await currentPosition(page);expect(halfway).toBeGreaterThan(before);
  const geometry=await page.locator('.stop-timeline').evaluate(e=>{
    const y=seq=>{const r=e.querySelector('[data-detail-stop="'+seq+'"] .stop-dot').getBoundingClientRect();return r.top+r.height/2-e.getBoundingClientRect().top;};
    return {a:y(1),b:y(2)};
  });
  expect(halfway).toBeCloseTo((geometry.a+geometry.b)/2,0);
  await page.locator('[data-detail-stop="4"]').click();
  await page.clock.fastForward(20000);await page.evaluate(()=>emit(22.302));
  await expect(page.locator('.detail-current-name')).toContainText('下車站');
  await expect(page.locator('[data-trip-marker]')).toHaveAttribute('aria-label',/隧道前站與隧道後站之間/);
  expect(await page.evaluate(()=>tripProgressSnapshot().seq)).toBe(2);
  await expect(page.locator('[data-trip-marker]')).toHaveCount(1);
  await page.locator('.stop-timeline').evaluate(e=>{const header=document.querySelector('.route-detail-head');const view=document.querySelector('.route-detail');view.scrollTop+=e.getBoundingClientRect().top-header.getBoundingClientRect().bottom-12;});
  await page.locator('.stop-timeline').screenshot({path:test.info().outputPath('existing-timeline-gps.png')});
});

test('tunnel estimates move only inside the unconfirmed segment and never mark arrival or notify',async({page})=>{
  await prepare(page);await arm(page);await moveToTunnel(page);
  const before=await currentPosition(page);const requests=[];page.on('request',r=>requests.push(r.url()));
  await page.clock.fastForward(6*60000);await page.evaluate(()=>renderRouteDetail());
  const s=await page.evaluate(()=>tripProgressSnapshot());
  expect(s.status).toBe('estimated');expect(s.seq).toBe(2);expect(s.progress).toBeLessThan(1);
  expect(await currentPosition(page)).toBeGreaterThan(before);
  await expect(page.locator('[data-trip-marker]')).toHaveText('你訊號弱');
  expect(await page.evaluate(()=>notifications.length)).toBe(0);
  expect(requests.some(url=>/22\.3|114\.2|latitude|longitude/.test(url))).toBe(false);
  await page.evaluate(()=>emit(22.303));
  expect(await currentPosition(page)).toBeLessThan(before+100);
  expect(await page.evaluate(()=>tripProgressSnapshot().status)).toBe('gps');
  expect(await page.evaluate(()=>notifications.length)).toBe(0);
});

test('poor, stale and off-route fixes cannot invent a user position or send an alert',async({page})=>{
  await prepare(page);await arm(page);
  await page.evaluate(()=>emit(22.392,114.2,500));
  await expect(page.locator('[data-trip-marker]')).toHaveCount(0);
  await page.evaluate(()=>emit(22.392,114.2,10,Date.now()-180000));
  await page.evaluate(()=>emit(22.392,115.2));
  await expect(page.locator('[data-trip-marker]')).toHaveCount(0);
  expect(await page.evaluate(()=>notifications.length)).toBe(0);
});

test('separate alighting selection alerts once at the preceding stop, using only the system sound',async({page})=>{
  await prepare(page);await arm(page);await moveToTunnel(page);
  await page.clock.fastForward(12*60000);await page.evaluate(()=>emit(22.3908));
  expect(await page.evaluate(()=>notifications.length)).toBe(0);
  await page.clock.fastForward(10000);await page.evaluate(()=>emit(22.3912));
  expect(await page.evaluate(()=>notifications.length)).toBe(1);
  await expect(page.locator('.detail-getoff-status')).toContainText('準備下車');
  expect(await page.evaluate(()=>notifications[0].options.silent)).toBe(false);
  await page.clock.fastForward(20000);await page.evaluate(()=>emit(22.392));
  await page.clock.fastForward(20000);await page.evaluate(()=>emit(22.394));
  expect(await page.evaluate(()=>notifications.length)).toBe(1);
  await expect(page.locator('[data-trip-marker]')).toHaveAttribute('aria-label','你的位置：下車站');
});

test('closing and reopening retains the ordered reminder and its single watcher, never an extra timeline',async({page})=>{
  await prepare(page);await arm(page);await moveToTunnel(page);
  await page.evaluate(()=>closeRouteDetail({history:false}));
  expect(await page.evaluate(()=>tripProgressJourneys.size)).toBe(1);
  await page.clock.fastForward(12*60000);await page.evaluate(()=>emit(22.392));
  expect(await page.evaluate(()=>notifications.length)).toBe(1);
  await expect(page.locator('#busSaver')).not.toHaveClass(/on/);
  await page.locator('[data-detail-id]').click();
  await expect(page.locator('[data-trip-marker]')).toHaveAttribute('aria-label',/隧道後站與下車站之間/);
  expect(await page.evaluate(()=>geoWatches.size)).toBe(1);
  await expect(page.locator('.stop-timeline')).toHaveCount(1);
  await page.locator('[data-detail-stop="1"]').click();
  await expect(page.locator('.detail-current-name')).toContainText('上車站');
  expect(await page.evaluate(()=>tripProgressSnapshot().seq)).toBe(3);
  await page.locator('[data-detail-getoff-cancel]').click();
  expect(await page.evaluate(()=>({journeys:tripProgressJourneys.size,watches:geoWatches.size}))).toEqual({journeys:0,watches:0});
  await expect(page.locator('[data-trip-marker]')).toHaveCount(0);
});

test('GPS alone can be stopped without selecting an alighting stop, and position is not persisted',async({page})=>{
  await prepare(page);await gps(page);await page.evaluate(()=>emit(22.301));
  await expect(page.locator('[data-trip-marker]')).toHaveCount(1);
  expect(await page.evaluate(()=>Object.keys(getoff).length)).toBe(0);
  expect(await page.evaluate(()=>JSON.stringify(localStorage).includes('lastFix'))).toBe(false);
  await page.locator('[data-detail-gps-stop]').click();
  await expect(page.locator('[data-trip-marker]')).toHaveCount(0);
  expect(await page.evaluate(()=>geoWatches.size)).toBe(0);
});

test('the compact marker remains aligned in light mode, large fonts and narrow screens',async({page})=>{
  await prepare(page);await gps(page);await page.evaluate(()=>emit(22.301));
  await page.evaluate(()=>{document.body.classList.add('light','font-large');renderRouteDetail();});
  for(const width of [320,390,768]){
    await page.setViewportSize({width,height:844});
    await page.evaluate(()=>updateTripProgressMarker());
    const geometry=await page.locator('[data-trip-marker]').evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};});
    expect(geometry.left).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeLessThanOrEqual(width);expect(geometry.width).toBeLessThanOrEqual(90);
    await expect(page.locator('.stop-timeline')).toHaveCount(1);
  }
});
