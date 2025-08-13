
/* =========================================================
   12-Month Concurrent Trainer — Full JS
   Adds a Builder tab (local “backend”) with Weeks/Days/Sections/Items CRUD
   and migrates your plan to a sections-based model.
   ========================================================= */

/* ---------------- Core helpers ---------------- */

const qs = (s)=>document.querySelector(s);
const ce = (t, cls)=>{ const e=document.createElement(t); if(cls) e.className=cls; return e; };
const isoToday = ()=> new Date().toISOString().slice(0,10);

function showToast(msg){
  let t = qs('#toast');
  if(!t){ t = ce('div','toast'); t.id='toast'; document.body.appendChild(t); }
  t.textContent = msg; t.style.display='block';
  clearTimeout(showToast._t); showToast._t=setTimeout(()=> t.style.display='none', 1600);
}

function persistState(){
  try{ localStorage.setItem('trainer_state', JSON.stringify(state)); }catch{}
}
function loadState(){
  try{
    const raw = localStorage.getItem('trainer_state');
    if(raw){
      const saved = JSON.parse(raw);
      Object.assign(state, saved || {});
    }
  }catch{}
}

/* ---------------- Global state ---------------- */
const state = {
  unit: 'lb',
  programStart: '2025-08-25',
  weightLogs: {},
  workoutLogs: [],            // [{date, entries:[{pid,name,sets:[{w,reps,rpe,loadType}], notes}]}]
  doneFlags: {},              // {'w#:d#': true}
  program: { name:'12-Month Concurrent (AX Hybrid)', weeks: [] },
  colors: {
    series: ['#38bdf8', '#22d3ee', '#10b981', '#f59e0b', '#ef4444', '#a78bfa', '#f472b6'],
    loadType: { barbell:'#38bdf8', dumbbell:'#22d3ee', machine:'#10b981', bodyweight:'#f59e0b' }
  }
};

/* Editing pointer for set edits */
let __editing = null; // {pid, idx}

/* ---------------- UI bootstrap (tabs) ---------------- */
document.addEventListener('click',(e)=>{
  const t = e.target;
  if(t.matches('.tab')){
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
    t.classList.add('active'); render(); return;
  }
  if(t.id==='unit-lb'){ state.unit='lb'; qs('#unit-lb').classList.add('active'); qs('#unit-kg').classList.remove('active'); persistState(); render(); }
  if(t.id==='unit-kg'){ state.unit='kg'; qs('#unit-kg').classList.add('active'); qs('#unit-lb').classList.remove('active'); persistState(); render(); }
});

/* ---------------- Ripples ---------------- */
function addRipple(el){
  el.classList.add('ripple');
  el.addEventListener('click', (e)=>{
    const r = el.getBoundingClientRect();
    const fx = document.createElement('span');
    fx.style.position='absolute';
    fx.style.left = (e.clientX - r.left)+'px';
    fx.style.top  = (e.clientY - r.top)+'px';
    fx.style.width = fx.style.height = Math.max(r.width, r.height)+'px';
    fx.style.borderRadius='50%';
    fx.style.transform='scale(0)';
    fx.style.opacity='.28';
    fx.style.background = getComputedStyle(document.documentElement).getPropertyValue('--brand')||'#38bdf8';
    fx.style.pointerEvents='none';
    fx.style.transition='transform .6s cubic-bezier(.22,.61,.36,1), opacity .6s cubic-bezier(.22,.61,.36,1)';
    el.style.position='relative'; el.style.overflow='hidden';
    el.appendChild(fx);
    requestAnimationFrame(()=>{ fx.style.transform='scale(4)'; fx.style.opacity='0'; });
    setTimeout(()=> el.contains(fx)&&el.removeChild(fx), 650);
  }, {passive:true});
}
function enhanceButtonsForRipple(){
  document.querySelectorAll('.btn:not([data-ripple])').forEach(b=>{
    addRipple(b); b.dataset.ripple='1';
  });
}

/* ---------------- Confetti on Done ---------------- */
function confettiBurst(x, y){
  const n = 26, tau = Math.PI*2, colors=['#10b981','#22d3ee','#38bdf8','#f59e0b','#ef4444'];
  const c=ce('canvas'); const dpr=Math.max(1,devicePixelRatio||1);
  Object.assign(c.style,{position:'fixed',left:0,top:0,width:'100vw',height:'100vh',pointerEvents:'none',zIndex:2000});
  c.width = innerWidth*dpr; c.height = innerHeight*dpr;
  const ctx = c.getContext('2d'); ctx.scale(dpr,dpr);
  document.body.appendChild(c);
  const parts = Array.from({length:n},(_,i)=>({
    x,y, vx: Math.cos(i/n*tau)*(4+Math.random()*2), vy: Math.sin(i/n*tau)*(4+Math.random()*2)-2,
    g:.12+Math.random()*.05, life: 40+Math.random()*20, color: colors[i%colors.length], s:2+Math.random()*2, rot: Math.random()*tau, vr:(Math.random()-.5)*.2
  }));
  let frames=0;
  (function tick(){
    const W=innerWidth, H=innerHeight;
    ctx.clearRect(0,0,W,H);
    parts.forEach(p=>{
      p.vy+=p.g; p.x+=p.vx; p.y+=p.vy; p.rot+=p.vr; p.life--;
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot); ctx.fillStyle=p.color; ctx.globalAlpha=Math.max(0,p.life/60);
      ctx.fillRect(-p.s,-p.s, p.s*2, p.s*2); ctx.restore();
    });
    frames++;
    if(frames<90 && parts.some(p=>p.life>0)) requestAnimationFrame(tick);
    else document.body.removeChild(c);
  })();
}

/* ---------------- Program generation ---------------- */
const QUARTER_LIFTS = [
  { push:'Incline DB Press', pull:'Underhand Barbell Row', squat:'Back Squat', hinge:'Conventional Deadlift',
    armsB:'Barbell Curl', armsT:'Lying EZ-Bar Triceps Extension', shoulder:'DB Shoulder Press', traps:'DB High Pulls' },
  { push:'Flat Barbell Bench Press', pull:'Weighted Pull-ups', squat:'Front Squat', hinge:'Romanian Deadlift',
    armsB:'Incline DB Curl', armsT:'Close-Grip Bench Press', shoulder:'Arnold Press', traps:'Barbell Shrugs' },
  { push:'Weighted Dips', pull:'Chest-Supported Row', squat:'Bulgarian Split Squat', hinge:'Trap Bar Deadlift',
    armsB:'Hammer Curl', armsT:'Rope Pushdown', shoulder:'Z Press', traps:'Face Pulls' },
  { push:'Incline Barbell Press', pull:'Meadows Row', squat:'Back Squat', hinge:'Deficit Deadlift',
    armsB:'EZ-Bar Curl', armsT:'Overhead Triceps Extension', shoulder:'Seated DB Press', traps:'High Pulls' }
];

function hypertrophyWeekTemplate(q){
  const L = QUARTER_LIFTS[q];
  return [
    { name:'Upper Push/Pull + Z2', type:'Hypertrophy',
      items:[
        {pid:'H1', name:L.push, target:'5×10 @ ~60% 1RM, 90s', weighted:true},
        {pid:'H2', name:L.pull, target:'5×5 @ ~75% 1RM, 2–3 min', weighted:true},
        {pid:'H3', name:'DB Incline Fly', target:'3×12', weighted:true},
        {pid:'H4', name:'Face Pulls', target:'3×15', weighted:true},
        {pid:'H5', name:'Finisher — Propain Pushups', target:'Hit 2× first-set max in ≤4:30', weighted:false},
        {pid:'H6', name:'Conditioning — Z2', target:'45–60’ easy', weighted:false}
      ]},
    { name:'Lower (Quads/Hams) + Z2', type:'Hypertrophy',
      items:[
        {pid:'H7', name:L.squat, target:'5×10 @ ~60% 1RM, 90s', weighted:true},
        {pid:'H8', name:L.hinge, target:'5×5 @ ~75% 1RM, 2–3 min', weighted:true},
        {pid:'H9', name:'Walking Lunge', target:'3×12/leg', weighted:true},
        {pid:'H10', name:'Hamstring Curl', target:'3×15', weighted:true},
        {pid:'H11', name:'Finisher — Prisoner Jump Squats', target:'Propain ≤4:30', weighted:false},
        {pid:'H12', name:'Conditioning — Z2', target:'30–40’ easy', weighted:false}
      ]},
    { name:'Arms + Z2', type:'Hypertrophy',
      items:[
        {pid:'H13', name:L.armsB, target:'5×10, 60–90s', weighted:true},
        {pid:'H14', name:L.armsT, target:'5×5, 2–3 min', weighted:true},
        {pid:'H15', name:'Incline DB Curl', target:'3×12', weighted:true},
        {pid:'H16', name:'Rope Pushdown', target:'3×15', weighted:true},
        {pid:'H17', name:'Finisher — Bench Dips', target:'Propain ≤4:30', weighted:false},
        {pid:'H18', name:'Conditioning — Z2', target:'35–45’ easy', weighted:false}
      ]},
    { name:'Shoulders/Traps + Z2', type:'Hypertrophy',
      items:[
        {pid:'H19', name:L.shoulder, target:'5×10', weighted:true},
        {pid:'H20', name:L.traps, target:'5×5', weighted:true},
        {pid:'H21', name:'Side Lateral Raise', target:'3×12–15', weighted:true},
        {pid:'H22', name:'Barbell Shrug / Face Pulls', target:'3×15', weighted:true},
        {pid:'H23', name:'Finisher — Neutral DB OHP', target:'Propain ≤4:30', weighted:true},
        {pid:'H24', name:'Conditioning — Z2', target:'30–40’ easy', weighted:false}
      ]},
    { name:'Long Z2 + Mobility', type:'Aerobic Base',
      items:[
        {pid:'H25', name:'Conditioning — Long Z2', target:'75–100’ (90–120’ alt weeks)', weighted:false},
        {pid:'H26', name:'Mobility — Flow A/B/C', target:'30–40’', weighted:false}
      ]},
    { name:'Z2 / Technique + Strides', type:'Aerobic Base',
      items:[
        {pid:'H27', name:'Conditioning — Z2 + Strides', target:'40–50’ Z2 + 6×12s strides', weighted:false},
        {pid:'H28', name:'Mobility Micro', target:'5–10’', weighted:false}
      ]},
    { name:'Recovery / Yoga', type:'Recovery',
      items:[
        {pid:'H29', name:'Recovery', target:'Off or 30–40’ Z1', weighted:false},
        {pid:'H30', name:'Breathing/Yoga', target:'15–20’', weighted:false}
      ]}
  ];
}
function strengthWeekTemplate(q){
  const L = QUARTER_LIFTS[q];
  return [
    { name:'Strength A (DL/OHP/Chin) + VO₂', type:'Strength',
      items:[
        {pid:'S1', name:L.hinge, target:'4×4 heavy (~85%)', weighted:true},
        {pid:'S2', name:'Barbell Overhead Press', target:'4×4 heavy', weighted:true},
        {pid:'S3', name:'Weighted Chin-ups', target:'4×4 heavy', weighted:true},
        {pid:'S4', name:'Contrast — KB Swings', target:'3×10 explosive', weighted:true},
        {pid:'S5', name:'Assistance — DB Row', target:'3×10/arm', weighted:true},
        {pid:'S6', name:'Conditioning — VO₂ 4×4’/4’', target:'Very hard + WU/CD', weighted:false}
      ]},
    { name:'Z2 (Easy)', type:'Aerobic',
      items:[
        {pid:'S7', name:'Conditioning — Z2', target:'35–45’ easy', weighted:false},
        {pid:'S8', name:'Mobility (short holds)', target:'6–8’ post', weighted:false}
      ]},
    { name:'Strength B (SQ/BN/Row) + VO₂ Alt', type:'Strength',
      items:[
        {pid:'S9', name:L.squat, target:'4×4 heavy', weighted:true},
        {pid:'S10', name:'Barbell Bench Press', target:'4×4 heavy', weighted:true},
        {pid:'S11', name:'Bent-Over Row', target:'4×4 heavy', weighted:true},
        {pid:'S12', name:'Contrast — Box Jumps', target:'3×6 explosive', weighted:false},
        {pid:'S13', name:'Assistance — DB Split Squat', target:'3×8/leg', weighted:true},
        {pid:'S14', name:'Conditioning — VO₂ 6×3’/3’', target:'Hard', weighted:false}
      ]},
    { name:'Z2 (Easy) + Skills', type:'Aerobic',
      items:[
        {pid:'S15', name:'Conditioning — Z2', target:'30–40’ easy', weighted:false},
        {pid:'S16', name:'Technique — Med Ball / Skips', target:'10’ opt', weighted:false}
      ]},
    { name:'Strength C (Press/SQ/Pull) + 30:30s', type:'Strength',
      items:[
        {pid:'S17', name:'Barbell Bench or Incline Press', target:'4×4 heavy', weighted:true},
        {pid:'S18', name:(L.squat==='Back Squat'?'Front Squat':'Back Squat'), target:'4×4 heavy', weighted:true},
        {pid:'S19', name:'Pull-ups', target:'4×4 (weighted if strong)', weighted:true},
        {pid:'S20', name:'Contrast — Plyo Pushups', target:'3×8 explosive', weighted:false},
        {pid:'S21', name:'Assistance — DB RDL', target:'3×10', weighted:true},
        {pid:'S22', name:'Conditioning — 30:30s', target:'15–20 reps @ ~3–5k pace / 115–120% FTP', weighted:false}
      ]},
    { name:'Z2 Maintenance + Mobility', type:'Aerobic',
      items:[
        {pid:'S23', name:'Conditioning — Z2', target:'30–45’ easy', weighted:false},
        {pid:'S24', name:'Mobility — Flow C', target:'20–25’', weighted:false}
      ]},
    { name:'Recovery / Yoga', type:'Recovery',
      items:[
        {pid:'S25', name:'Recovery', target:'Off or 25–35’ Z1', weighted:false},
        {pid:'S26', name:'Breathing/Yoga', target:'15–20’', weighted:false}
      ]}
  ];
}
function deloadWeekTemplate(phase){
  const baseTests = [
    {pid:'T1', name:'Aerobic Base Test', target:'45–60’ Z2 HR-drift / MAF', weighted:false},
    {pid:'T2', name:'Long Z2 (optional)', target:'60–75’ easy', weighted:false}
  ];
  const strengthTests = [
    {pid:'T3', name:'VO₂ Test', target:'Best 5-min or 1.5-mile', weighted:false},
    {pid:'T4', name:'Strength Tests', target:'3–5RM SQ/BN/DL or E1RM', weighted:true}
  ];
  return [
    {name:'Deload — Lower', type:'Deload',
      items:[{pid:'D1', name:'Main Lower Pattern', target:'2× (top ~85–90% of prior), technique only', weighted:true},
             {pid:'D2', name:'Mobility', target:'10–15’', weighted:false}]},
    {name:'Deload — Upper', type:'Deload',
      items:[{pid:'D3', name:'Main Upper Pattern', target:'2× technique, no failure', weighted:true},
             {pid:'D4', name:'Mobility', target:'10–15’', weighted:false}]},
    {name:`Testing — ${phase==='Base'?'Aerobic Base':'VO₂/Strength'}`, type:'Testing',
      items: phase==='Base'? baseTests : strengthTests},
    {name:'Z1 / Recovery', type:'Recovery', items:[{pid:'D5', name:'Z1 Walk/Spin', target:'25–40’', weighted:false}]},
    {name:'Optional Drills', type:'Recovery', items:[{pid:'D6', name:'Breathing + Micro Mobility', target:'10–15’', weighted:false}]},
    {name:'Off', type:'Recovery', items:[]},
    {name:'Off', type:'Recovery', items:[]}
  ];
}

/* Block logic */
function blockForWeek(w){
  const mod = ((w-1) % 13) + 1;
  if(mod>=1 && mod<=6) return 'Hypertrophy';
  if(mod===7) return 'DeloadBase';
  if(mod>=8 && mod<=12) return 'Strength';
  return 'DeloadStrength';
}
function quarterIndexForWeek(w){ return Math.floor((w-1)/13); }

function generateAnnualPlan(){
  const weeks=[];
  for(let w=1; w<=52; w++){
    const blk = blockForWeek(w);
    const q = quarterIndexForWeek(w);
    let days = blk==='Hypertrophy' ? hypertrophyWeekTemplate(q)
             : blk==='Strength'    ? strengthWeekTemplate(q)
             : blk==='DeloadBase'  ? deloadWeekTemplate('Base')
             :                       deloadWeekTemplate('Strength');
    weeks.push({week:w, stage:blk, days});
  }
  state.program.weeks = weeks;
}

/* ------------ Sections model + migration ------------ */
// A Day now looks like:
// { name, type, sections: [ { title, items: [{pid,name,target,weighted}] } ] }

function ensureDaySections(day){
  if (!day) return day;
  if (!Array.isArray(day.sections)) {
    const items = Array.isArray(day.items) ? day.items : [];
    day.sections = items.length ? [{ title: 'Workout', items: items }] : [];
  }
  day.sections.forEach(sec => { if (!Array.isArray(sec.items)) sec.items = []; });
  return day;
}

function migrateProgramToSections() {
  const weeks = state.program?.weeks || [];
  let changed = false;
  weeks.forEach(w => {
    (w.days || []).forEach(d => {
      if (!Array.isArray(d.sections)) {
        ensureDaySections(d);
        changed = true;
      }
    });
  });
  if (changed) persistState();
}

/* ---------------- Date helpers ---------------- */
let _todayCache = null;
function currentWeekDayByAnchor(force=false){
  const now = isoToday();
  if(!force && _todayCache && _todayCache.key===now) return _todayCache.val;
  const start = new Date(state.programStart);
  const today = new Date(now);
  const diff = Math.max(0, Math.floor((today - start)/86400000));
  const weekNum = Math.floor(diff/7) + 1;
  const dayIdx = (diff % 7 + 7) % 7;
  const val = {weekNum: Math.min(52, Math.max(1, weekNum)), dayIdx};
  _todayCache = {key: now, val};
  return val;
}
function keyFor(weekIdx, dayIdx){ return `w${weekIdx+1}:d${dayIdx+1}`; }

/* ---------------- Weight logs ---------------- */
function getWeightRec(date=isoToday()){ return state.weightLogs[date] || {}; }
function setWeight(date, when, value){
  (state.weightLogs[date] || (state.weightLogs[date]={}))[when] = value;
  persistState();
}

/* ---------------- Workout logs ---------------- */
function ensureTodayEntry(){
  const date = isoToday();
  let log = state.workoutLogs.find(x=>x.date===date);
  if(!log){ log={date, entries:[]}; state.workoutLogs.push(log); }
  return log;
}
function getEntry(log, pid, name){
  let e = log.entries.find(x=>x.pid===pid);
  if(!e){ e={pid, name, sets:[], notes:''}; log.entries.push(e); }
  return e;
}

/* ---------------- Smart load recommendation ---------------- */
function parsePercentFromTarget(target){
  const m = String(target||'').match(/(\d{2,3})\s*%/);
  return m ? (+m[1]/100) : null;
}
function estimate1RM_fromSet(w, reps){
  if(!w || !reps) return null;
  return w * (1 + reps/30); // Epley
}
function roundToPlate(w){
  if(state.unit==='lb'){ return Math.round(w/2.5)*2.5; }
  return Math.round(w/1)*1;
}
function lastSetForPid(pid, loadType){
  for(let i=state.workoutLogs.length-1; i>=0; i--){
    const ent = state.workoutLogs[i].entries?.find(e=>e.pid===pid);
    if(ent){
      for(let j=ent.sets.length-1; j>=0; j--){
        const s = ent.sets[j];
        if(!loadType || s.loadType===loadType){
          if(isFinite(s.w) && s.reps>0) return s;
        }
      }
    }
  }
  return null;
}
function recommendLoad(pid, item){
  if(!item.weighted) return null;
  const pct = parsePercentFromTarget(item.target);
  const prev = lastSetForPid(pid, null);
  const msg = { text:null, firstTime:false };
  let rec = null;

  if(prev){
    const oneRM = estimate1RM_fromSet(prev.w, prev.reps);
    if(pct && oneRM){
      rec = roundToPlate(oneRM * pct);
      msg.text = `Based on last ${prev.w}${state.unit} × ${prev.reps} (est 1RM ${roundToPlate(oneRM)}), try ~${rec}${state.unit}.`;
    }else{
      rec = roundToPlate(prev.w + (state.unit==='lb'? 2.5 : 1));
      msg.text = `Last time you used ${prev.w}${state.unit} × ${prev.reps}. Consider ~${rec}${state.unit}.`;
    }
  }else{
    msg.text = `First time on this movement. Your first logged set will estimate 1RM—give it your best quality effort.`;
    msg.firstTime = true;
  }
  return {weight: rec, note: msg};
}

/* ---------------- Charts (HiDPI + multi-series + multi-point tooltip) ---------------- */
function setupHiDPICanvas(cv){
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = cv.getBoundingClientRect();
  if(cv.__dprApplied === dpr && cv.width === Math.round(rect.width*dpr) && cv.height === Math.round(rect.height*dpr)) return dpr;
  cv.width = Math.round(rect.width * dpr);
  cv.height = Math.round(rect.height * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cv.__dprApplied = dpr;
  return dpr;
}

// Helper to extract numeric y from number or {w,...}
function valY(x){ return (x && typeof x==='object') ? x.w : x; }

function drawMultiLineChart(canvasId, series, labels){
  const cv = qs('#'+canvasId); if(!cv) return;
  setupHiDPICanvas(cv);
  const rect = cv.getBoundingClientRect();
  const ctx = cv.getContext('2d');

  const pad=24, W=rect.width, H=rect.height, plotW=W-pad*2, plotH=H-pad*2;

  // Flatten values to get global min/max (handle number, object with w, or array of those)
  const vals=[];
  series.forEach(s => (s.pts||[]).forEach(v=>{
    if(Array.isArray(v)) v.forEach(x=>{ const y = valY(x); if(isFinite(y)) vals.push(y); });
    else { const y=valY(v); if(isFinite(y)) vals.push(y); }
  }));
  ctx.clearRect(0,0,W,H);
  if(!vals.length){ ctx.fillStyle='#94a3b8'; ctx.fillText('No data yet', 10, 20); cv.__chart=null; return; }

  const minY=Math.min(...vals), maxY=Math.max(...vals);
  const spanY=(maxY-minY)||1, lo=minY-spanY*0.1, hi=maxY+spanY*0.1;
  const xPix = i => pad + (plotW * (i/((labels.length-1)||1)));
  const yPix = v => H - pad - (plotH * ((v-lo)/((hi-lo)||1)));
  const xs = labels.map((_,i)=>xPix(i));

  // axes
  ctx.strokeStyle='#223047'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(pad, pad); ctx.lineTo(pad, H-pad); ctx.lineTo(W-pad, H-pad); ctx.stroke();

  // series lines (connect daily averages) + points (every set)
  series.forEach(s=>{
    const avg = (s.pts||[]).map(v=>{
      if(Array.isArray(v)){
        const nums = v.map(valY).filter(x=>isFinite(x));
        if(!nums.length) return NaN;
        return nums.reduce((a,b)=>a+b,0)/nums.length;
      }
      const y = valY(v);
      return isFinite(y)? y : NaN;
    });

    // line
    ctx.strokeStyle=s.color; ctx.lineWidth=2; ctx.beginPath();
    let pen=false;
    avg.forEach((v,i)=>{
      if(!isFinite(v)){ pen=false; return; }
      const x=xs[i], y=yPix(v);
      if(!pen){ ctx.moveTo(x,y); pen=true; } else ctx.lineTo(x,y);
    });
    ctx.stroke();

    // points (all sets) with small jitter
    const jitter = 4;
    ctx.fillStyle=s.color;
    (s.pts||[]).forEach((v,i)=>{
      if(Array.isArray(v)){
        const nums = v.map(valY).filter(x=>isFinite(x));
        nums.forEach((p,k)=>{
          const x = xs[i] + ((k - (nums.length-1)/2) * (jitter / Math.max(1,nums.length-1||1)));
          const y = yPix(p);
          ctx.beginPath(); ctx.arc(x,y,2.5,0,Math.PI*2); ctx.fill();
        });
      }else{
        const yv = valY(v);
        if(!isFinite(yv)) return;
        const x=xs[i], y=yPix(yv);
        ctx.beginPath(); ctx.arc(x,y,2.5,0,Math.PI*2); ctx.fill();
      }
    });
  });

  // sparse labels
  ctx.fillStyle='#94a3b8'; ctx.font='12px system-ui';
  const step = Math.max(1, Math.ceil(labels.length/6));
  labels.forEach((lab,i)=>{ if(i%step) return; const x=xs[i]; ctx.fillText(lab, Math.max(pad, x-40), H-6); });

  // store state & hover
  cv.__chart = {series, labels, xs, yPix, pad, lo, hi, minY, maxY};
  attachTooltipHandlers(cv);
}

function attachTooltipHandlers(cv){
  if(cv.__hasTip) return;
  cv.__hasTip = true;

  let tip = document.getElementById('chartTip');
  if(!tip){
    tip = document.createElement('div'); tip.id='chartTip';
    Object.assign(tip.style, {
      position:'fixed', pointerEvents:'none', zIndex:1000, display:'none',
      background:'#0b1220cc', border:'1px solid #223047', borderRadius:'8px',
      padding:'6px 8px', font:'12px system-ui', color:'#e5e7eb', backdropFilter:'blur(4px)'
    });
    document.body.appendChild(tip);
  }

  let lastIdx=null;
  function redrawWithHighlights(idx){
    if(idx===lastIdx) return;
    lastIdx=idx;
    const st = cv.__chart; if(!st) return;
    drawMultiLineChart(cv.id, st.series, st.labels);
    if(idx==null) return;
    const ctx = cv.getContext('2d');
    st.series.forEach((s)=>{
      const v = (s.pts||[])[idx];
      const vals = Array.isArray(v) ? v.map(valY).filter(x=>isFinite(x)) : (isFinite(valY(v))? [valY(v)] : []);
      if(!vals.length) return;
      const avg = vals.reduce((a,b)=>a+b,0)/vals.length;
      const x = st.xs[idx], y = st.yPix(avg);
      ctx.save();
      ctx.fillStyle = s.color; ctx.globalAlpha=.16;
      ctx.beginPath(); ctx.arc(x,y,10,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha=1; ctx.strokeStyle=s.color; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(x,y,5,0,Math.PI*2); ctx.stroke();
      ctx.restore();
    });
  }

  cv.addEventListener('mousemove',(e)=>{
    const st = cv.__chart; if(!st) return;
    const rect = cv.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    // nearest column
    let idx=0, best=1e9;
    for(let i=0;i<st.xs.length;i++){
      const d=Math.abs(st.xs[i]-mx); if(d<best){ best=d; idx=i; }
    }
    // tooltip content
    const unit = (state?.unit)||'lb';
    const rows=[];
    st.series.forEach(s=>{
      const v = (s.pts||[])[idx];
      let items = [];
      if(Array.isArray(v)){
        items = v.filter(p=>isFinite(valY(p))).map(p=>{
          if(p && typeof p==='object'){
            const base = `${p.w} ${unit}`;
            const reps = p.reps? ` × ${p.reps}` : '';
            const rpe  = (p.rpe!=null && p.rpe!=='') ? ` @ RPE ${p.rpe}` : '';
            return base + reps + rpe;
          }
          return `${p} ${unit}`;
        });
      }else if(isFinite(valY(v))){
        if(v && typeof v==='object'){
          const base = `${v.w} ${unit}`;
          const reps = v.reps? ` × ${v.reps}` : '';
          const rpe  = (v.rpe!=null && v.rpe!=='') ? ` @ RPE ${v.rpe}` : '';
          items = [base + reps + rpe];
        }else{
          items = [`${v} ${unit}`];
        }
      }
      if(items.length){
        rows.push(
          `<div style="margin:2px 0">
             <div style="display:flex;gap:8px;align-items:center;">
               <span style="width:10px;height:10px;border-radius:50%;background:${s.color};display:inline-block"></span>
               <span style="font-weight:600">${s.label||'Series'}</span>
             </div>
             <div style="opacity:.9;margin-left:18px">${items.join(' · ')}</div>
           </div>`
        );
      }
    });
    if(!rows.length){ tip.style.display='none'; redrawWithHighlights(null); return; }
    tip.innerHTML = `<div style="opacity:.8;margin-bottom:4px">${st.labels[idx]||''}</div>${rows.join('')}`;

    // position
    const pad=10; let tx=e.clientX+pad, ty=e.clientY+pad;
    const vw=innerWidth, vh=innerHeight, tw=tip.offsetWidth||160, th=tip.offsetHeight||60;
    if(tx+tw+12>vw) tx=e.clientX-tw-pad;
    if(ty+th+12>vh) ty=e.clientY-th-pad;
    tip.style.left=tx+'px'; tip.style.top=ty+'px'; tip.style.display='block';

    redrawWithHighlights(idx);
  });

  cv.addEventListener('mouseleave',()=>{ tip.style.display='none'; redrawWithHighlights(null); });
}

/* ---------------- Progress plotting (multi-point per day) ---------------- */
function drawProgress(pid){
  const logs = state.workoutLogs.slice().sort((a,b)=>a.date.localeCompare(b.date));
  const labels=[];
  const byType = {};
  const types = ['barbell','dumbbell','machine','bodyweight'];
  types.forEach(t=> byType[t] = []);

  logs.forEach(d=>{
    const e = d.entries?.find(x=>x.pid===pid);
    if(!e) return;
    labels.push(d.date);
    types.forEach(t=> byType[t].push([]));
    e.sets.forEach(s=>{
      if(s.w!=null && isFinite(s.w)){
        const lt = s.loadType || 'barbell';
        if(!byType[lt]) byType[lt] = labels.map(()=>[]);
        byType[lt][labels.length-1].push({w:s.w, reps:s.reps, rpe:s.rpe});
      }
    });
  });

  const series=[];
  const palette = state.colors.loadType;
  Object.keys(byType).forEach((lt,i)=>{
    const pts = (byType[lt]||[]);
    const hasData = pts.some(arr => Array.isArray(arr) ? arr.some(v=>isFinite(valY(v))) : isFinite(valY(arr)));
    if(hasData){
      const color = palette[lt] || state.colors.series[i % state.colors.series.length];
      series.push({label: lt, color, pts});
    }
  });

  drawMultiLineChart(`cv_${pid}`, series, labels);
}

function drawWeightTrend(){
  const entries = Object.entries(state.weightLogs).sort((a,b)=>a[0].localeCompare(b[0]));
  const labels = entries.map(([d])=>d);
  const am = entries.map(([_,v])=> isFinite(v.am)? v.am : NaN);
  const pm = entries.map(([_,v])=> isFinite(v.pm)? v.pm : NaN);
  const series = [
    {label:'AM', color:'#38bdf8', pts:am},
    {label:'PM', color:'#22d3ee', pts:pm}
  ];
  drawMultiLineChart('wtTrend', series, labels);
}

/* ---------------- Modal open/close ---------------- */
function openModal(){ const o = qs('.modalOverlay'); if(!o) return; o.classList.add('open'); o.style.display='flex'; }
function closeModal(){ const o = qs('.modalOverlay'); if(!o) return; o.classList.remove('open'); setTimeout(()=>{ o.style.display='none'; }, 220); }

/* ---------------- Rendering: Home ---------------- */
function renderHome(){
  const c=qs('#content'); c.innerHTML='';
  const card=ce('div','card');
  const h=ce('h2'); h.textContent='Home'; card.append(h);

  const sub=ce('div','smallmut'); sub.textContent = `Program starts ${state.programStart} • Today is ${isoToday()}`;
  card.append(sub);

  // Weight quick log
  const today = isoToday(); const rec = getWeightRec(today);
  const row = ce('div','row');

  // AM
  const amWrap = ce('div','row');
  const am = ce('input','input'); am.placeholder=`AM weight (${state.unit})`; am.id='wAM';
  if(rec.am!=null){ am.value=rec.am; am.setAttribute('disabled',''); }
  const amBtn = ce('button','btn small'); amBtn.textContent = rec.am!=null? 'Edit':'Log AM';
  amBtn.onclick=()=>{
    if(rec.am!=null && amBtn.textContent==='Edit'){ amBtn.textContent='Save'; am.removeAttribute('disabled'); am.focus(); return; }
    const v = parseFloat(am.value); if(!isFinite(v)){ showToast('Enter AM weight'); return; }
    setWeight(today,'am',v); am.setAttribute('disabled',''); amBtn.textContent='Edit'; showToast('AM weight logged');
    const trend = qs('#wtTrend'); if(trend) drawWeightTrend();
  };
  amWrap.append(am, amBtn);

  // PM
  const pmWrap = ce('div','row');
  const pm = ce('input','input'); pm.placeholder=`PM weight (${state.unit})`; pm.id='wPM';
  if(rec.pm!=null){ pm.value=rec.pm; pm.setAttribute('disabled',''); }
  const pmBtn = ce('button','btn small'); pmBtn.textContent = rec.pm!=null? 'Edit':'Log PM';
  pmBtn.onclick=()=>{
    if(rec.pm!=null && pmBtn.textContent==='Edit'){ pmBtn.textContent='Save'; pm.removeAttribute('disabled'); pm.focus(); return; }
    const v = parseFloat(pm.value); if(!isFinite(v)){ showToast('Enter PM weight'); return; }
    setWeight(today,'pm',v); pm.setAttribute('disabled',''); pmBtn.textContent='Edit'; showToast('PM weight logged');
    const trend = qs('#wtTrend'); if(trend) drawWeightTrend();
  };
  pmWrap.append(pm, pmBtn);

  row.append(amWrap, pmWrap);
  card.append(row);

  // Today's workout summary
  const {weekNum, dayIdx} = currentWeekDayByAnchor();
  const week = state.program.weeks[weekNum-1];
  const day = week?.days?.[dayIdx];
  if(day){
    ensureDaySections(day);
    const sum=ce('div','card');
    const sh=ce('h2'); sh.textContent="Today's Workout"; sum.append(sh);
    const st=ce('div','tag'); st.textContent = `${week.stage}`; sum.append(st);

    const previewItems = (day.sections?.[0]?.items || []).slice(0, 6);
    (previewItems||[]).forEach(it=>{
      const kv=ce('div'); kv.className='kv';
      kv.innerHTML = `<span>${it.name}</span><span class="smallmut">${it.target}</span>`;
      sum.append(kv);
    });
    const go=ce('div','row'); const btn=ce('button','btn'); btn.textContent='Open Today';
    btn.onclick=()=>{ document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active')); qs('[data-tab="today"]').classList.add('active'); render(); };
    go.append(btn); sum.append(ce('div','divider'), go);
    card.append(sum);
  }

  c.append(card);
  enhanceButtonsForRipple();
}

/* ---------------- Rendering: Today (sections-aware) ---------------- */
function renderToday(){
  const c=qs('#content'); c.innerHTML='';
  const {weekNum, dayIdx} = currentWeekDayByAnchor();
  const week = state.program.weeks[weekNum-1];
  const day = week?.days?.[dayIdx];
  if(!day){ c.textContent='No workout scheduled.'; return; }
  ensureDaySections(day);

  const header=ce('div','row');
  const h=ce('h2'); h.textContent = `${day.name} (Week ${weekNum} • ${week.stage})`; header.append(h);
  const tg=ce('span','tag'); tg.textContent=week.stage; header.append(tg);
  c.append(header);

  // Done / Reopen
  const key = keyFor(weekNum-1, dayIdx);
  const ctrl = ce('div','row');
  const doneBtn = ce('button','btn small');
  doneBtn.textContent = state.doneFlags[key] ? 'Reopen Workout' : 'Mark Done';
  doneBtn.onclick = ()=>{
    if(state.doneFlags[key]){
      delete state.doneFlags[key];
      showToast('Workout reopened');
    }else{
      state.doneFlags[key] = true;
      showToast('Workout marked done');
      const r = document.body.getBoundingClientRect();
      confettiBurst(r.width-140, 100);
    }
    persistState();
    renderProgram(); // sync
    renderToday();
  };
  ctrl.append(doneBtn);
  c.append(ctrl);

  if(state.doneFlags[key]){
    const doneCard = ce('div','card');
    const txt = ce('div'); txt.innerHTML = `<b>Nice work!</b> This session is complete.`;
    const sub = ce('div','smallmut'); sub.textContent = `You can reopen to make changes.`;
    doneCard.append(txt, sub);
    c.append(doneCard);
    enhanceButtonsForRipple();
    return;
  }

  // Loggable sections & items
  const log = ensureTodayEntry();

  (day.sections||[]).forEach((sec, sIdx)=>{
    // Section title
    if (sec.title) {
      const st = ce('div','smallmut'); st.textContent = sec.title; st.style.marginTop='10px';
      c.append(st);
    }

    (sec.items||[]).forEach(item=>{
      const card=ce('div','card');
      const head=ce('div','row'); head.innerHTML=`<b>${item.name}</b> <span class="smallmut">Target: ${item.target}</span>`;
      card.append(head);

      const row=ce('div','setlog'); row.id=`row_${item.pid}`;

      // Load type dropdown (only for weighted)
      let loadTypeSel='';
      if(item.weighted){
        loadTypeSel = `
          <select id="lt_${item.pid}" class="input" style="min-width:120px">
            <option value="barbell">Barbell</option>
            <option value="dumbbell">Dumbbell (per side)</option>
            <option value="machine">Machine / Cable</option>
            <option value="bodyweight">Bodyweight</option>
          </select>
        `;
      }

      row.innerHTML = `
        ${loadTypeSel}
        <input id="w_${item.pid}" class="input" placeholder="Weight (${state.unit})" ${item.weighted?'':'disabled'}>
        <input id="r_${item.pid}" class="input" placeholder="Reps">
        <input id="rp_${item.pid}" class="input" placeholder="RPE">
        <button class="btn small" id="log_${item.pid}">Log set</button>
        <span class="link mut" id="vp_${item.pid}">View progress</span>
      `;
      card.append(row);

      // Smart recommendation
      if(item.weighted){
        const recDiv = ce('div','smallmut'); recDiv.id=`rec_${item.pid}`;
        const rec = recommendLoad(item.pid, item);
        if(rec && rec.note) recDiv.textContent = rec.note.text || '';
        card.append(recDiv);
        const ltEl = row.querySelector(`#lt_${item.pid}`);
        if(ltEl){
          ltEl.addEventListener('change', ()=>{
            const r = recommendLoad(item.pid, item);
            if(r && r.note) qs(`#rec_${item.pid}`).textContent = r.note.text || '';
          });
        }
      }

      // progress canvas
      const progBox=ce('div','canvasBox'); progBox.style.display='none';
      const legend=ce('div','legend'); legend.innerHTML = `
        <span class="row" style="gap:6px"><span class="dot" style="background:#38bdf8"></span> barbell</span>
        <span class="row" style="gap:6px"><span class="dot" style="background:#22d3ee"></span> dumbbell</span>
        <span class="row" style="gap:6px"><span class="dot" style="background:#10b981"></span> machine</span>
        <span class="row" style="gap:6px"><span class="dot" style="background:#f59e0b"></span> bodyweight</span>
      `;
      progBox.append(legend);
      const cv=document.createElement('canvas'); cv.style.width='100%'; cv.style.height='200px'; cv.width=800; cv.height=200; cv.id=`cv_${item.pid}`;
      progBox.append(cv); card.append(progBox);

      const chipsWrap=ce('div'); chipsWrap.id=`chips_${item.pid}`; card.append(chipsWrap);
      c.append(card);

      // Wire up actions
      qs(`#log_${item.pid}`).onclick = () => addOrSaveSet(item, log);
      qs(`#vp_${item.pid}`).onclick = () => {
        progBox.style.display = (progBox.style.display==='none')? 'block':'none';
        if(progBox.style.display==='block') drawProgress(item.pid);
      };

      // Render existing set chips + edit/delete links
      const e = getEntry(log, item.pid, item.name);
      renderSetChips(item.pid, e);
    });
  });

  enhanceButtonsForRipple();
}

function addOrSaveSet(item, log){
  const pid = item.pid;
  const e = getEntry(log, pid, item.name);
  const ltEl = qs(`#lt_${pid}`);
  const loadType = item.weighted ? (ltEl?.value || 'barbell') : 'bodyweight';
  const w = item.weighted ? parseFloat(qs(`#w_${pid}`).value || '0') : null;
  const reps = parseInt(qs(`#r_${pid}`).value || '0',10);
  const rpe = parseFloat(qs(`#rp_${pid}`).value || '0');
  if(!reps || reps<1){ showToast('Enter reps'); return; }

  if(__editing && __editing.pid===pid){
    // Save edit
    e.sets[__editing.idx] = {w:isFinite(w)?w:null, reps, rpe:isFinite(rpe)?rpe:null, loadType};
    __editing = null;
    qs(`#log_${pid}`).textContent = 'Log set';
    showToast('Set updated');
  }else{
    // Add set
    e.sets.push({w:isFinite(w)?w:null, reps, rpe:isFinite(rpe)?rpe:null, loadType});
    showToast('Set logged');
  }

  persistState();
  renderSetChips(pid, e);
  // refresh rec line if first time
  if(item.weighted){
    const rec = recommendLoad(pid, item);
    if(rec && rec.note) qs(`#rec_${pid}`).textContent = rec.note.text || '';
  }
  // refresh progress if open
  const cv = qs(`#cv_${pid}`); if(cv && cv.parentElement && cv.parentElement.style.display!=='none') drawProgress(pid);

  qs(`#r_${pid}`).value=''; qs(`#w_${pid}`).value=''; qs(`#rp_${pid}`).value='';
  qs(`#r_${pid}`).focus();
}

function editSet(pid, idx){
  const log = ensureTodayEntry();
  const e = getEntry(log, pid);
  const s = e.sets[idx];
  if(!s) return;
  qs(`#w_${pid}`)?.removeAttribute('disabled');
  qs(`#w_${pid}`).value = (s.w!=null? s.w : '');
  qs(`#r_${pid}`).value = s.reps||'';
  qs(`#rp_${pid}`).value = (s.rpe!=null? s.rpe : '');
  const lt = qs(`#lt_${pid}`); if(lt && s.loadType) lt.value = s.loadType;
  __editing = {pid, idx};
  const btn = qs(`#log_${pid}`); if(btn) btn.textContent='Save set';
  showToast(`Editing set ${idx+1}`);
}

// delete a specific set
function deleteSet(pid, idx){
  const log = ensureTodayEntry();
  const e = getEntry(log, pid);
  if(!e || !e.sets || !e.sets[idx]) return;
  e.sets.splice(idx, 1);
  persistState();
  renderSetChips(pid, e);
  const cv = qs(`#cv_${pid}`); if(cv && cv.parentElement && cv.parentElement.style.display!=='none') drawProgress(pid);
  showToast('Set deleted');
}

function renderSetChips(pid, e){
  const wrap = qs(`#chips_${pid}`); if(!wrap) return;
  wrap.innerHTML='';
  const chips=ce('div','chips');
  e.sets.forEach((s,idx)=>{
    const row = ce('div','row'); row.style.gap='8px'; row.style.alignItems='center';
    const chip=ce('span','chip');
    const wstr = s.w!=null? `${s.w} ${state.unit}` : '—';
    const reps = s.reps!=null? ` × ${s.reps}` : '';
    const rpe  = s.rpe!=null? ` @ RPE ${s.rpe}` : '';
    chip.innerHTML = `Set ${idx+1}: <b>${wstr}${reps}${rpe}</b> <span class="smallmut">(${s.loadType||'barbell'})</span>`;
    const edit = ce('span','link'); edit.textContent='✏️ edit'; edit.onclick=()=>editSet(pid,idx);
    const del  = ce('span','link'); del.textContent='🗑️ delete'; del.onclick=()=>deleteSet(pid,idx);
    row.append(chip, edit, del);
    chips.append(row);
  });
  wrap.append(chips);
}

/* ---------------- Rendering: Program ---------------- */
function renderProgram(){
  const c=qs('#content'); c.innerHTML='';
  (state.program.weeks||[]).forEach(blk=>{
    const wrap=ce('div','card');
    const bar=ce('div','row');
    const q = quarterIndexForWeek(blk.week)+1;
    const tag=ce('div'); tag.innerHTML = `<span class="tag">WEEK #${blk.week} (Q${q})</span> <span class="tag">${blk.stage.toUpperCase()}</span>`;
    bar.append(tag); wrap.append(bar);

    const grid=ce('div','grid');
    (blk.days||[]).forEach((d,i)=>{
      ensureDaySections(d);
      const card=ce('div','card');
      card.dataset.weekIdx = (blk.week-1);
      card.dataset.dayIdx = i;
      card.setAttribute('data-week-card','');

      const head=ce('div','row'); head.innerHTML=`<div class="tag">DAY ${i+1}</div>`; card.append(head);
      const title=ce('div'); title.style.fontWeight='600'; title.style.marginTop='6px'; title.textContent=d.name; card.append(title);

      const key = keyFor(blk.week-1, i);
      if(state.doneFlags[key]) card.classList.add('done'); else card.classList.remove('done');

      card.addEventListener('click', ()=> openDayModal(blk.week-1, i));
      grid.append(card);
    });
    wrap.append(grid);
    c.append(wrap);
  });

  attachProgramPreviews();
  enhanceButtonsForRipple();
}

/* Hover previews */
function attachProgramPreviews(){
  document.querySelectorAll('[data-week-card]').forEach(card=>{
    card.addEventListener('mouseenter', ()=>{
      const wi = +card.dataset.weekIdx, di = +card.dataset.dayIdx;
      const day = state.program.weeks[wi]?.days?.[di]; if(!day) return;
      ensureDaySections(day);
      let tip = document.getElementById('dayPeek');
      if(!tip){
        tip = document.createElement('div'); tip.id='dayPeek';
        Object.assign(tip.style, {
          position:'fixed', zIndex:999, pointerEvents:'none', display:'none',
          background:'#0b1220cc', border:'1px solid #223047', borderRadius:'10px',
          padding:'8px 10px', color:'#e5e7eb', font:'12px system-ui', backdropFilter:'blur(4px)'
        });
        document.body.appendChild(tip);
      }
      const previewItems = (day.sections?.[0]?.items || day.items || []).slice(0,2);
      const items = previewItems.map(it=>`<div>${it.name}<span class="mut" style="margin-left:6px">${it.target}</span></div>`).join('');
      tip.innerHTML = `<b>${day.name}</b>${items ? '<div style="margin-top:6px">'+items+'</div>':''}`;
      const r = card.getBoundingClientRect();
      tip.style.left = (r.left + 8) + 'px';
      tip.style.top  = (r.top - 8) + 'px';
      tip.style.display='block';
    });
    card.addEventListener('mouseleave', ()=>{
      const tip = document.getElementById('dayPeek'); if(tip) tip.style.display='none';
    });
  });
}

/* ---------------- Day modal (sections aware) ---------------- */
function openDayModal(weekIdx, dayIdx){
  const overlay = qs('.modalOverlay');
  const modal = overlay.querySelector('.modal');
  const day = state.program.weeks[weekIdx]?.days?.[dayIdx];
  if(!day) return;
  ensureDaySections(day);

  modal.innerHTML = '';
  const head = ce('div','row');
  const h = ce('h3'); h.textContent = `Week ${weekIdx+1} • Day ${dayIdx+1} — ${day.name}`;
  const x = ce('button','closeBtn'); x.textContent='Close'; x.onclick=closeModal;
  head.append(h,x); modal.append(head);

  const key = keyFor(weekIdx, dayIdx);
  const doneBtn = ce('button','btn small'); doneBtn.textContent = state.doneFlags[key] ? 'Reopen' : 'Mark Done';
  doneBtn.onclick=()=>{
    if(state.doneFlags[key]) delete state.doneFlags[key];
    else{
      state.doneFlags[key]=true;
      const r = document.body.getBoundingClientRect();
      confettiBurst(r.width-140, 100);
    }
    persistState();
    doneBtn.textContent = state.doneFlags[key] ? 'Reopen' : 'Mark Done';
    renderProgram();
    renderToday();
  };
  modal.append(doneBtn);

  modal.append(ce('div','divider'));

  (day.sections||[]).forEach(sec=>{
    const label = ce('div','mut'); label.textContent = sec.title || 'Section';
    modal.append(label);
    (sec.items||[]).forEach(it=>{
      const row = ce('div','item');
      row.innerHTML = `<div><b>${it.name}</b><div class="mut">${it.target}</div></div>`;
      modal.append(row);
    });
  });

  openModal();
}

/* ---------------- Rendering: Profile ---------------- */
function renderProfile(){
  const c=qs('#content'); c.innerHTML='';
  const card=ce('div','card');
  const h=ce('h2'); h.textContent='Profile'; card.append(h);

  const trend=ce('div','stack');
  const tit=ce('div'); tit.innerHTML='<b>Weight Trend</b> <span class="smallmut">(AM/PM)</span>'; trend.append(tit);
  const box=ce('div','canvasBox'); const cv=document.createElement('canvas');
  cv.style.width='100%'; cv.style.height='200px'; cv.width=900; cv.height=200; cv.id='wtTrend'; box.append(cv);
  const legend=ce('div','legend');
  legend.innerHTML = `
    <span class="row" style="gap:6px"><span class="dot" style="background:#38bdf8"></span> AM</span>
    <span class="row" style="gap:6px"><span class="dot" style="background:#22d3ee"></span> PM</span>`;
  box.append(legend);
  trend.append(box);
  card.append(trend);

  c.append(card);
  drawWeightTrend();
  enhanceButtonsForRipple();
}

/* ---------------- CRUD helpers for Builder ---------------- */
function addWeek(afterIndex = state.program.weeks.length - 1) {
  const weekNum = (state.program.weeks?.length || 0) + 1;
  const stage = blockForWeek(weekNum);
  const newWeek = { week: weekNum, stage, days: [] };
  state.program.weeks.splice(afterIndex + 1, 0, newWeek);
  // renumber subsequent weeks
  state.program.weeks.forEach((w,i) => w.week = i + 1);
  persistState();
  return afterIndex + 1;
}

function removeWeek(weekIdx) {
  if (weekIdx < 0 || weekIdx >= state.program.weeks.length) return;
  state.program.weeks.splice(weekIdx, 1);
  state.program.weeks.forEach((w,i) => w.week = i + 1);
  persistState();
}

function addDay(weekIdx, name='Custom Day', type='Custom') {
  const week = state.program.weeks[weekIdx];
  if (!week) return;
  const day = { name, type, sections: [] };
  week.days.push(day);
  persistState();
  return week.days.length - 1;
}

function removeDay(weekIdx, dayIdx) {
  const week = state.program.weeks[weekIdx];
  if (!week || dayIdx<0 || dayIdx>=week.days.length) return;
  week.days.splice(dayIdx, 1);
  persistState();
}

function addSection(weekIdx, dayIdx, title='Workout') {
  const day = state.program.weeks[weekIdx]?.days?.[dayIdx];
  if (!day) return;
  ensureDaySections(day);
  day.sections.push({ title, items: [] });
  persistState();
  return day.sections.length - 1;
}

function removeSection(weekIdx, dayIdx, sectionIdx) {
  const day = state.program.weeks[weekIdx]?.days?.[dayIdx];
  if (!day || !day.sections || sectionIdx<0 || sectionIdx>=day.sections.length) return;
  day.sections.splice(sectionIdx, 1);
  persistState();
}

function addItem(weekIdx, dayIdx, sectionIdx, item) {
  const sec = state.program.weeks[weekIdx]?.days?.[dayIdx]?.sections?.[sectionIdx];
  if (!sec) return;
  const pid = item.pid || (crypto?.randomUUID?.() || ('C' + Math.random().toString(36).slice(2,8)));
  const safe = {
    pid,
    name: item.name || 'New Exercise',
    target: item.target || '',
    weighted: !!item.weighted
  };
  sec.items.push(safe);
  persistState();
}

function removeItem(weekIdx, dayIdx, sectionIdx, itemIdx) {
  const sec = state.program.weeks[weekIdx]?.days?.[dayIdx]?.sections?.[sectionIdx];
  if(!sec || itemIdx<0 || itemIdx>=sec.items.length) return;
  sec.items.splice(itemIdx, 1);
  persistState();
}

function moveArrayItem(arr, from, to){
  if (!arr || from===to || from<0 || to<0 || from>=arr.length || to>=arr.length) return;
  const [x] = arr.splice(from,1); arr.splice(to,0,x);
}

/* ---------------- Rendering: Builder (local admin) ---------------- */
function renderBuilder(){
  const c = qs('#content'); c.innerHTML = '';

  const head = ce('div','row');
  const h = ce('h2'); h.textContent = 'Plan Builder (Local)';
  const sub = ce('div','smallmut'); sub.textContent = 'Add / remove Weeks, Days, Sections, and Items. Changes are saved to localStorage.';
  head.append(h);
  c.append(head, sub);

  // Controls row
  const tools = ce('div','card');
  const row1 = ce('div','row');

  // Week selector
  const weekSel = ce('select','input');
  (state.program.weeks||[]).forEach((w,i)=>{
    const opt = ce('option'); opt.value = i; opt.textContent = `Week ${w.week} (${w.stage})`;
    weekSel.append(opt);
  });
  if(!state.program.weeks.length){
    addWeek(-1);
    const opt = ce('option'); opt.value = 0; opt.textContent = `Week 1 (${state.program.weeks[0].stage})`;
    weekSel.append(opt);
  }

  const addWeekBtn = ce('button','btn small'); addWeekBtn.textContent = '+ Add Week';
  addWeekBtn.onclick = ()=>{
    const idx = addWeek(+weekSel.value);
    renderBuilder();
    showToast(`Week ${idx+1} added`);
  };

  const delWeekBtn = ce('button','btn small'); delWeekBtn.textContent = '− Remove Week';
  delWeekBtn.onclick = ()=>{
    const wi = +weekSel.value;
    removeWeek(wi);
    renderBuilder();
    showToast('Week removed');
  };

  row1.append(weekSel, addWeekBtn, delWeekBtn);
  tools.append(row1);
  c.append(tools);

  // Day list for selected week
  const wi = +weekSel.value || 0;
  const week = state.program.weeks[wi];

  const daysCard = ce('div','card');
  const dHead = ce('div','row');
  const dTit = ce('div'); dTit.innerHTML = `<b>Days for Week ${week.week}</b>`;
  const addDayBtn = ce('button','btn small'); addDayBtn.textContent = '+ Add Day';
  addDayBtn.onclick = ()=>{
    const name = prompt('Day name?', 'Custom Day');
    const type = prompt('Day type?', 'Custom');
    const di = addDay(wi, name||'Custom Day', type||'Custom');
    renderBuilder();
    showToast(`Day ${di+1} added`);
  };
  dHead.append(dTit, addDayBtn);
  daysCard.append(dHead);

  (week.days||[]).forEach((day, di)=>{
    ensureDaySections(day);
    const card = ce('div','card');

    // Day header
    const dh = ce('div','row');
    const tag = ce('div','tag'); tag.textContent = `Day ${di+1}`;
    const nameInp = ce('input','input'); nameInp.value = day.name; nameInp.style.minWidth='220px';
    nameInp.onchange = ()=>{ day.name = nameInp.value; persistState(); };
    const typeInp = ce('input','input'); typeInp.value = day.type||''; typeInp.placeholder='Type';
    typeInp.onchange = ()=>{ day.type = typeInp.value; persistState(); };

    const rmDay = ce('button','btn small'); rmDay.textContent='− Remove Day';
    rmDay.onclick = ()=>{ removeDay(wi, di); renderBuilder(); showToast('Day removed'); };

    dh.append(tag, nameInp, typeInp, rmDay);
    card.append(dh);

    // Sections list
    (day.sections||[]).forEach((sec, si)=>{
      const box = ce('div','card');
      const sh = ce('div','row');
      const titleInp = ce('input','input'); titleInp.value = sec.title||''; titleInp.placeholder='Section title';
      titleInp.onchange = ()=>{ sec.title = titleInp.value; persistState(); };
      const rmSec = ce('button','btn small'); rmSec.textContent='− Remove Section';
      rmSec.onclick = ()=>{ removeSection(wi, di, si); renderBuilder(); showToast('Section removed'); };
      sh.append(titleInp, rmSec);
      box.append(sh);

      // Items under section
      (sec.items||[]).forEach((it, ii)=>{
        const row = ce('div','row');
        const name = ce('input','input'); name.value = it.name||''; name.placeholder='Movement';
        name.onchange = ()=>{ it.name = name.value; persistState(); };
        const target = ce('input','input'); target.value = it.target||''; target.placeholder='Target (e.g., 5×10 @ 60%)';
        target.onchange = ()=>{ it.target = target.value; persistState(); };
        const weightedSel = ce('select','input');
        weightedSel.innerHTML = `<option value="true">weighted</option><option value="false">bodyweight</option>`;
        weightedSel.value = it.weighted ? 'true':'false';
        weightedSel.onchange = ()=>{ it.weighted = (weightedSel.value==='true'); persistState(); };

        const rmItem = ce('button','btn small'); rmItem.textContent='🗑️';
        rmItem.onclick = ()=>{ removeItem(wi, di, si, ii); renderBuilder(); };

        row.append(name, target, weightedSel, rmItem);
        box.append(row);
      });

      const addIt = ce('button','btn small'); addIt.textContent='+ Add Item';
      addIt.onclick = ()=>{
        const nm = prompt('Exercise name?', 'New Exercise') || 'New Exercise';
        const tg = prompt('Target (e.g., 3×12 / 60–90s)?', '') || '';
        const w = confirm('Weighted movement? (OK = yes)');
        addItem(wi, di, si, { name:nm, target:tg, weighted:w });
        renderBuilder();
      };

      box.append(addIt);
      card.append(box);
    });

    // Add section button
    const addSec = ce('button','btn small'); addSec.textContent = '+ Add Section';
    addSec.onclick = ()=>{
      const title = prompt('Section title?', 'Workout') || 'Workout';
      addSection(wi, di, title);
      renderBuilder();
    };
    card.append(addSec);

    daysCard.append(card);
  });

  c.append(daysCard);

  // Change week refresh
  weekSel.onchange = ()=> renderBuilder();

  enhanceButtonsForRipple();
}

/* ---------------- Main render dispatcher ---------------- */
function render(){
  const tab = document.querySelector('.tab.active')?.dataset.tab || 'home';
  if(tab==='home') return renderHome();
  if(tab==='today') return renderToday();
  if(tab==='program') return renderProgram();
  if(tab==='profile') return renderProfile();
  if(tab==='builder') return renderBuilder();
}

/* ---------------- Boot ---------------- */
(function boot(){
  loadState();

  // Only generate program if none exists (preserve user edits)
  if(!state.program.weeks || !state.program.weeks.length){
    generateAnnualPlan();
  }

  // Migrate days to sections model if needed
  migrateProgramToSections();

  document.addEventListener('DOMContentLoaded', ()=>{
    // Ensure modal overlay exists (if HTML didn’t include it)
    if(!qs('.modalOverlay')){
      const overlay = ce('div','modalOverlay');
      overlay.innerHTML = `<div class="modal"></div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click',(e)=>{ if(e.target===overlay) closeModal(); });
    }
    render();
    let t; window.addEventListener('resize', ()=>{ clearTimeout(t); t=setTimeout(()=>{
      if(qs('#wtTrend')) drawWeightTrend();
    }, 120); }, {passive:true});
  });
})();



