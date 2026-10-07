/* ETA-derived hypotheses, not vehicle telemetry. No route-number exceptions. */
(function (root) {
  'use strict';
  const MINUTE = 60000;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const median = xs => { const a = [...xs].sort((x,y) => x-y); return a.length ? a[Math.floor(a.length/2)] : null; };
  const stamp = value => Number.isFinite(Date.parse(value || '')) ? Date.parse(value) : null;
  function createModel() { return { sections:new Map(), nextTrack:1 }; }
  function fresh(state, now) {
    if (!state || state.status !== 'ready' || state.stale) return false;
    const fetched = stamp(state.fetchedAt), source = stamp(state.sourceTimestamp);
    return fetched != null && now-fetched >= -30000 && now-fetched <= 90000
      && (source == null || (now-source >= -30000 && now-source <= 150000));
  }
  function queue(state, now) {
    if (!fresh(state,now)) return [];
    const rows = (state.etas || []).filter(e => !e.sched).map(e => ({time:stamp(e.rawIso || e.iso), rank:e.etaSeq ?? null}));
    const out=[];
    rows.filter(e => e.time != null && e.time >= now-2*MINUTE && e.time <= now+120*MINUTE)
      .sort((a,b) => a.time-b.time).forEach(e => { if (!out.some(x => Math.abs(x.time-e.time)<15000)) out.push(e); });
    return out.slice(0,4);
  }
  function aligned(a,b) {
    if (!a || !b) return true;
    if (a.batchId != null && b.batchId != null && a.batchId !== b.batchId) return false;
    const at=stamp(a.sourceTimestamp)||stamp(a.fetchedAt), bt=stamp(b.sourceTimestamp)||stamp(b.fetchedAt);
    return at != null && bt != null && Math.abs(at-bt)<=90000;
  }
  function distance(stops,i) {
    const a=stops[i], b=stops[i+1];
    if (b?.roadGeometryVerified && Number(b.roadDistanceFromPreviousMeters)>0) return {metres:Number(b.roadDistanceFromPreviousMeters),kind:'road'};
    if (a?.cumulativeDistanceMeters != null && b?.cumulativeDistanceMeters != null) {
      const d=Number(b.cumulativeDistanceMeters)-Number(a.cumulativeDistanceMeters);
      if (Number.isFinite(d) && d>0) return {metres:d,kind:'stop-distance'};
    }
    if ([a?.lat,a?.lng,b?.lat,b?.lng].every(Number.isFinite)) {
      const dx=(b.lng-a.lng)*Math.cos((a.lat+b.lat)*Math.PI/360), dy=b.lat-a.lat;
      return {metres:Math.hypot(dx,dy)*111320,kind:'stop-distance'};
    }
    return {metres:0,kind:'unavailable'};
  }
  // Small monotone sequence alignment. ETA rank is deliberately NOT an identity.
  function matchQueues(a,b,minTime,maxTime,prior) {
    const hypotheses=[prior];
    a.forEach(x => b.forEach(y => { const d=y.time-x.time; if (d>=minTime && d<=maxTime) hypotheses.push(d); }));
    let best={pairs:[],duration:prior,score:-Infinity};
    for (const hypothesis of hypotheses) {
      const tolerance=Math.max(MINUTE,hypothesis*.25), memo=new Map();
      const solve=(i,j) => {
        if (i>=a.length || j>=b.length) return {pairs:[],score:0};
        const key=i+':'+j; if (memo.has(key)) return memo.get(key);
        let answer=solve(i+1,j); const skipB=solve(i,j+1);
        if (skipB.score>answer.score) answer=skipB;
        const d=b[j].time-a[i].time;
        if (d>=minTime && d<=maxTime && Math.abs(d-hypothesis)<=tolerance) {
          const rest=solve(i+1,j+1), candidate={pairs:[{a:i,b:j,duration:d},...rest.pairs],score:rest.score+10-Math.abs(d-hypothesis)/tolerance};
          if (candidate.score>answer.score) answer=candidate;
        }
        memo.set(key,answer); return answer;
      };
      const match=solve(0,0), duration=median(match.pairs.map(p=>p.duration)) || prior;
      const score=match.score-Math.abs(Math.log(duration/prior))*.8;
      if (score>best.score) best={...match,duration,score};
    }
    return best;
  }
  function recordDeparture(section,a,now) {
    const previous=section.previousA;
    if (previous && a.length && now-previous.at<=90000) {
      const old=previous.rows[0], next=a[0];
      // A queue-head disappearing near its due time is a passage hypothesis,
      // not a certified departure. A missing API response alone is not enough.
      if (old && old.time<=now+15000 && old.time>=now-90000 && next.time>=now+90000
          && next.time-old.time>=2*MINUTE && !a.some(row=>Math.abs(row.time-old.time)<90000)) {
        if (!section.departures.some(x=>Math.abs(x.time-old.time)<MINUTE)) {
          section.departures.push({time:clamp(old.time,previous.at-60000,now),low:previous.at,high:now});
        }
      }
    }
    section.departures=section.departures.filter(x=>now-x.time<=120*MINUTE).slice(-8);
    section.previousA={rows:a,at:now};
  }
  function estimate(stops,etaByStop,now=Date.now(),model=createModel()) {
    const segments=[], managedGaps=[];
    for (let i=0;i<stops.length-1;i++) {
      const from=stops[i], to=stops[i+1], length=distance(stops,i);
      if (length.metres<2000) continue;
      managedGaps.push({fromSeq:Number(from.seq),toSeq:Number(to.seq)});
      const stateA=etaByStop.get(String(from.id)), stateB=etaByStop.get(String(to.id));
      if (!fresh(stateB,now)) continue;
      const a=fresh(stateA,now)?queue(stateA,now):[], b=queue(stateB,now);
      if (a.length && !aligned(stateA,stateB)) continue;
      const key=String(from.id)+'>'+String(to.id);
      let section=model.sections.get(key);
      if (!section || Math.abs(length.metres-section.metres)>section.metres*.3) {
        section={metres:length.metres,samples:[],departures:[],tracks:[],signature:null,measurement:null,previousA:null};
        model.sections.set(key,section);
      }
      section.samples=section.samples.filter(sample=>now-sample.observedAt>=-30000 && now-sample.observedAt<=15*MINUTE);
      // Broad physical bounds. 30km/h is ONLY an uncalibrated distance prior;
      // without endpoint/history evidence, use only the fastest-travel bound.
      const minTime=Math.max(30000,length.metres/1000/90*60*MINUTE);
      const maxTime=Math.max(2*MINUTE,length.metres/1000/8*60*MINUTE);
      const prior=clamp(median(section.samples.map(sample=>sample.duration))||length.metres/1000/30*60*MINUTE,minTime,maxTime);
      const signature=[length.metres,stateA?.fetchedAt,stateB.fetchedAt,...a.map(x=>x.time),'/',...b.map(x=>x.time)].join('|');
      if (signature!==section.signature) {
        recordDeparture(section,a,now);
        const matched=matchQueues(a,b,minTime,maxTime,prior);
        const measurement=[stateA?.sourceTimestamp,stateB.sourceTimestamp,...a.map(x=>x.time),'/',...b.map(x=>x.time)].join('|');
        if (measurement!==section.measurement && matched.pairs.length) {
          section.samples.push(...matched.pairs.map(x=>({duration:x.duration,observedAt:now}))); section.samples=section.samples.slice(-16); section.measurement=measurement;
        }
        const duration=clamp(median(section.samples.map(sample=>sample.duration))||prior,minTime,maxTime);
        const futureA=a.find(row=>row.time>now), usedDepartures=new Set(), next=[], usedTracks=new Set();
        b.forEach((arrival,index) => {
          if (arrival.time<=now) return;
          const pair=matched.pairs.find(p=>p.b===index);
          if (pair && a[pair.a].time>now) return; // paired bus has NOT reached A
          let start=null, end=arrival.time, method='', confidence='low', score=58;
          if (pair && a[pair.a].time<=now) {
            start=a[pair.a].time; method='paired-endpoints'; confidence='medium'; score=84;
          } else {
            const departures=section.departures.map((d,j)=>({d,j,error:Math.abs(end-d.time-duration)}))
              .filter(x=>!usedDepartures.has(x.j) && end-x.d.time>=minTime && end-x.d.time<=maxTime).sort((x,y)=>x.error-y.error);
            if (departures[0] && departures[0].error<=Math.max(2*MINUTE,duration*.4)) {
              const departure=departures[0]; start=departure.d.time; usedDepartures.add(departure.j); method='departure-history'; confidence='medium'; score=78;
            } else {
              const remaining=end-now;
              const prefix=futureA && end<futureA.time+minTime-15000 && remaining<=duration;
              const learned=section.samples.length>=2 && remaining<=duration;
              const imminent=remaining<=minTime;
              if (!prefix && !learned && !imminent) return;
              start=end-duration;
              if (start>now) return;
              method=prefix?'queue-prefix':learned?'learned-travel-time':'speed-bound';
              score=prefix?64:learned?60:54;
            }
          }
          const headway=Math.min(index?end-b[index-1].time:Infinity,b[index+1]?b[index+1].time-end:Infinity);
          const tolerance=Math.max(20000,Math.min(90000,Number.isFinite(headway)?headway*.4:90000));
          const old=section.tracks.map((track,j)=>({track,j,error:Math.abs(track.progressEndAt-end)}))
            .filter(x=>!usedTracks.has(x.j) && x.error<=tolerance).sort((x,y)=>x.error-y.error)[0];
          if (old) usedTracks.add(old.j);
          const id=old?.track.markerId || 'gap:'+key+':'+model.nextTrack++;
          // Keep a passage-derived start fixed while revising the B ETA.
          if (old && ['paired-endpoints','departure-history'].includes(old.track.method) && confidence==='low') start=old.track.progressStartAt;
          next.push({fromSeq:Number(from.seq),toSeq:Number(to.seq),etaSeq:arrival.rank,markerId:id,
            confidence,score,scoreLabel:confidence==='medium'?'中':'低',method,longGapEstimate:true,inferredFromDownstreamEta:true,
            distanceMeters:Math.round(length.metres),distanceSource:length.kind,travelMinutes:(end-start)/MINUTE,
            progressStartAt:start,progressEndAt:end,arrivalAt:end,
            progressRange:[clamp(1-(end-now)/minTime,0,1),clamp(1-(end-now)/maxTime,0,1)]});
        });
        section.tracks=next; section.signature=signature;
      }
      segments.push(...section.tracks.filter(track=>track.progressStartAt<=now && track.progressEndAt>now));
    }
    return {segments,managedGaps};
  }
  root.BusGapEstimator={createModel,estimate,matchQueues,fresh};
})(globalThis);
