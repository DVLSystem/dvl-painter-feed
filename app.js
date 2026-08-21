
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const state = {painters:[],feed:[],meta:{},view:"feed",painter:"all",source:"all",range:"all",tag:"all",q:""};
const savedKey="dvlPainterFeedSavedV1", localPaintersKey="dvlPainterLocalPaintersV1";
const saved = new Set(JSON.parse(localStorage.getItem(savedKey)||"[]"));

function esc(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}
function fmtDate(v){ if(!v)return ""; const d=new Date(v); return isNaN(d)?v:d.toLocaleString("ko-KR",{dateStyle:"medium",timeStyle:"short"}); }
function uid(name){return (name||"painter").toLowerCase().normalize("NFKD").replace(/[^\w]+/g,"-").replace(/^-|-$/g,"")+"-"+Math.random().toString(36).slice(2,6)}
async function loadJSON(path,fallback){try{const r=await fetch(path+"?v="+Date.now(),{cache:"no-store"});if(!r.ok)throw 0;return await r.json()}catch{return fallback}}

async function boot(){
  const [remotePainters,feed,meta]=await Promise.all([loadJSON("data/painters.json",[]),loadJSON("data/feed.json",[]),loadJSON("data/meta.json",{})]);
  const local=JSON.parse(localStorage.getItem(localPaintersKey)||"null");
  state.painters=local||remotePainters; state.feed=feed; state.meta=meta;
  renderAll(); bind();
}
function renderAll(){renderPainters();renderSources();renderTags();renderFeed();renderUpdated();}
function renderUpdated(){
  $("#lastUpdated").textContent="마지막 업데이트: "+(state.meta.updatedAt?fmtDate(state.meta.updatedAt):"아직 없음");
}
function renderPainters(){
  const active=state.painters.filter(p=>p.active!==false);
  $("#painterList").innerHTML=`<button class="painter-btn ${state.painter==="all"?"active":""}" data-p="all">ALL <span>${active.length}</span></button>`+
    active.map(p=>`<button class="painter-btn ${state.painter===p.id?"active":""}" data-p="${esc(p.id)}">${esc(p.name)}</button>`).join("");
  $$(".painter-btn").forEach(b=>b.onclick=()=>{state.painter=b.dataset.p;renderAll()});
}
function renderSources(){
  const counts={}; state.feed.forEach(x=>counts[x.source||"Reference"]=(counts[x.source||"Reference"]||0)+1);
  const parts=[["all","ALL",state.feed.length],...Object.entries(counts).map(([k,v])=>[k,k.toUpperCase(),v])];
  $("#sourceFilters").innerHTML=parts.map(([k,l,c])=>`<button class="chip ${state.source===k?"active":""}" data-source="${esc(k)}">${esc(l)} ${c}</button>`).join("");
  $$("#sourceFilters .chip").forEach(b=>b.onclick=()=>{state.source=b.dataset.source;renderAll()});
}
function renderTags(){
  const c={}; state.feed.forEach(x=>(x.tags||[]).forEach(t=>c[t]=(c[t]||0)+1));
  const tags=Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,18);
  $("#tagFilters").innerHTML=`<button class="chip ${state.tag==="all"?"active":""}" data-tag="all">ALL TAGS</button>`+
    tags.map(([t,n])=>`<button class="chip ${state.tag===t?"active":""}" data-tag="${esc(t)}">#${esc(t)} ${n}</button>`).join("");
  $$("#tagFilters .chip").forEach(b=>b.onclick=()=>{state.tag=b.dataset.tag;renderAll()});
}
function filtered(){
  const now=Date.now(), q=state.q.toLowerCase().trim();
  return state.feed.filter(x=>{
    if(state.view==="saved" && !saved.has(x.id)) return false;
    if(state.painter!=="all" && x.painterId!==state.painter) return false;
    if(state.source!=="all" && (x.source||"Reference")!==state.source) return false;
    if(state.tag!=="all" && !(x.tags||[]).includes(state.tag)) return false;
    if(state.range!=="all"){
      const d=new Date(x.publishedAt||x.date||0); if(isNaN(d))return false;
      if((now-d.getTime())>Number(state.range)*86400000)return false;
    }
    if(q && ![x.title,x.painterName,...(x.tags||[])].join(" ").toLowerCase().includes(q))return false;
    return true;
  }).sort((a,b)=>new Date(b.publishedAt||0)-new Date(a.publishedAt||0));
}
function renderFeed(){
  const rows=filtered(); $("#viewTitle").textContent=state.view==="saved"?"SAVED":"LATEST FEED"; $("#countBadge").textContent=rows.length;
  $("#empty").classList.toggle("hidden",rows.length>0);
  $("#feed").innerHTML=rows.map(x=>{
    const thumb=x.thumbnail?`<img class="thumb" loading="lazy" src="${esc(x.thumbnail)}" alt="">`:`<div class="thumb"></div>`;
    return `<article class="item">${thumb}<div class="item-body">
      <button class="save ${saved.has(x.id)?"on":""}" data-save="${esc(x.id)}">★</button>
      <div class="meta"><span class="source">${esc((x.source||"Reference").toUpperCase())}</span><span>${esc(x.painterName||"")}</span><span>${esc(fmtDate(x.publishedAt))}</span></div>
      <h3><a href="${esc(x.url||"#")}" target="_blank" rel="noopener">${esc(x.title||"Untitled")}</a></h3>
      <div class="tagsline">${(x.tags||[]).map(t=>`<span class="tag">#${esc(t)}</span>`).join("")}</div>
    </div></article>`;
  }).join("");
  $$("[data-save]").forEach(b=>b.onclick=()=>{saved.has(b.dataset.save)?saved.delete(b.dataset.save):saved.add(b.dataset.save);localStorage.setItem(savedKey,JSON.stringify([...saved]));renderFeed()});
}
function bind(){
  $("#search").oninput=e=>{state.q=e.target.value;renderFeed()};
  $$(".tab").forEach(b=>b.onclick=()=>{$$(".tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.view=b.dataset.view;renderFeed()});
  $$("#rangeFilters .chip").forEach(b=>b.onclick=()=>{$$("#rangeFilters .chip").forEach(x=>x.classList.remove("active"));b.classList.add("active");state.range=b.dataset.range;renderFeed()});
  $("#manageBtn").onclick=()=>{renderManager();$("#manager").showModal()};
  $("#addPainter").onclick=()=>{state.painters.push({id:uid("new"),name:"New Painter",country:"",active:true,youtubeUrl:"",website:"",instagram:"",patreon:"",specialties:[],websiteMode:"none"});renderManager()};
  $("#saveLocal").onclick=()=>{readManager();localStorage.setItem(localPaintersKey,JSON.stringify(state.painters));renderAll();$("#managerStatus").textContent="Saved locally."};
  $("#publishGithub").onclick=publishGithub;
}
function renderManager(){
  $("#managerList").innerHTML="";
  for(const p of state.painters){
    const node=$("#painterEditorTpl").content.firstElementChild.cloneNode(true); node.dataset.id=p.id;
    node.querySelectorAll("[data-k]").forEach(el=>{
      const k=el.dataset.k, v=p[k];
      if(el.type==="checkbox")el.checked=v!==false;
      else if(k==="specialties")el.value=(v||[]).join(", ");
      else el.value=v??"";
    });
    node.querySelector(".removePainter").onclick=()=>{state.painters=state.painters.filter(x=>x.id!==p.id);renderManager()};
    $("#managerList").appendChild(node);
  }
}
function readManager(){
  const map=new Map(state.painters.map(p=>[p.id,p]));
  $$("#managerList .editor").forEach(node=>{
    const p=map.get(node.dataset.id); if(!p)return;
    node.querySelectorAll("[data-k]").forEach(el=>{
      const k=el.dataset.k;
      if(el.type==="checkbox")p[k]=el.checked;
      else if(k==="specialties")p[k]=el.value.split(",").map(x=>x.trim()).filter(Boolean);
      else p[k]=el.value.trim();
    });
    if(!p.id)p.id=uid(p.name);
  });
}
async function publishGithub(){
  readManager();
  const owner=$("#ghOwner").value.trim(),repo=$("#ghRepo").value.trim(),branch=$("#ghBranch").value.trim(),token=$("#ghToken").value.trim();
  const status=$("#managerStatus"); if(!owner||!repo||!branch||!token){status.textContent="GitHub settings와 token을 입력하세요.";return}
  try{
    status.textContent="Publishing…";
    const path="data/painters.json", api=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;
    const h={Accept:"application/vnd.github+json",Authorization:`Bearer ${token}`,"X-GitHub-Api-Version":"2022-11-28"};
    let sha=null; const g=await fetch(api+`?ref=${encodeURIComponent(branch)}`,{headers:h}); if(g.ok)sha=(await g.json()).sha;
    const content=btoa(unescape(encodeURIComponent(JSON.stringify(state.painters,null,2)+"\n")));
    const body={message:"Update painters from DVL Painter Feed",content,branch}; if(sha)body.sha=sha;
    const r=await fetch(api,{method:"PUT",headers:{...h,"Content-Type":"application/json"},body:JSON.stringify(body)});
    if(!r.ok)throw new Error(`${r.status} ${await r.text()}`);
    localStorage.removeItem(localPaintersKey); status.textContent="Published to GitHub. 다음 자동 갱신 때 반영됩니다.";
  }catch(e){status.textContent="Publish failed: "+e.message}
}
boot();
