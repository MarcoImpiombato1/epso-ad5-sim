const BANK_URL = "bank.json";
const MANIFEST_URL = "bank_manifest.json";

/* EPSO/AD/427/26-style exam specs: counts, timers, pass thresholds */
const EXAM = {
  verbal:       { n: 20, minutes: 35, pass: 10, lang: "it" },
  numerical:    { n: 10, minutes: 20, pass: null, lang: "it" },
  abstract:     { n: 10, minutes: 10, pass: null, lang: "it" },
  eu_knowledge: { n: 30, minutes: 40, pass: 15, lang: "en" },
  digital:      { n: 40, minutes: 30, pass: 20, lang: "en" }
};
const COMBO_PASS = 10;

/* local-only storage */
const STATS_KEY = "epso_stats_v3";
const WRONG_KEY = "epso_wrong_v3";
const FLAGS_KEY = "epso_flags_v3";
const SRS_KEY   = "epso_srs_v3";
const HIST_KEY  = "epso_history_v3";
const THEME_KEY = "epso_theme_v1";

let bank = [];
let manifest = null;

let session = null;
let timerInt = null;

/* ---------- utils ---------- */
function nowMs(){ return Date.now(); }
function fmtTime(sec){
  const m = Math.floor(sec/60);
  const s = sec%60;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}
function clamp(x,a,b){ return Math.max(a, Math.min(b, x)); }

/* ---------- storage ---------- */
function loadJson(key, fallback){
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}
function saveJson(key, value){ localStorage.setItem(key, JSON.stringify(value)); }

function loadStats(){ return loadJson(STATS_KEY, {}); }
function saveStats(s){ saveJson(STATS_KEY, s); }

function loadWrong(){ return new Set(loadJson(WRONG_KEY, [])); }
function saveWrong(set){ saveJson(WRONG_KEY, Array.from(set)); }

function loadFlags(){ return new Set(loadJson(FLAGS_KEY, [])); }
function saveFlags(set){ saveJson(FLAGS_KEY, Array.from(set)); }

function loadSrs(){ return loadJson(SRS_KEY, {}); }
function saveSrs(s){ saveJson(SRS_KEY, s); }

function loadHist(){ return loadJson(HIST_KEY, []); }
function saveHist(h){ saveJson(HIST_KEY, h.slice(-80)); }

/* ---------- theme ---------- */
function applyTheme(theme){
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  document.getElementById("darkToggle").checked = (theme === "dark");
}
function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  if(saved) applyTheme(saved);
  else {
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
  }
  document.getElementById("darkToggle").onchange = (e)=> applyTheme(e.target.checked ? "dark" : "light");
}

/* ---------- export/import ---------- */
function exportProgress(){
  const bundle = {
    version: 3,
    stats: loadStats(),
    wrong: Array.from(loadWrong()),
    flags: Array.from(loadFlags()),
    srs: loadSrs(),
    history: loadHist(),
    theme: localStorage.getItem(THEME_KEY) || "light",
    ts: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `epso_progress_${bundle.ts.replaceAll(":","-")}.json`;
  a.click();
}
function importProgressText(text){
  const bundle = JSON.parse(text);
  if(bundle.stats) saveStats(bundle.stats);
  if(bundle.wrong) saveWrong(new Set(bundle.wrong));
  if(bundle.flags) saveFlags(new Set(bundle.flags));
  if(bundle.srs) saveSrs(bundle.srs);
  if(bundle.history) saveHist(bundle.history);
  if(bundle.theme) applyTheme(bundle.theme);
  alert("Progress imported!");
  updateTopStats();
}

/* ---------- calculator ---------- */
function sanitizeExpr(expr){
  expr = expr.replaceAll(",", ".").trim();
  if(!/^[0-9+\-*/().%\s]*$/.test(expr)) return null;
  expr = expr.replace(/(\d+(\.\d+)?)\s*%/g, "($1/100)");
  return expr;
}
function safeEval(expr){
  const clean = sanitizeExpr(expr);
  if(clean === null) throw new Error("Invalid characters");
  if(/[\*\/]{2,}/.test(clean)) throw new Error("Invalid operator sequence");
  // eslint-disable-next-line no-new-func
  const fn = new Function(`"use strict"; return (${clean});`);
  const val = fn();
  if(typeof val !== "number" || !isFinite(val)) throw new Error("Not a finite number");
  return val;
}
function setCalcAllowed(ok){
  const btn = document.getElementById("calcBtn");
  btn.disabled = !ok;
  btn.title = ok ? "" : "Calculator disabled for this question";
}
function initCalculator(){
  const backdrop = document.getElementById("calcBackdrop");
  const openBtn = document.getElementById("calcBtn");
  const closeBtn = document.getElementById("calcCloseBtn");
  const evalBtn = document.getElementById("calcEvalBtn");
  const input = document.getElementById("calcInput");
  const out = document.getElementById("calcOut");

  function open(){ backdrop.style.display="flex"; input.focus(); }
  function close(){ backdrop.style.display="none"; }

  openBtn.onclick = open;
  closeBtn.onclick = close;
  backdrop.addEventListener("click", (e)=>{ if(e.target === backdrop) close(); });

  evalBtn.onclick = ()=>{
    try{
      const v = safeEval(input.value);
      out.textContent = String(Math.round(v*1e12)/1e12);
    }catch{
      out.textContent = "Error";
    }
  };
  input.addEventListener("keydown", (e)=>{
    if(e.key === "Enter"){ evalBtn.click(); }
    if(e.key === "Escape"){ close(); }
  });

  setCalcAllowed(true);
}

/* ---------- help modal ---------- */
function initHelp(){
  const back = document.getElementById("helpBackdrop");
  document.getElementById("helpBtn").onclick = ()=> back.style.display="flex";
  document.getElementById("helpCloseBtn").onclick = ()=> back.style.display="none";
  back.addEventListener("click", (e)=>{ if(e.target === back) back.style.display="none"; });
}

/* ---------- selection ---------- */
function getUserTarget(section){
  const stats = loadStats();
  return stats[section]?.avgDiff ?? 2;
}
function eligibleByFilters(questions, {wrongOnly, flagOnly}){
  const wrong = loadWrong();
  const flags = loadFlags();
  let out = questions;
  if(wrongOnly) out = out.filter(q => wrong.has(q.id));
  if(flagOnly) out = out.filter(q => flags.has(q.id));
  return out;
}
function dueItems(questions){
  const srs = loadSrs();
  const t = nowMs();
  return questions.filter(q => srs[q.id] && srs[q.id].due <= t);
}
function pickTraining(section, n, filters){
  const all = bank.filter(q => q.section===section);
  const filtered = eligibleByFilters(all, filters);
  if(filtered.length === 0) return [];

  const target = getUserTarget(section);
  const wrong = loadWrong();

  const due = dueItems(filtered);
  const wrongItems = filtered.filter(q => wrong.has(q.id));
  const near = filtered.filter(q => Math.abs(q.difficulty - target) <= 1);
  const easy = filtered.filter(q => q.difficulty <= Math.max(1, target-2));
  const hard = filtered.filter(q => q.difficulty >= Math.min(5, target+2));

  const out = [];
  const take = (pool, k) => {
    const c = shuffle(pool.filter(x => !out.includes(x)));
    for(let i=0;i<k && i<c.length;i++) out.push(c[i]);
  };

  take(due, Math.min(Math.floor(n*0.25), due.length));
  take(wrongItems, Math.min(Math.floor(n*0.25), wrongItems.length));
  take(near, Math.floor(n*0.35));
  take(easy, Math.floor(n*0.10));
  take(hard, n - out.length);
  if(out.length < n) take(filtered, n - out.length);

  return out.slice(0, n);
}
function pickExamSection(section, filters){
  const spec = EXAM[section];
  const all = bank.filter(q => q.section===section && q.lang===spec.lang);
  const filtered = eligibleByFilters(all, filters);
  if(filtered.length === 0) return [];

  const mid = filtered.filter(q => q.difficulty>=2 && q.difficulty<=4);
  const easy = filtered.filter(q => q.difficulty===1);
  const hard = filtered.filter(q => q.difficulty===5);

  const n = spec.n;
  const out = [];
  const take = (pool, k) => {
    const c = shuffle(pool.filter(x => !out.includes(x)));
    for(let i=0;i<k && i<c.length;i++) out.push(c[i]);
  };
  take(mid, Math.floor(n*0.70));
  take(easy, Math.floor(n*0.15));
  take(hard, n - out.length);
  if(out.length < n) take(filtered, n - out.length);

  return out.slice(0, n);
}

/* ---------- progress / stats ---------- */
function markSrs(qid, correct){
  const srs = loadSrs();
  const prev = srs[qid] || { intervalMin: 10, due: nowMs() };
  if(!correct){
    prev.intervalMin = Math.max(5, Math.floor(prev.intervalMin * 0.7));
  } else {
    prev.intervalMin = Math.min(7*24*60, Math.floor(prev.intervalMin * 2.2));
  }
  prev.due = nowMs() + prev.intervalMin * 60 * 1000;
  srs[qid] = prev;
  saveSrs(srs);
}
function updateStats(section, skill, correct){
  const stats = loadStats();
  if(!stats[section]) stats[section] = { attempts:0, correct:0, avgDiff:2, bySkill:{} };
  const s = stats[section];
  s.attempts += 1;
  s.correct += correct ? 1 : 0;
  s.avgDiff = clamp((s.avgDiff || 2) + (correct ? 0.06 : -0.12), 1, 5);

  const by = s.bySkill || {};
  by[skill] = by[skill] || { attempts:0, correct:0 };
  by[skill].attempts += 1;
  by[skill].correct += correct ? 1 : 0;
  s.bySkill = by;

  stats[section] = s;
  saveStats(stats);
}
function pushHistory(entry){
  const hist = loadHist();
  hist.push(entry);
  saveHist(hist);
}

/* ---------- timer ---------- */
function startTimer(seconds){
  clearInterval(timerInt);
  const timerEl = document.getElementById("timer");
  let left = seconds;
  timerEl.textContent = fmtTime(left);
  timerInt = setInterval(()=>{
    left--;
    timerEl.textContent = fmtTime(Math.max(0,left));
    if(left<=0){
      clearInterval(timerInt);
      submitSection(true);
    }
  }, 1000);
}
function stopTimer(){ clearInterval(timerInt); }

/* ---------- UI ---------- */
function updateTopStats(){
  const flags = loadFlags();
  document.getElementById("flagsCount").textContent = String(flags.size);
  if(session){
    document.getElementById("progress").textContent = `${session.idx+1}/${session.questions.length}`;
    document.getElementById("answeredCount").textContent = String(Object.keys(session.answers).length);
  } else {
    document.getElementById("progress").textContent = "0/0";
    document.getElementById("answeredCount").textContent = "0";
  }
}
function renderNav(){
  const navCard = document.getElementById("navCard");
  const navGrid = document.getElementById("navGrid");
  navGrid.innerHTML = "";
  if(!session) { navCard.style.display="none"; return; }
  navCard.style.display = "block";

  const flags = loadFlags();
  for(let i=0;i<session.questions.length;i++){
    const q = session.questions[i];
    const b = document.createElement("button");
    b.className = "navbtn";
    b.textContent = String(i+1);
    if(session.answers[q.id]) b.classList.add("answered");
    if(flags.has(q.id)) b.classList.add("flagged");
    if(i===session.idx) b.classList.add("current");
    b.onclick = ()=> { session.idx = i; renderQuestion(); };
    navGrid.appendChild(b);
  }
}
function renderFigure(q){
  const host = document.getElementById("qFigure");
  host.innerHTML = "";
  if(q.figure_svg){
    const box = document.createElement("div");
    box.className = "svgbox";
    box.innerHTML = q.figure_svg;
    host.appendChild(box);
    if(q.figure_caption){
      const cap = document.createElement("div");
      cap.className = "muted";
      cap.textContent = q.figure_caption;
      host.appendChild(cap);
    }
  }
}
function renderTable(q){
  const host = document.getElementById("qTable");
  host.innerHTML = "";
  if(!q.table) return;
  const t = q.table;
  const table = document.createElement("table");

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  (t.headers || []).forEach(h=>{
    const th = document.createElement("th");
    th.textContent = String(h);
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  (t.rows || []).forEach(row=>{
    const tr = document.createElement("tr");
    row.forEach(cell=>{
      const td = document.createElement("td");
      td.textContent = String(cell);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  host.appendChild(table);
}
function renderQuestion(){
  document.getElementById("reportCard").style.display = "none";
  document.getElementById("qCard").style.display = "block";

  const q = session.questions[session.idx];
  document.getElementById("qMeta").textContent =
    `Section: ${q.section} | Diff: ${q.difficulty} | Skill: ${q.skill} | ID: ${q.id}`;

  const calcAllowed = (q.calc_allowed !== undefined) ? !!q.calc_allowed : (q.section === "numerical");
  setCalcAllowed(calcAllowed);

  renderFigure(q);
  renderTable(q);

  document.getElementById("qText").textContent = q.question;

  const flags = loadFlags();
  document.getElementById("flagBtn").textContent = flags.has(q.id) ? "Unflag" : "Flag";

  const choicesEl = document.getElementById("choices");
  choicesEl.innerHTML = "";
  Object.keys(q.choices).forEach(L=>{
    const div = document.createElement("div");
    div.className = "choice";
    div.textContent = `${L}) ${q.choices[L]}`;
    div.onclick = ()=> chooseAnswer(L);
    if(session.answers[q.id] === L) div.style.outline = "2px solid color-mix(in srgb, var(--accent) 35%, transparent)";
    choicesEl.appendChild(div);
  });

  const fb = document.getElementById("feedback");
  fb.innerHTML = "";
  if(session.mode === "training" && session.answers[q.id]){
    const chosen = session.answers[q.id];
    const correct = chosen === q.answer;
    fb.innerHTML = `<div><b>${correct ? "Correct" : "Wrong"}</b></div><div class="muted">${q.explanation}</div>`;
    if(q.rationale_wrong_choices){
      const ul = document.createElement("ul");
      ul.className = "muted";
      for(const [k,v] of Object.entries(q.rationale_wrong_choices)){
        const li = document.createElement("li");
        li.textContent = `${k}: ${v}`;
        ul.appendChild(li);
      }
      fb.appendChild(ul);
    }
  }

  document.getElementById("prevBtn").disabled = (session.idx === 0);
  document.getElementById("nextBtn").disabled = (session.idx === session.questions.length - 1);

  updateTopStats();
  renderNav();
}
function chooseAnswer(letter){
  const q = session.questions[session.idx];
  session.answers[q.id] = letter;
  renderQuestion();
}
function toggleFlag(){
  const q = session.questions[session.idx];
  const flags = loadFlags();
  if(flags.has(q.id)) flags.delete(q.id); else flags.add(q.id);
  saveFlags(flags);
  updateTopStats();
  renderQuestion();
}
function skipQuestion(){
  const q = session.questions.splice(session.idx, 1)[0];
  session.questions.push(q);
  if(session.idx >= session.questions.length) session.idx = session.questions.length - 1;
  renderQuestion();
}
function next(){ if(session.idx < session.questions.length - 1){ session.idx++; renderQuestion(); } }
function prev(){ if(session.idx > 0){ session.idx--; renderQuestion(); } }

/* ---------- submission/scoring ---------- */
function scoreSection(questions, answers){
  let score = 0;
  const details = [];
  for(const q of questions){
    const chosen = answers[q.id] || null;
    const correct = (chosen !== null && chosen === q.answer);
    if(correct) score++;
    details.push({id:q.id, chosen, answer:q.answer, correct, section:q.section, skill:q.skill});
  }
  return {score, details};
}
function appendWeakAreasHtml(){
  const stats = loadStats();
  const rows = Object.entries(stats).map(([sec, s])=>{
    const acc = s.attempts ? (s.correct/s.attempts) : 0;
    return {sec, acc, attempts:s.attempts, avgDiff:(s.avgDiff||2), bySkill:(s.bySkill||{})};
  }).sort((a,b)=>a.acc-b.acc);

  const weakSec = rows.slice(0,3).map(r=>
    `<li><b>${r.sec}</b>: ${(r.acc*100).toFixed(0)}% acc, avgDiff ${r.avgDiff.toFixed(2)} (${r.attempts})</li>`
  ).join("");

  const skillRows = [];
  for(const r of rows){
    for(const [skill, st] of Object.entries(r.bySkill)){
      const acc = st.attempts ? (st.correct/st.attempts) : 0;
      skillRows.push({section:r.sec, skill, acc, attempts:st.attempts});
    }
  }
  skillRows.sort((a,b)=>a.acc-b.acc);
  const weakSkills = skillRows.slice(0,8).map(x=>
    `<li><b>${x.section}</b> / ${x.skill}: ${(x.acc*100).toFixed(0)}% (${x.attempts})</li>`
  ).join("");

  return `<h3>Next focus</h3><ul>${weakSec || "<li>No stats yet</li>"}</ul>
          <h3>Weak skills</h3><ul>${weakSkills || "<li>No skill stats yet</li>"}</ul>`;
}
function endReport(html){
  stopTimer();
  document.getElementById("qCard").style.display = "none";
  document.getElementById("navCard").style.display = "none";
  const rep = document.getElementById("reportCard");
  rep.style.display = "block";
  rep.innerHTML = html + `<p class="muted">Progress is stored only in your browser. Use Export for backups.</p>`;
  session = null;
  updateTopStats();
}
function submitSection(timeout=false){
  if(!session) return;

  // full exam: submit current part, then go next
  if(session.mode==="exam" && session.section==="full_exam"){
    const {score, details} = scoreSection(session.questions, session.answers);

    // update wrong+stats (learning signal) but no SRS
    const wrong = loadWrong();
    for(const d of details){
      const q = bank.find(x=>x.id===d.id);
      if(!q) continue;
      if(!d.correct) wrong.add(d.id); else wrong.delete(d.id);
      updateStats(q.section, q.skill, d.correct);
    }
    saveWrong(wrong);

    session.examResults[session.part].score = score;
    session.partIdx++;

    if(session.partIdx >= session.order.length){
      const R = session.examResults;
      const passVerbal = R.verbal.score >= EXAM.verbal.pass;
      const combo = (R.numerical.score + R.abstract.score);
      const passCombo = combo >= COMBO_PASS;
      const passEUK = R.eu_knowledge.score >= EXAM.eu_knowledge.pass;
      const passDig = R.digital.score >= EXAM.digital.pass;

      endReport(`
        <h2>Full exam report ${timeout ? "(time over)" : ""}</h2>
        <div class="card">
          <div><b>Verbal:</b> ${R.verbal.score}/${EXAM.verbal.n} → ${passVerbal?"PASS":"FAIL"}</div>
          <div><b>Numerical:</b> ${R.numerical.score}/${EXAM.numerical.n}</div>
          <div><b>Abstract:</b> ${R.abstract.score}/${EXAM.abstract.n}</div>
          <div><b>Numerical+Abstract:</b> ${combo}/20 → ${passCombo?"PASS":"FAIL"}</div>
          <div><b>EU Knowledge:</b> ${R.eu_knowledge.score}/${EXAM.eu_knowledge.n} → ${passEUK?"PASS":"FAIL"}</div>
          <div><b>Digital:</b> ${R.digital.score}/${EXAM.digital.n} → ${passDig?"PASS":"FAIL"}</div>
        </div>
        ${appendWeakAreasHtml()}
      `);
      return;
    }

    startExamPart();
    return;
  }

  // single section
  const {score, details} = scoreSection(session.questions, session.answers);

  if(session.mode === "training"){
    const wrong = loadWrong();
    for(const d of details){
      const q = bank.find(x=>x.id===d.id);
      if(!q) continue;
      markSrs(d.id, d.correct);
      if(!d.correct) wrong.add(d.id); else wrong.delete(d.id);
      updateStats(q.section, q.skill, d.correct);
    }
    saveWrong(wrong);
  } else {
    const wrong = loadWrong();
    for(const d of details){
      const q = bank.find(x=>x.id===d.id);
      if(!q) continue;
      if(!d.correct) wrong.add(d.id); else wrong.delete(d.id);
      updateStats(q.section, q.skill, d.correct);
    }
    saveWrong(wrong);
  }

  pushHistory({
    ts: new Date().toISOString(),
    kind: "session",
    mode: session.mode,
    section: session.section,
    score,
    n: session.questions.length,
    timeout
  });

  if(session.mode === "training"){
    const wrongItems = details.filter(d=>!d.correct).slice(0, 25).map(d=>{
      const q = bank.find(x=>x.id===d.id);
      if(!q) return "";
      return `<li><b>${q.id}</b> (${q.skill}) — correct: ${q.answer}, yours: ${d.chosen || "—"}<br/><span class="muted">${q.explanation}</span></li>`;
    }).join("");

    endReport(`
      <h2>Training report ${timeout ? "(time over)" : ""}</h2>
      <p><b>Score:</b> ${score}/${session.questions.length}</p>
      ${appendWeakAreasHtml()}
      <h3>Review (wrong)</h3>
      <ul>${wrongItems || "<li>All correct 🎉</li>"}</ul>
    `);
  } else {
    endReport(`
      <h2>Exam section report ${timeout ? "(time over)" : ""}</h2>
      <p><b>Score:</b> ${score}/${session.questions.length}</p>
      ${appendWeakAreasHtml()}
      <p class="muted">No feedback was shown during the section (exam-like). Use Training for explanations.</p>
    `);
  }
}

/* ---------- start logic ---------- */
function ensureEnough(questions, needed, label){
  if(questions.length < needed){
    alert(`Not enough questions for ${label}. Needed ${needed}, found ${questions.length}. Add more items in bank/*.yml.`);
    return false;
  }
  return true;
}
function start(){
  const mode = document.getElementById("mode").value;
  const section = document.getElementById("section").value;
  const wrongOnly = document.getElementById("wrongOnly").checked;
  const flagOnly = document.getElementById("flagOnly").checked;
  const filters = {wrongOnly, flagOnly};

  if(mode === "exam" && section === "full_exam"){
    session = {
      mode: "exam",
      section: "full_exam",
      order: ["verbal","numerical","abstract","eu_knowledge","digital"],
      partIdx: 0,
      part: null,
      examResults: { verbal:{score:0}, numerical:{score:0}, abstract:{score:0}, eu_knowledge:{score:0}, digital:{score:0} },
      answers: {},
      questions: [],
      idx: 0,
      filters
    };
    startExamPart();
    return;
  }

  session = {
    mode,
    section: (section==="full_exam" ? "verbal" : section),
    questions: [],
    answers: {},
    idx: 0,
    filters
  };

  if(mode === "exam"){
    const spec = EXAM[session.section];
    const qs = pickExamSection(session.section, filters);
    if(!ensureEnough(qs, spec.n, session.section)) return;
    session.questions = qs;
    startTimer(spec.minutes*60);
  } else {
    const n = parseInt(document.getElementById("trainN").value || "20", 10);
    const m = parseInt(document.getElementById("trainMin").value || "25", 10);
    const qs = pickTraining(session.section, n, filters);
    if(qs.length === 0){ alert("No questions match the selected filters."); return; }
    session.questions = qs;
    startTimer(m*60);
  }

  document.getElementById("reportCard").style.display = "none";
  document.getElementById("qCard").style.display = "block";
  renderQuestion();
}
function startExamPart(){
  const sec = session.order[session.partIdx];
  session.part = sec;
  session.section = "full_exam";
  session.answers = {};
  session.idx = 0;

  const spec = EXAM[sec];
  const qs = pickExamSection(sec, session.filters);
  if(!ensureEnough(qs, spec.n, sec)) return;
  session.questions = qs;

  startTimer(spec.minutes*60);
  renderQuestion();
}

/* ---------- keyboard shortcuts ---------- */
function initKeyboard(){
  document.addEventListener("keydown", (e)=>{
    if(!session) return;
    if(document.getElementById("calcBackdrop").style.display === "flex") return;
    if(document.getElementById("helpBackdrop").style.display === "flex") return;

    const k = e.key.toUpperCase();
    if(["A","B","C","D","E"].includes(k)){ chooseAnswer(k); }
    if(e.key === "ArrowRight"){ next(); }
    if(e.key === "ArrowLeft"){ prev(); }
    if(k === "F"){ toggleFlag(); }
    if(k === "S"){ skipQuestion(); }
    if(e.key === "Enter"){ next(); }
  });
}

/* ---------- init ---------- */
async function init(){
  bank = await (await fetch(BANK_URL)).json();
  try { manifest = await (await fetch(MANIFEST_URL)).json(); } catch { manifest = null; }

  initTheme();
  initCalculator();
  initHelp();
  initKeyboard();

  document.getElementById("startBtn").onclick = start;
  document.getElementById("resetBtn").onclick = ()=>{
    if(!confirm("Reset stats, wrong list, flags, schedule and history?")) return;
    localStorage.removeItem(STATS_KEY);
    localStorage.removeItem(WRONG_KEY);
    localStorage.removeItem(FLAGS_KEY);
    localStorage.removeItem(SRS_KEY);
    localStorage.removeItem(HIST_KEY);
    alert("Reset complete.");
    updateTopStats();
  };

  document.getElementById("exportBtn").onclick = exportProgress;
  document.getElementById("importBtn").onclick = ()=> document.getElementById("importFile").click();
  document.getElementById("importFile").onchange = (e)=>{
    const f = e.target.files?.[0];
    if(!f) return;
    const reader = new FileReader();
    reader.onload = () => importProgressText(String(reader.result));
    reader.readAsText(f);
  };

  document.getElementById("flagBtn").onclick = toggleFlag;
  document.getElementById("skipBtn").onclick = skipQuestion;
  document.getElementById("nextBtn").onclick = next;
  document.getElementById("prevBtn").onclick = prev;
  document.getElementById("submitBtn").onclick = ()=> submitSection(false);
  document.getElementById("endBtn").onclick = ()=> submitSection(false);

  // calc modal close
  const calcBackdrop = document.getElementById("calcBackdrop");
  document.getElementById("calcCloseBtn").onclick = ()=> calcBackdrop.style.display="none";

  updateTopStats();

  if(manifest){
    const info = document.createElement("div");
    info.className = "muted";
    info.style.marginTop = "10px";
    info.textContent = `Question bank: ${manifest.question_count} items (generated ${manifest.generated_at})`;
    document.body.insertBefore(info, document.body.firstChild.nextSibling);
  }
}
init();
