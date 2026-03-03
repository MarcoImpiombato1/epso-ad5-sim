const BANK_URL = "bank.json";
const MANIFEST_URL = "bank_manifest.json"; // optional

// EPSO-style exam specs (counts/timers/thresholds)
const EXAM = {
  verbal:       { n: 20, minutes: 35, pass: 10, lang: "it" },
  numerical:    { n: 10, minutes: 20, pass: null, lang: "it" },
  abstract:     { n: 10, minutes: 10, pass: null, lang: "it" },
  eu_knowledge: { n: 30, minutes: 40, pass: 15, lang: "en" },
  digital:      { n: 40, minutes: 30, pass: 20, lang: "en" }
};
const COMBO_PASS = 10;

// LocalStorage keys (keep v1 for continuity)
const STATS_KEY = "epso_stats_v1";
const WRONG_KEY = "epso_wrong_v1";
const FLAGS_KEY = "epso_flags_v1";
const THEME_KEY = "epso_theme_v1";
const EXPORT_VERSION = 1;

let bank = [];
let manifest = null;

let session = null;
let timerInt = null;

// ---------- utils ----------
function nowMs(){ return Date.now(); }
function fmtTime(sec){
  const m = Math.floor(sec/60);
  const s = sec % 60;
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
function clamp(x,a,b){ return Math.max(a, Math.min(b,x)); }

// ---------- storage ----------
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

// ---------- theme ----------
function applyTheme(theme){
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  const t = document.getElementById("darkToggle");
  if(t) t.checked = (theme === "dark");
}
function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  if(saved){
    applyTheme(saved);
  } else {
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
  }
  const toggle = document.getElementById("darkToggle");
  if(toggle){
    toggle.onchange = (e)=> applyTheme(e.target.checked ? "dark" : "light");
  }
}

// ---------- calculator (safe local eval) ----------
function sanitizeExpr(expr){
  expr = (expr || "").replaceAll(",", ".").trim();
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
  if(!btn) return;
  btn.disabled = !ok;
  btn.title = ok ? "" : "Calculator disabled for this question";
}
function initCalculator(){
  const back = document.getElementById("calcBackdrop");
  const openBtn = document.getElementById("calcBtn");
  const closeBtn = document.getElementById("calcCloseBtn");
  const evalBtn = document.getElementById("calcEvalBtn");
  const input = document.getElementById("calcInput");
  const out = document.getElementById("calcOut");

  if(!back || !openBtn || !closeBtn || !evalBtn || !input || !out) return;

  function open(){ back.style.display="flex"; input.focus(); }
  function close(){ back.style.display="none"; }

  openBtn.onclick = open;
  closeBtn.onclick = close;
  back.addEventListener("click", (e)=>{ if(e.target === back) close(); });

  evalBtn.onclick = ()=>{
    try{
      const v = safeEval(input.value);
      out.textContent = String(Math.round(v*1e12)/1e12);
    }catch{
      out.textContent = "Error";
    }
  };
  input.addEventListener("keydown", (e)=>{
    if(e.key === "Enter") evalBtn.click();
    if(e.key === "Escape") close();
  });

  setCalcAllowed(true);
}

// ---------- help modal ----------
function initHelp(){
  const back = document.getElementById("helpBackdrop");
  const openBtn = document.getElementById("helpBtn");
  const closeBtn = document.getElementById("helpCloseBtn");
  if(!back || !openBtn || !closeBtn) return;

  openBtn.onclick = ()=> back.style.display="flex";
  closeBtn.onclick = ()=> back.style.display="none";
  back.addEventListener("click", (e)=>{ if(e.target === back) back.style.display="none"; });
}

// ---------- export/import ----------
function exportProgress(){
  const bundle = {
    version: EXPORT_VERSION,
    ts: new Date().toISOString(),
    stats: loadStats(),
    wrong: Array.from(loadWrong()),
    flags: Array.from(loadFlags()),
    theme: localStorage.getItem(THEME_KEY) || "light"
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
  if(bundle.theme) applyTheme(bundle.theme);
  alert("Imported!");
  updateTopBar();
}

// ---------- question picking ----------
function eligibleByFilters(items, {wrongOnly, flagOnly}){
  const wrong = loadWrong();
  const flags = loadFlags();
  let out = items;
  if(wrongOnly) out = out.filter(q => wrong.has(q.id));
  if(flagOnly) out = out.filter(q => flags.has(q.id));
  return out;
}

function pickExamSection(section, filters){
  const spec = EXAM[section];
  const items = bank.filter(q => q.section===section && q.lang===spec.lang);
  const filtered = eligibleByFilters(items, filters);
  return shuffle(filtered).slice(0, spec.n);
}

function pickTraining(section, n, filters){
  const items = bank.filter(q => q.section===section);
  const filtered = eligibleByFilters(items, filters);
  return shuffle(filtered).slice(0, n);
}

// ---------- timer ----------
function startTimer(seconds){
  clearInterval(timerInt);
  const el = document.getElementById("timer");
  let left = seconds;
  if(el) el.textContent = fmtTime(left);
  timerInt = setInterval(()=>{
    left--;
    if(el) el.textContent = fmtTime(Math.max(0,left));
    if(left<=0){
      clearInterval(timerInt);
      submitSection(true);
    }
  }, 1000);
}
function stopTimer(){ clearInterval(timerInt); }

// ---------- rendering helpers ----------
function updateTopBar(){
  const flags = loadFlags();
  const flagsCount = document.getElementById("flagsCount");
  if(flagsCount) flagsCount.textContent = String(flags.size);

  const progress = document.getElementById("progress");
  const answeredCount = document.getElementById("answeredCount");
  if(!session){
    if(progress) progress.textContent = "0/0";
    if(answeredCount) answeredCount.textContent = "0";
    return;
  }
  if(progress) progress.textContent = `${session.idx+1}/${session.questions.length}`;
  if(answeredCount) answeredCount.textContent = String(Object.keys(session.answers).length);
}

function renderNav(){
  const navCard = document.getElementById("navCard");
  const navGrid = document.getElementById("navGrid");
  if(!navCard || !navGrid) return;

  if(!session){
    navCard.style.display = "none";
    return;
  }
  navCard.style.display = "block";
  navGrid.innerHTML = "";

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
  if(!host) return;
  host.innerHTML = "";
  if(q.figure_svg){
    const box = document.createElement("div");
    box.className = "svgbox";
    box.innerHTML = q.figure_svg;
    host.appendChild(box);
  }
}

function renderTable(q){
  const host = document.getElementById("qTable");
  if(!host) return;
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
  const qCard = document.getElementById("qCard");
  const rep = document.getElementById("reportCard");
  if(rep) rep.style.display = "none";
  if(qCard) qCard.style.display = "block";

  const q = session.questions[session.idx];

  const meta = document.getElementById("qMeta");
  if(meta) meta.textContent = `Section: ${q.section} | Diff: ${q.difficulty} | Skill: ${q.skill} | ID: ${q.id}`;

  // calculator default: enabled for numerical unless calc_allowed explicitly false
  const calcAllowed = (q.calc_allowed !== undefined) ? !!q.calc_allowed : (q.section === "numerical");
  setCalcAllowed(calcAllowed);

  renderFigure(q);
  renderTable(q);

  const qt = document.getElementById("qText");
  if(qt) qt.textContent = q.question;

  // flag button label
  const flags = loadFlags();
  const flagBtn = document.getElementById("flagBtn");
  if(flagBtn) flagBtn.textContent = flags.has(q.id) ? "Unflag" : "Flag";

  // choices
  const choicesEl = document.getElementById("choices");
  if(choicesEl){
    choicesEl.innerHTML = "";
    Object.keys(q.choices).forEach(L=>{
      const div = document.createElement("div");
      div.className = "choice";
      div.textContent = `${L}) ${q.choices[L]}`;
      div.onclick = ()=> chooseAnswer(L);
      if(session.answers[q.id] === L){
        div.style.outline = "2px solid rgba(34,139,230,.35)";
      }
      choicesEl.appendChild(div);
    });
  }

  // feedback only in training
  const fb = document.getElementById("feedback");
  if(fb){
    fb.innerHTML = "";
    if(session.mode === "training" && session.answers[q.id]){
      const chosen = session.answers[q.id];
      const correct = (chosen === q.answer);
      fb.innerHTML = `<div><b>${correct ? "Correct" : "Wrong"}</b></div><div class="muted">${q.explanation}</div>`;
    }
  }

  // prev/next buttons
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  if(prevBtn) prevBtn.disabled = (session.idx === 0);
  if(nextBtn) nextBtn.disabled = (session.idx === session.questions.length - 1);

  updateTopBar();
  renderNav();
}

function chooseAnswer(letter){
  const q = session.questions[session.idx];
  session.answers[q.id] = letter;
  renderQuestion();
}

function next(){ if(session && session.idx < session.questions.length-1){ session.idx++; renderQuestion(); } }
function prev(){ if(session && session.idx > 0){ session.idx--; renderQuestion(); } }

function toggleFlag(){
  const q = session.questions[session.idx];
  const flags = loadFlags();
  if(flags.has(q.id)) flags.delete(q.id); else flags.add(q.id);
  saveFlags(flags);
  updateTopBar();
  renderQuestion();
}

function skipQuestion(){
  const q = session.questions.splice(session.idx, 1)[0];
  session.questions.push(q);
  if(session.idx >= session.questions.length) session.idx = session.questions.length - 1;
  renderQuestion();
}

// ---------- scoring + stats ----------
function scoreQuestions(questions, answers){
  let score = 0;
  for(const q of questions){
    const chosen = answers[q.id] || null;
    if(chosen && chosen === q.answer) score++;
  }
  return score;
}

function updateStatsFromSession(questions, answers){
  const stats = loadStats();
  const wrong = loadWrong();

  for(const q of questions){
    const chosen = answers[q.id] || null;
    const correct = (chosen !== null && chosen === q.answer);

    if(!correct) wrong.add(q.id); else wrong.delete(q.id);

    const sec = q.section;
    if(!stats[sec]) stats[sec] = {attempts:0, correct:0, avgDiff:2};
    stats[sec].attempts += 1;
    stats[sec].correct += correct ? 1 : 0;

    const cur = stats[sec].avgDiff || 2;
    stats[sec].avgDiff = clamp(cur + (correct ? 0.05 : -0.10), 1, 5);
  }

  saveWrong(wrong);
  saveStats(stats);
}

function weakAreasHtml(){
  const stats = loadStats();
  const rows = Object.entries(stats).map(([sec, s])=>{
    const acc = s.attempts ? (s.correct/s.attempts) : 0;
    return {sec, acc, attempts:s.attempts, avgDiff:(s.avgDiff||2)};
  }).sort((a,b)=>a.acc-b.acc);

  const items = rows.slice(0,5).map(r=>
    `<li><b>${r.sec}</b>: ${(r.acc*100).toFixed(0)}% acc, avgDiff ${r.avgDiff.toFixed(2)} (${r.attempts})</li>`
  ).join("");

  return `<h3>Next focus</h3><ul>${items || "<li>No stats yet</li>"}</ul>`;
}

function endReport(html){
  stopTimer();
  const qCard = document.getElementById("qCard");
  const navCard = document.getElementById("navCard");
  const rep = document.getElementById("reportCard");
  if(qCard) qCard.style.display = "none";
  if(navCard) navCard.style.display = "none";
  if(rep){
    rep.style.display = "block";
    rep.innerHTML = html + `<p class="muted">Progress stored locally in your browser. Use Export for backup.</p>`;
  }
  session = null;
  updateTopBar();
}

function submitSection(timeout=false){
  if(!session) return;

  if(session.mode==="exam" && session.section==="full_exam"){
    const part = session.part;
    const partScore = scoreQuestions(session.questions, session.answers);
    updateStatsFromSession(session.questions, session.answers);
    session.examResults[part] = partScore;

    session.partIdx += 1;
    if(session.partIdx >= session.order.length){
      const R = session.examResults;
      const passVerbal = (R.verbal ?? 0) >= EXAM.verbal.pass;
      const combo = (R.numerical ?? 0) + (R.abstract ?? 0);
      const passCombo = combo >= COMBO_PASS;
      const passEUK = (R.eu_knowledge ?? 0) >= EXAM.eu_knowledge.pass;
      const passDig = (R.digital ?? 0) >= EXAM.digital.pass;

      endReport(`
        <h2>Full exam report ${timeout ? "(time over)" : ""}</h2>
        <div class="card">
          <div><b>Verbal:</b> ${R.verbal}/${EXAM.verbal.n} → ${passVerbal?"PASS":"FAIL"}</div>
          <div><b>Numerical:</b> ${R.numerical}/${EXAM.numerical.n}</div>
          <div><b>Abstract:</b> ${R.abstract}/${EXAM.abstract.n}</div>
          <div><b>Numerical+Abstract:</b> ${combo}/20 → ${passCombo?"PASS":"FAIL"}</div>
          <div><b>EU Knowledge:</b> ${R.eu_knowledge}/${EXAM.eu_knowledge.n} → ${passEUK?"PASS":"FAIL"}</div>
          <div><b>Digital:</b> ${R.digital}/${EXAM.digital.n} → ${passDig?"PASS":"FAIL"}</div>
        </div>
        ${weakAreasHtml()}
      `);
      return;
    }

    startExamPart();
    return;
  }

  const score = scoreQuestions(session.questions, session.answers);
  updateStatsFromSession(session.questions, session.answers);

  endReport(`
    <h2>${session.mode === "exam" ? "Exam section report" : "Training report"} ${timeout ? "(time over)" : ""}</h2>
    <p><b>Score:</b> ${score}/${session.questions.length}</p>
    ${weakAreasHtml()}
    ${session.mode==="training" ? "<p class='muted'>Training shows feedback while you answer. Exam mode doesn't.</p>" : ""}
  `);
}

// ---------- start ----------
function ensureEnough(questions, needed, label){
  if(questions.length < needed){
    alert(`Not enough questions for ${label}. Needed ${needed}, found ${questions.length}. Add more items in bank/*.yml.`);
    return false;
  }
  return true;
}

function start(){
  const mode = document.getElementById("mode").value;
  const sel = document.getElementById("section").value;
  const filters = {wrongOnly: document.getElementById("wrongOnly").checked, flagOnly: document.getElementById("flagOnly").checked};

  if(mode==="exam" && sel==="full_exam"){
    session = {
      mode: "exam",
      section: "full_exam",
      order: ["verbal","numerical","abstract","eu_knowledge","digital"],
      partIdx: 0,
      part: null,
      questions: [],
      idx: 0,
      answers: {},
      examResults: {},
      filters
    };
    startExamPart();
    return;
  }

  const section = (sel==="full_exam") ? "verbal" : sel;
  session = {mode, section, questions: [], idx:0, answers:{}, filters};

  if(mode==="exam"){
    const spec = EXAM[section];
    const qs = pickExamSection(section, filters);
    if(!ensureEnough(qs, spec.n, section)) return;
    session.questions = qs;
    startTimer(spec.minutes*60);
  } else {
    const n = parseInt(document.getElementById("trainN").value || "20", 10);
    const m = parseInt(document.getElementById("trainMin").value || "25", 10);
    const qs = pickTraining(section, n, filters);
    if(qs.length === 0){
      alert("No questions match the selected filters.");
      return;
    }
    session.questions = qs;
    startTimer(m*60);
  }

  const rep = document.getElementById("reportCard");
  if(rep) rep.style.display="none";
  renderQuestion();
}

function startExamPart(){
  const part = session.order[session.partIdx];
  session.part = part;
  session.questions = [];
  session.answers = {};
  session.idx = 0;

  const spec = EXAM[part];
  const qs = pickExamSection(part, session.filters);
  if(!ensureEnough(qs, spec.n, part)) return;
  session.questions = qs;

  startTimer(spec.minutes*60);
  renderQuestion();
}

// ---------- keyboard shortcuts ----------
function initKeyboard(){
  document.addEventListener("keydown", (e)=>{
    if(!session) return;

    const calcBack = document.getElementById("calcBackdrop");
    const helpBack = document.getElementById("helpBackdrop");
    if(calcBack && calcBack.style.display==="flex") return;
    if(helpBack && helpBack.style.display==="flex") return;

    const k = e.key.toUpperCase();
    if(["A","B","C","D","E"].includes(k)) chooseAnswer(k);
    if(e.key === "ArrowRight") next();
    if(e.key === "ArrowLeft") prev();
    if(k === "F") toggleFlag();
    if(k === "S") skipQuestion();
    if(e.key === "Enter") next();
  });
}

// ---------- init ----------
async function init(){
  bank = await (await fetch(BANK_URL)).json();
  try { manifest = await (await fetch(MANIFEST_URL)).json(); } catch { manifest = null; }

  initTheme();
  initCalculator();
  initHelp();
  initKeyboard();

  document.getElementById("startBtn").onclick = start;
  document.getElementById("resetBtn").onclick = ()=>{
    if(!confirm("Reset stats, wrong list and flags?")) return;
    localStorage.removeItem(STATS_KEY);
    localStorage.removeItem(WRONG_KEY);
    localStorage.removeItem(FLAGS_KEY);
    alert("Reset done.");
    updateTopBar();
  };
  document.getElementById("exportBtn").onclick = exportProgress;
  document.getElementById("importBtn").onclick = ()=> document.getElementById("importFile").click();
  document.getElementById("importFile").onchange = (e)=>{
    const f = e.target.files?.[0];
    if(!f) return;
    const reader = new FileReader();
    reader.onload = ()=> importProgressText(String(reader.result));
    reader.readAsText(f);
  };

  document.getElementById("flagBtn").onclick = toggleFlag;
  document.getElementById("skipBtn").onclick = skipQuestion;
  document.getElementById("nextBtn").onclick = next;
  document.getElementById("prevBtn").onclick = prev;
  document.getElementById("submitBtn").onclick = ()=> submitSection(false);
  document.getElementById("endBtn").onclick = ()=> submitSection(false);

  updateTopBar();

  if(manifest){
    const info = document.createElement("div");
    info.className = "muted";
    info.style.marginTop = "10px";
    info.textContent = `Question bank: ${manifest.question_count} items (generated ${manifest.generated_at})`;
    document.body.insertBefore(info, document.body.firstChild.nextSibling);
  }
}
init();
