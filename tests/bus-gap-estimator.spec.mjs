import { test, expect } from '@playwright/test';
import '../bus-gap-estimator.js';
const estimator=globalThis.BusGapEstimator;
const base=Date.parse('2026-10-07T04:00:00Z');
const iso=t=>new Date(t).toISOString();
const stops=(metres=8000)=>[{id:'A',seq:1,cumulativeDistanceMeters:0},{id:'B',seq:2,cumulativeDistanceMeters:metres}];
const state=(minutes,now=base,extra={})=>({status:'ready',fetchedAt:iso(now),sourceTimestamp:iso(now),batchId:1,
  etas:minutes.map((m,i)=>({iso:iso(now+m*60000),etaSeq:i+1})),...extra});
const run=(a,b,metres=8000,now=base,model=estimator.createModel())=>estimator.estimate(stops(metres),new Map([['A',a],['B',b]]),now,model).segments;
const runDetailed=(a,b,metres=8000,now=base,model=estimator.createModel())=>estimator.estimate(stops(metres),new Map([['A',a],['B',b]]),now,model);
const scheduledState=(minutes,now=base,extra={})=>state([],now,{...extra,etas:minutes.map((m,i)=>({iso:iso(now+m*60000),etaSeq:i+1,sched:true}))});

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

test('cold-start B-only uses the plausible section window, not every forecast',()=>{
  const result=run(undefined,state([2,10,20]));
  expect(result).toHaveLength(2);
  expect(result.map(x=>x.method)).toEqual(['speed-bound','distance-prior']);
  expect(result.every(x=>x.confidence==='low')).toBe(true);
});

test('cold-start downstream queue fills a long corridor within a plausible distance prior',()=>{
  const result=run(undefined,state([12,25,39,41]),20000);
  expect(result).toHaveLength(3);
  expect(result.map(x=>x.arrivalAt)).toEqual([base+12*60000,base+25*60000,base+39*60000]);
  expect(result.map(x=>x.method)).toEqual(['speed-bound','distance-prior','distance-prior']);
  expect(result.every(x=>x.confidence==='low' && x.progressStartAt<=base)).toBe(true);
  expect(result.every(x=>x.travelMinutes===40)).toBe(true);
});

test('distance-prior back-projection stops outside the section travel window',()=>{
  expect(run(undefined,state([25]),10000)).toHaveLength(0);
});

test('20km no-stop section has no artificial fifteen-minute ceiling',()=>{
  const result=run(undefined,state([2]),20000);
  expect(result).toHaveLength(1);
  expect(result[0].travelMinutes).toBe(40);
});

test('scheduled B-only ETA back-projects a separate low-confidence position within the route window',()=>{
  const result=runDetailed(scheduledState([20]),scheduledState([10]));
  expect(result.segments).toHaveLength(0);
  expect(result.scheduleSegments).toHaveLength(1);
  expect(result.scheduleSegments[0]).toMatchObject({scheduleOnly:true,method:'scheduled-distance-prior',confidence:'low',distanceMeters:8000,distanceSource:'stop-distance',travelMinutes:16});
  expect(result.scheduleSegments[0].progressStartAt).toBe(base-6*60000);
  expect(result.scheduleSegments[0].progressEndAt).toBe(base+10*60000);
});

test('scheduled endpoint pair is shown only after its upstream time and never trains live travel samples',()=>{
  const model=estimator.createModel();
  const result=runDetailed(scheduledState([-1]),scheduledState([9]),6000,base,model);
  expect(result.scheduleSegments).toHaveLength(1);
  expect(result.scheduleSegments[0]).toMatchObject({scheduleOnly:true,method:'scheduled-endpoints',confidence:'low',travelMinutes:10});
  expect(model.sections.get('A>B').samples).toHaveLength(0);
});

test('future scheduled endpoint pairs do not appear in the road before reaching A',()=>{
  const result=runDetailed(scheduledState([5,30]),scheduledState([15,40]));
  expect(result.scheduleSegments).toHaveLength(0);
});

test('steady origin headway plus aligned route ETAs projects a likely bus through a long gap',()=>{
  const route=[{id:'O',seq:1,cumulativeDistanceMeters:0},{id:'A',seq:2,cumulativeDistanceMeters:10000},{id:'B',seq:3,cumulativeDistanceMeters:18000}];
  const data=new Map([['O',scheduledState([1,26,51])],['A',state([18,43,68])],['B',state([28,53,78])]]);
  const result=estimator.estimate(route,data,base);
  expect(result.segments.filter(segment=>segment.fromSeq===2)).toHaveLength(0);
  const projected=result.scheduleSegments.filter(segment=>segment.fromSeq===2);
  expect(projected).toHaveLength(1);
  expect(projected[0]).toMatchObject({scheduleOnly:true,inferredFromScheduleHeadway:true,method:'scheduled-headway-projection',confidence:'low',fromSeq:2,toSeq:3,travelMinutes:10});
  expect(projected[0].progressStartAt).toBe(base-7*60000);
  expect(projected[0].progressEndAt).toBe(base+3*60000);
});

test('irregular or mixed-batch origin schedules do not project route-wide buses',()=>{
  const route=[{id:'O',seq:1,cumulativeDistanceMeters:0},{id:'A',seq:2,cumulativeDistanceMeters:10000},{id:'B',seq:3,cumulativeDistanceMeters:18000}];
  const irregular=new Map([['O',scheduledState([1,26,61])],['A',state([18,43,68])],['B',state([28,53,78])]]);
  expect(estimator.estimate(route,irregular,base).scheduleSegments.filter(segment=>segment.fromSeq===2)).toHaveLength(0);
  const mismatched=new Map([['O',scheduledState([1,26,51])],['A',state([18,43,68],base,{batchId:2})],['B',state([28,53,78],base,{batchId:2})]]);
  expect(estimator.estimate(route,mismatched,base).scheduleSegments.filter(segment=>segment.fromSeq===2)).toHaveLength(0);
});

test('live evidence takes precedence over an overlapping timetable estimate',()=>{
  const a=state([],base,{etas:[{iso:iso(base-60000),etaSeq:1},{iso:iso(base+20*60000),etaSeq:2,sched:true}]});
  const b=state([],base,{etas:[{iso:iso(base+9*60000),etaSeq:1},{iso:iso(base+10*60000),etaSeq:2,sched:true}]});
  const result=runDetailed(a,b);
  expect(result.segments).toHaveLength(1);
  expect(result.scheduleSegments).toHaveLength(0);
});

test('schedule-only marker identity survives small ETA revisions and stale schedules are rejected',()=>{
  const model=estimator.createModel(), route=stops();
  const first=runDetailed(scheduledState([20]),scheduledState([10]),8000,base,model).scheduleSegments[0];
  const now=base+30000;
  const next=runDetailed(scheduledState([20],now),scheduledState([9.5],now),8000,now,model).scheduleSegments[0];
  expect(next.markerId).toBe(first.markerId);
  const stale=scheduledState([2],now,{stale:true});
  expect(runDetailed(undefined,stale,8000,now,estimator.createModel()).scheduleSegments).toHaveLength(0);
});

test('verified road mileage is used instead of straight station distance',()=>{
  const curved=stops(); curved[1].roadGeometryVerified=true; curved[1].roadDistanceFromPreviousMeters=12000;
  const eta=new Map([['B',state([7])]]);
  const unverified=estimator.estimate(stops(),eta,base).segments[0];
  expect(unverified).toMatchObject({distanceMeters:8000,distanceSource:'stop-distance',travelMinutes:16});
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
  expect(estimator.estimate(route,new Map([['B',state([17],now)]]),now,model).segments).toHaveLength(0);
  const imminent=estimator.estimate(route,new Map([['B',state([2],now)]]),now,model).segments;
  expect(imminent).toHaveLength(1);
  expect(imminent[0]).toMatchObject({method:'speed-bound',confidence:'low',travelMinutes:16});
});
