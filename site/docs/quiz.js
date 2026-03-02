const BANK_URL="bank.json";
const EXAM={verbal:{n:20,minutes:35,pass:10,lang:"it"},numerical:{n:10,minutes:20,pass:null,lang:"it"},abstract:{n:10,minutes:10,pass:null,lang:"it"},eu_knowledge:{n:30,minutes:40,pass:15,lang:"en"},digital:{n:40,minutes:30,pass:20,lang:"en"}};
const COMBO_PASS=10;
const STATS_KEY="epso_stats_v1",WRONG_KEY="epso_wrong_v1";
let bank=[],session=null,timerInt=null;

const loadStats=()=>JSON.parse(localStorage.getItem(STATS_KEY)||"{}");
const saveStats=s=>localStorage.setItem(STATS_KEY,JSON.stringify(s));
const loadWrong=()=>new Set(JSON.parse(localStorage.getItem(WRONG_KEY)||"[]"));
const saveWrong=s=>localStorage.setItem(WRONG_KEY,JSON.stringify([...s]));
const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const fmt=t=>`${String(Math.floor(t/60)).padStart(2,"0")}:${String(t%60).padStart(2,"0")}`;

function pickExam(section){
  const spec=EXAM[section];
  const items=bank.filter(q=>q.section===section && q.lang===spec.lang);
  return shuffle(items).slice(0,spec.n);
}
function pickTrain(section,n){
  const stats=loadStats(); const wrong=loadWrong();
  const items=bank.filter(q=>q.section===section);
  const target=(stats[section]?.avgDiff)||2;
  const wrongItems=items.filter(q=>wrong.has(q.id));
  const near=items.filter(q=>Math.abs(q.difficulty-target)<=1);
  const hard=items.filter(q=>q.difficulty>=Math.min(5,target+2));
  const out=[];
  const take=(pool,k)=>{pool=shuffle(pool.filter(x=>!out.includes(x)));for(let i=0;i<k && i<pool.length;i++) out.push(pool[i]);};
  take(wrongItems,Math.min(Math.floor(n*0.35),wrongItems.length));
  take(near,Math.floor(n*0.45));
  take(hard,n-out.length);
  if(out.length<n) take(items,n-out.length);
  return out.slice(0,n);
}

function startTimer(sec){
  clearInterval(timerInt);
  let left=sec;
  const el=document.getElementById("timer");
  el.textContent=fmt(left);
  timerInt=setInterval(()=>{left--; el.textContent=fmt(Math.max(0,left)); if(left<=0){clearInterval(timerInt); end(true);}},1000);
}

function render(){
  document.getElementById("reportCard").style.display="none";
  document.getElementById("qCard").style.display="block";
  const q=session.questions[session.idx];
  document.getElementById("qMeta").textContent=`Section: ${q.section} | Diff: ${q.difficulty} | Skill: ${q.skill} | ID: ${q.id}`;
  document.getElementById("qText").textContent=q.question;
  const choices=document.getElementById("choices"); choices.innerHTML="";
  Object.keys(q.choices).forEach(L=>{
    const d=document.createElement("div"); d.className="choice"; d.textContent=`${L}) ${q.choices[L]}`;
    d.onclick=()=>answer(L,d); choices.appendChild(d);
  });
  document.getElementById("feedback").innerHTML="";
  document.getElementById("nextBtn").disabled=true;
  document.getElementById("progress").textContent=`${session.idx+1}/${session.questions.length}`;
}

function answer(L,el){
  if(session.answered) return;
  session.answered=true;
  const q=session.questions[session.idx];
  const ok=L===q.answer;
  const all=[...document.querySelectorAll(".choice")]; all.forEach(x=>x.onclick=null);
  all.forEach(x=>{if(x.textContent.trim().charAt(0)===q.answer) x.classList.add("correct");});
  if(!ok) el.classList.add("wrong");
  session.score += ok?1:0;
  document.getElementById("score").textContent=String(session.score);

  const wrong=loadWrong(); if(!ok) wrong.add(q.id); else wrong.delete(q.id); saveWrong(wrong);
  const stats=loadStats(); const s=q.section;
  stats[s]=stats[s]||{attempts:0,correct:0,avgDiff:2};
  stats[s].attempts++; stats[s].correct += ok?1:0;
  stats[s].avgDiff=Math.min(5,Math.max(1,(stats[s].avgDiff||2)+(ok?0.05:-0.10)));
  saveStats(stats);

  document.getElementById("feedback").innerHTML=`<div><b>${ok?"Correct":"Wrong"}</b></div><div class="muted">${q.explanation}</div>`;
  document.getElementById("nextBtn").disabled=false;
}

function next(){
  session.idx++; session.answered=false;
  if(session.idx>=session.questions.length){ end(false); return; }
  render();
}

function end(timeout){
  clearInterval(timerInt);
  document.getElementById("qCard").style.display="none";
  const rep=document.getElementById("reportCard"); rep.style.display="block";
  if(session.mode==="exam" && session.section==="full_exam"){
    const R=session.exam;
    const passV=R.verbal>=EXAM.verbal.pass;
    const combo=(R.numerical+R.abstract);
    const passC=combo>=COMBO_PASS;
    const passE=R.eu_knowledge>=EXAM.eu_knowledge.pass;
    const passD=R.digital>=EXAM.digital.pass;
    rep.innerHTML=`<h2>Exam Report ${timeout?"(time over)":""}</h2>
      <div class="card">
        <div><b>Verbal:</b> ${R.verbal}/${EXAM.verbal.n} → ${passV?"PASS":"FAIL"}</div>
        <div><b>Numerical:</b> ${R.numerical}/${EXAM.numerical.n}</div>
        <div><b>Abstract:</b> ${R.abstract}/${EXAM.abstract.n}</div>
        <div><b>Numerical+Abstract:</b> ${combo}/20 → ${passC?"PASS":"FAIL"}</div>
        <div><b>EU Knowledge:</b> ${R.eu_knowledge}/${EXAM.eu_knowledge.n} → ${passE?"PASS":"FAIL"}</div>
        <div><b>Digital:</b> ${R.digital}/${EXAM.digital.n} → ${passD?"PASS":"FAIL"}</div>
      </div>`;
  } else {
    rep.innerHTML=`<h2>Session Report ${timeout?"(time over)":""}</h2><p><b>Score:</b> ${session.score}/${session.questions.length}</p>`;
  }
}

async function init(){
  bank = await (await fetch(BANK_URL)).json();
  document.getElementById("startBtn").onclick=start;
  document.getElementById("nextBtn").onclick=next;
  document.getElementById("endBtn").onclick=()=>end(false);
  document.getElementById("resetStatsBtn").onclick=()=>{localStorage.removeItem(STATS_KEY);localStorage.removeItem(WRONG_KEY);alert("Stats reset.");};
}
function start(){
  const mode=document.getElementById("mode").value;
  const section=document.getElementById("section").value;
  session={mode,section,idx:0,score:0,answered:false,questions:[]};

  if(mode==="exam" && section==="full_exam"){ runFullExam(); return; }

  if(mode==="exam"){
    const spec=EXAM[section];
    session.questions=pickExam(section);
    startTimer(spec.minutes*60);
  } else {
    session.section = section==="full_exam" ? "verbal" : section;
    session.questions=pickTrain(session.section,20);
    startTimer(25*60);
  }
  document.getElementById("score").textContent="0";
  render();
}
function runFullExam(){
  const order=["verbal","numerical","abstract","eu_knowledge","digital"];
  let part=0;
  session.exam={verbal:0,numerical:0,abstract:0,eu_knowledge:0,digital:0};

  const runPart=()=>{
    const sec=order[part], spec=EXAM[sec];
    session.section="full_exam"; session.part=sec;
    session.questions=pickExam(sec);
    session.idx=0; session.score=0; session.answered=false;
    document.getElementById("score").textContent="0";
    startTimer(spec.minutes*60);
    render();

    const origNext=next;
    document.getElementById("nextBtn").onclick=()=>{
      if(session.idx===session.questions.length-1){
        if(!session.answered) return;
        session.exam[sec]=session.score;
        clearInterval(timerInt);
        part++;
        if(part>=order.length){ document.getElementById("nextBtn").onclick=origNext; end(false); return; }
        document.getElementById("nextBtn").onclick=origNext;
        runPart(); return;
      }
      origNext();
    };
  };
  runPart();
}
init();
