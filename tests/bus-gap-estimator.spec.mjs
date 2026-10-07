import { test, expect } from '@playwright/test';
import '../bus-gap-estimator.js';
const estimator=globalThis.BusGapEstimator;
const base=Date.parse('2026-10-07T04:00:00Z');
const iso=t=>new Date(t).toISOString();
const stops=(metres=8000)=>[{id:'A',seq:1,cumulativeDistanceMeters:0},{id:'B',seq:2,cumulativeDistanceMeters:metres}];
const state=(minutes,now=base,extra={})=>({status:'ready',fetchedAt:iso(now),sourceTimestamp:iso(now),batchId:1,
  etas:minutes.map((m,i)=>({iso:iso(now+m*60000),etaSeq:i+1})),...extra});
const run=(a,b,metres=8000,now=base,model=estimator.createModel())=>estimator.estimate(stops(metres),new Map([['A',a],['B',b]]),now,model).segments;

test('long section pairs queue times rather than equal ETA ranks',()=>{
  const result=run(state([10,20]),state([2,11,22]));
  expect(result).toHaveLength(2);
  expect(result.map(x=>x.arrivalAt)).toEqual([base+2*60000,base+11*60000]);
  expect(new Set(result.map(x=>x.markerId)).size).toBe(2);
  expect(result.every(x=>x.method==='queue-prefix')).toBe(true);
});

test('future endpoint pairs are not falsely shown as buses already past A',()=>{
  expect(run(state([5,15]),state([21,31]))).toHaveLength(0);
});

test('past A plus future B gives endpoint-based progress',()=>{
  const result=run(state([-1]),state([9]),6000);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({method:'paired-endpoints',confidence:'medium'});
  expect(result[0].progressStartAt).toBe(base-60000);
  expect(result[0].travelMinutes).toBe(10);
});

test('cold-start B-only uses imminent speed-bound evidence, not every forecast',()=>{
  const result=run(undefined,state([2,10,20]));
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({method:'speed-bound',confidence:'low'});
});

test('20km no-stop section has no artificial fifteen-minute ceiling',()=>{
  const result=run(undefined,state([2]),20000);
  expect(result).toHaveLength(1);
  expect(result[0].travelMinutes).toBe(40);
});

test('verified road mileage is used instead of straight station distance',()=>{
  const curved=stops(); curved[1].roadGeometryVerified=true; curved[1].roadDistanceFromPreviousMeters=12000;
  const eta=new Map([['B',state([7])]]);
  expect(estimator.estimate(stops(),eta,base).segments).toHaveLength(0);
  const result=estimator.estimate(curved,eta,base).segments;
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({distanceMeters:12000,distanceSource:'road',travelMinutes:24});
});

test('ETA disappearance near due time is only a departure hypothesis',()=>{
  const model=estimator.createModel(), route=stops(6000);
  estimator.estimate(route,new Map([['A',state([.5,10])],['B',state([10.5,20])]]),base,model);
  const now=base+60000;
  const result=estimator.estimate(route,new Map([['A',state([9],now)],['B',state([9.5,19],now)]]),now,model).segments;
  expect(result.some(x=>x.method==='departure-history')).toBe(true);
  const track=result.find(x=>x.method==='departure-history');
  expect(track.progressStartAt).toBe(base+30000);
  expect(track.confidence).toBe('medium');
});

test('an empty A API response is not a certified departure',()=>{
  const model=estimator.createModel(), route=stops(6000);
  estimator.estimate(route,new Map([['A',state([.5])],['B',state([10.5])]]),base,model);
  const now=base+60000;
  const result=estimator.estimate(route,new Map([['A',state([],now)],['B',state([9.5],now)]]),now,model).segments;
  expect(result.every(x=>x.method!=='departure-history')).toBe(true);
});

test('track identity survives ETA rank renumbering and small forecast revisions',()=>{
  const model=estimator.createModel(), route=stops();
  const first=estimator.estimate(route,new Map([['B',state([2])]]),base,model).segments[0];
  const now=base+30000;
  const nextState=state([1.7],now); nextState.etas[0].etaSeq=3;
  const next=estimator.estimate(route,new Map([['B',nextState]]),now,model).segments[0];
  expect(next.markerId).toBe(first.markerId);
});

test('repeated animation frames do not duplicate calibration samples or markers',()=>{
  const model=estimator.createModel(), route=stops(), data=new Map([['A',state([10,20])],['B',state([2,22,32])]]);
  const first=estimator.estimate(route,data,base,model).segments;
  const samples=model.sections.get('A>B').samples.length;
  const second=estimator.estimate(route,data,base+1000,model).segments;
  expect(model.sections.get('A>B').samples).toHaveLength(samples);
  expect(second.map(x=>x.markerId)).toEqual(first.map(x=>x.markerId));
});

test('expired, scheduled, invalid, and mixed-batch evidence cannot generate long-gap positions',()=>{
  const variants=[
    state([2],base,{stale:true}),
    state([2],base-100000),
    state([2],base,{sourceTimestamp:iso(base-160000)}),
    state([2],base,{etas:[{iso:iso(base+120000),sched:true}]}),
    state([2],base,{etas:[{iso:'invalid'}]})
  ];
  for(const b of variants) expect(run(undefined,b)).toHaveLength(0);
  expect(run(state([10],base,{batchId:2}),state([2],base,{batchId:3}))).toHaveLength(0);
});

test('arrival forecasts cannot leave ghost tracks after arrival or evidence expiry',()=>{
  const model=estimator.createModel(), route=stops(), data=new Map([['B',state([.5])]]);
  expect(estimator.estimate(route,data,base,model).segments).toHaveLength(1);
  expect(estimator.estimate(route,data,base+60000,model).segments).toHaveLength(0);
  expect(estimator.estimate(route,data,base+100000,model).segments).toHaveLength(0);
});

test('short gaps and unknown distances do not generate expressway hypotheses',()=>{
  expect(run(undefined,state([2]),550)).toHaveLength(0);
  expect(estimator.estimate([{id:'A',seq:1},{id:'B',seq:2}],new Map([['B',state([2])]]),base).segments).toHaveLength(0);
});

test('monotone queue alignment never reuses or crosses endpoint observations',()=>{
  const a=[0,10,20].map(m=>({time:base+m*60000})), b=[2,12,22,32].map(m=>({time:base+m*60000}));
  const matched=estimator.matchQueues(a,b,5*60000,60*60000,12*60000);
  expect(new Set(matched.pairs.map(x=>x.a)).size).toBe(matched.pairs.length);
  expect(new Set(matched.pairs.map(x=>x.b)).size).toBe(matched.pairs.length);
  expect(matched.pairs.every((p,i,all)=>!i || (p.a>all[i-1].a && p.b>all[i-1].b))).toBe(true);
});


test('expired travel-time calibration cannot unlock B-only positions',()=>{
  const model=estimator.createModel(), route=stops();
  estimator.estimate(route,new Map([['A',state([10,20])],['B',state([20,30])]]),base,model);
  expect(model.sections.get('A>B').samples.length).toBeGreaterThanOrEqual(2);
  const now=base+16*60000;
  expect(estimator.estimate(route,new Map([['B',state([8],now)]]),now,model).segments).toHaveLength(0);
  const imminent=estimator.estimate(route,new Map([['B',state([2],now)]]),now,model).segments;
  expect(imminent).toHaveLength(1);
  expect(imminent[0]).toMatchObject({method:'speed-bound',confidence:'low',travelMinutes:16});
});
