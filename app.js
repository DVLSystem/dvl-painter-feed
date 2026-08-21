const state = {
  painters: [], feed: [], meta: {}, selectedPainter: null, selectedSource: 'ALL', selectedTag: 'ALL',
  selectedAge: 'ALL', view: 'feed', query: '',
  saved: new Set(JSON.parse(localStorage.getItem('dvlPainterSaved') || '[]')),
  localPaintersDirty: false
};

const $ = (s) => document.querySelector(s);
const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const clone = (v) => JSON.parse(JSON.stringify(v));

async function loadData(){
  const ts = Date.now();
  const [paintersRes, feedRes, metaRes] = await Promise.all([
    fetch('data/painters.json?ts=' + ts), fetch('data/feed.json?ts=' + ts), fetch('data/meta.json?ts=' + ts).catch(()=>null)
  ]);
  if(!paintersRes.ok || !feedRes.ok) throw new Error('Data fetch failed');
  const remotePainters = await paintersRes.json();
  const localOverride = localStorage.getItem('dvlPainterLocalList');
  state.painters = localOverride ? JSON.parse(localOverride) : remotePainters;
  state.feed = await feedRes.json();
  if(metaRes && metaRes.ok) state.meta = await metaRes.json();
  state.view = 'feed'; // 항상 FEED로 시작
  renderAll();
}

function painterById(id){ return state.painters.find(p => p.id === id); }
function isPainterActive(p){ return p.active !== false; }
function initials(name){ return String(name||'?').split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase(); }
function ageHours(dateStr){ return Math.max(0, (Date.now() - new Date(dateStr).getTime()) / 36e5); }
function relativeDate(dateStr){
  const d = new Date(dateStr); const h = Math.floor(ageHours(dateStr)); const days = Math.floor(h/24);
  if (h < 1) return '방금 전'; if (h < 24) return `${h}시간 전`; if (days < 7) return `${days}일 전`;
  return d.toLocaleDateString('ko-KR',{month:'short',day:'numeric'});
}
function freshness(item){ const h=ageHours(item.publishedAt); return h<=24?'NEW':h<=72?'3D':h<=168?'7D':''; }
function hasImage(item){ return Boolean((item.thumbnail||'').trim()); }
function activePainterIds(){ return new Set(state.painters.filter(isPainterActive).map(p=>p.id)); }

function renderAll(){ renderMainTabs(); renderPainters(); renderProfile(); renderFilters(); renderFeed(); renderSummary(); renderSourceSummary(); renderLastUpdated(); }

function renderMainTabs(){
  document.querySelectorAll('.main-tab').forEach(btn=>btn.classList.toggle('active',btn.dataset.view===state.view));
  const heading = $('#feedStatus');
  const titles = {feed:'LATEST FEED', saved:'SAVED REFERENCES'};
  const h = document.querySelector('.feed-heading h3'); if(h) h.textContent=titles[state.view] || 'LATEST FEED';
  if(heading) heading.dataset.view=state.view;
}

function renderLastUpdated(){
  const el=$('#lastUpdated'); if(!el) return;
  const raw=state.meta?.lastCheckedAt;
  if(!raw){ el.textContent='마지막 업데이트: 다음 자동 갱신 후 표시'; return; }
  const d=new Date(raw);
  el.textContent=`마지막 업데이트: ${d.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}`;
}

function renderPainters(){
  const el = $('#paintersList');
  const counts = Object.fromEntries(state.painters.map(p => [p.id, state.feed.filter(f=>f.painterId===p.id).length]));
  el.innerHTML = state.painters.filter(isPainterActive).map(p => `
    <button class="painter-item ${state.selectedPainter===p.id?'active':''}" data-id="${esc(p.id)}">
      <span class="avatar">${initials(p.name)}</span>
      <span class="painter-meta"><strong>${esc(p.name)}</strong><span>${esc((p.specialties||[]).slice(0,2).join(' · '))}</span></span>
      <span class="count-badge">${counts[p.id]||0}</span>
    </button>`).join('');
  el.querySelectorAll('.painter-item').forEach(btn=>btn.addEventListener('click',()=>{
    state.selectedPainter = btn.dataset.id; renderAll(); openProfile();
  }));
}

function painterStats(painterId){
  const rows = state.feed.filter(f=>f.painterId===painterId).sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));
  const freq={}; rows.flatMap(x=>x.tags||[]).forEach(t=>freq[t]=(freq[t]||0)+1);
  return { total: rows.length, fresh: rows.filter(x=>ageHours(x.publishedAt)<=24).length,
    saved: rows.filter(x=>state.saved.has(x.id)).length, last: rows[0]?.publishedAt || null,
    topTags: Object.keys(freq).sort((a,b)=>freq[b]-freq[a]).slice(0,6), recent: rows.slice(0,3) };
}

function renderProfile(){
  const el=$('#painterProfile'); const p=state.selectedPainter && painterById(state.selectedPainter);
  if(!p){ el.innerHTML=''; closeProfile(false); return; }
  const stats=painterStats(p.id);
  const links=[['YouTube',p.youtube],['Instagram',p.instagram],['Patreon',p.patreon],['Website',p.website]].filter(x=>x[1]);
  const topTags = stats.topTags.length ? stats.topTags : (p.specialties||[]).slice(0,6);
  const recentHtml = stats.recent.length ? stats.recent.map(item=>`
    <a class="drawer-recent-item" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">
      <img src="${esc(item.thumbnail||'')}" alt="" loading="lazy" onerror="this.style.display='none'" />
      <span><strong>${esc(item.title)}</strong><small>${relativeDate(item.publishedAt)}</small></span>
    </a>`).join('') : '<p class="muted small">아직 수집된 업데이트가 없습니다.</p>';
  el.innerHTML=`
    <div class="drawer-eyebrow">PAINTER PROFILE</div>
    <div class="drawer-profile-head"><span class="drawer-avatar">${initials(p.name)}</span><div><h2>${esc(p.name)}</h2><p>${esc(p.country||'')}</p></div></div>
    <div class="drawer-specialties">${(p.specialties||[]).map(t=>`<span>${esc(t)}</span>`).join('')}</div>
    <div class="drawer-stats"><div><strong>${stats.total}</strong><span>UPLOADS</span></div><div><strong>${stats.fresh}</strong><span>24H NEW</span></div><div><strong>${stats.saved}</strong><span>SAVED</span></div></div>
    <div class="drawer-block"><div class="drawer-block-title"><span>TOP TAGS</span>${stats.last?`<small>최근 ${relativeDate(stats.last)}</small>`:''}</div><div class="profile-tags">${topTags.map(t=>`<button data-profile-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div></div>
    <div class="drawer-block"><div class="drawer-block-title"><span>CHANNELS</span></div><div class="profile-links">${links.map(([name,url])=>`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${name}<b>↗</b></a>`).join('') || '<span class="muted small">등록된 외부 링크가 없습니다.</span>'}</div></div>
    <div class="drawer-block"><div class="drawer-block-title"><span>RECENT</span></div><div class="drawer-recent">${recentHtml}</div></div>`;
  el.querySelectorAll('[data-profile-tag]').forEach(btn=>btn.onclick=()=>{ state.selectedTag=btn.dataset.profileTag; state.view='feed'; renderAll(); closeProfile(false); window.scrollTo({top:0,behavior:'smooth'}); });
}

function openProfile(){ $('#profileDrawer').classList.add('open'); $('#profileDrawer').setAttribute('aria-hidden','false'); $('#profileBackdrop').classList.remove('hidden'); requestAnimationFrame(()=>$('#profileBackdrop').classList.add('show')); }
function closeProfile(clearSelection=true){ $('#profileDrawer').classList.remove('open'); $('#profileDrawer').setAttribute('aria-hidden','true'); $('#profileBackdrop').classList.remove('show'); setTimeout(()=>$('#profileBackdrop').classList.add('hidden'),180); if(clearSelection && state.selectedPainter){ state.selectedPainter=null; renderAll(); } }

function renderFilters(){
  const validFeed = state.feed.filter(x=>activePainterIds().has(x.painterId));
  const sources = ['ALL', ...new Set(validFeed.map(x=>x.source).filter(Boolean))];
  $('#sourceFilters').innerHTML = sources.map(s=>`<button class="filter-btn ${state.selectedSource===s?'active':''}" data-source="${esc(s)}">${esc(s)}</button>`).join('');
  $('#sourceFilters').querySelectorAll('button').forEach(b=>b.onclick=()=>{state.selectedSource=b.dataset.source;renderAll();});
  const freq={}; validFeed.flatMap(x=>x.tags||[]).forEach(t=>freq[t]=(freq[t]||0)+1);
  const tags=['ALL',...Object.keys(freq).sort((a,b)=>freq[b]-freq[a]).slice(0,18)];
  $('#tagFilters').innerHTML=tags.map(t=>`<button class="filter-btn ${state.selectedTag===t?'active':''}" data-tag="${esc(t)}">${t==='ALL'?'ALL':'# '+esc(t)}</button>`).join('');
  $('#tagFilters').querySelectorAll('button').forEach(b=>b.onclick=()=>{state.selectedTag=b.dataset.tag;renderAll();});
  $('#ageFilters').querySelectorAll('button').forEach(b=>{b.classList.toggle('active',state.selectedAge===b.dataset.age); b.onclick=()=>{state.selectedAge=b.dataset.age;renderAll();};});
}

function baseFilteredFeed(){
  const q = state.query.trim().toLowerCase(); const activeIds=activePainterIds();
  return state.feed
    .filter(x => activeIds.has(x.painterId))
    .filter(x => state.view!=='saved' || state.saved.has(x.id))
    .filter(x => !state.selectedPainter || x.painterId===state.selectedPainter)
    .filter(x => state.selectedSource==='ALL' || x.source===state.selectedSource)
    .filter(x => state.selectedTag==='ALL' || (x.tags||[]).includes(state.selectedTag))
    .filter(x => state.selectedAge==='ALL' || ageHours(x.publishedAt) <= Number(state.selectedAge)*24)
    .filter(x => { if(!q) return true; const p=painterById(x.painterId); return [x.title,x.description,p?.name,...(x.tags||[])].join(' ').toLowerCase().includes(q); })
    .sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));
}
function filteredFeed(){
  return baseFilteredFeed();
}

function renderFeed(){
  const list=$('#feedList'); const rows=filteredFeed(); list.innerHTML='';
  list.className='feed-list list-view';
  const tpl=$('#feedCardTemplate');
  for(const item of rows){
    const p=painterById(item.painterId)||{name:'Unknown'}; const node=tpl.content.cloneNode(true); const card=node.querySelector('.feed-card');
    const thumbWrap=node.querySelector('.thumb-wrap'); const img=node.querySelector('.thumb'); thumbWrap.href=item.url; img.src=item.thumbnail; img.alt=item.title;
    img.onerror=()=>{img.remove();thumbWrap.classList.add('thumb-fallback');};
    const sourceBadge=node.querySelector('.source-badge'); sourceBadge.textContent=(item.source||'LINK').toUpperCase(); sourceBadge.dataset.source=(item.source||'Other').toLowerCase();
    const fresh=freshness(item); const freshBadge=node.querySelector('.fresh-badge'); if(fresh){freshBadge.textContent=fresh;freshBadge.classList.remove('hidden');card.classList.add('is-fresh');}
    const painterBtn=node.querySelector('.painter-link'); painterBtn.textContent=p.name; painterBtn.onclick=()=>{state.selectedPainter=item.painterId;renderAll();openProfile();};
    node.querySelector('.date').textContent=relativeDate(item.publishedAt);
    const title=node.querySelector('.title'); title.textContent=item.title; title.href=item.url;
    node.querySelector('.description').textContent=item.description||'';
    node.querySelector('.tag-list').innerHTML=(item.tags||[]).map(t=>`<button class="tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join('');
    node.querySelectorAll('.tag').forEach(t=>t.onclick=()=>{state.selectedTag=t.dataset.tag;state.view='feed';renderAll();window.scrollTo({top:0,behavior:'smooth'});});
    const save=node.querySelector('.save-btn'); const isSaved=state.saved.has(item.id); save.textContent=isSaved?'★ SAVED':'☆ SAVE'; save.classList.toggle('saved',isSaved); save.onclick=()=>toggleSave(item.id);
    node.querySelector('.open-link').href=item.url; list.appendChild(card);
  }
  $('#emptyState').classList.toggle('hidden',rows.length!==0);
  $('#feedStatus').textContent=`${rows.length} items · ${state.feed.length} total`;
}

function toggleSave(id){ state.saved.has(id)?state.saved.delete(id):state.saved.add(id); localStorage.setItem('dvlPainterSaved',JSON.stringify([...state.saved])); renderFeed(); renderSummary(); if(state.selectedPainter) renderProfile(); }
function renderSourceSummary(){
  const el=$('#sourceSummary'); if(!el) return; const counts={}; const activeIds=activePainterIds();
  state.feed.filter(x=>activeIds.has(x.painterId)).forEach(x=>{const k=x.source||'Other';counts[k]=(counts[k]||0)+1;});
  const order=['YouTube','ArtStation','Website',...Object.keys(counts).filter(x=>!['YouTube','ArtStation','Website'].includes(x))];
  el.innerHTML=order.filter(x=>counts[x]).map(x=>`<button data-source-jump="${esc(x)}"><span>${esc(x)}</span><strong>${counts[x]}</strong></button>`).join('');
  el.querySelectorAll('button').forEach(b=>b.onclick=()=>{state.selectedSource=b.dataset.sourceJump;state.view='feed';renderAll();});
}
function renderSummary(){
  const rows=filteredFeed(); const selected=state.selectedPainter&&painterById(state.selectedPainter);
  const defaultTitle=state.view==='saved'?'저장한 레퍼런스':'오늘의 페인팅 업데이트';
  $('#summaryTitle').textContent=selected?`${selected.name} 업데이트`:defaultTitle;
  $('#summaryText').textContent=selected?(selected.specialties||[]).join(' · '):(state.view==='saved'?'직접 저장해 둔 레퍼런스만 모아봅니다.':'YouTube와 공식 사이트의 최신 업데이트를 한곳에서 확인하세요.');
  $('#newCount').textContent=rows.filter(x=>ageHours(x.publishedAt)<=24).length;
}

// ---- Painter Manager ----
function slugify(s){ return String(s||'').trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60); }
function saveLocalPainters(){ localStorage.setItem('dvlPainterLocalList',JSON.stringify(state.painters)); state.localPaintersDirty=true; updateManagerStatus('로컬 변경사항 있음 · GitHub에는 아직 미반영'); renderAll(); renderManagerList(); }
function openManager(){ $('#managerBackdrop').classList.remove('hidden'); $('#managerModal').classList.add('open'); $('#managerModal').setAttribute('aria-hidden','false'); renderManagerList(); resetPainterForm(); }
function closeManager(){ $('#managerModal').classList.remove('open'); $('#managerModal').setAttribute('aria-hidden','true'); $('#managerBackdrop').classList.add('hidden'); }
function renderManagerList(){
  const el=$('#managerList'); if(!el) return;
  el.innerHTML=state.painters.map(p=>`<button class="manager-person ${p.active===false?'inactive':''}" data-edit-id="${esc(p.id)}"><span class="avatar">${initials(p.name)}</span><span><strong>${esc(p.name)}</strong><small>${p.active===false?'INACTIVE':esc((p.specialties||[]).slice(0,2).join(' · '))}</small></span><b>${p.active===false?'○':'●'}</b></button>`).join('');
  el.querySelectorAll('[data-edit-id]').forEach(b=>b.onclick=()=>fillPainterForm(b.dataset.editId));
}
function resetPainterForm(){
  $('#painterForm').reset(); $('#formOriginalId').value=''; $('#formActive').checked=true; $('#formTitle').textContent='ADD PAINTER'; $('#deletePainterBtn').classList.add('hidden');
}
function fillPainterForm(id){
  const p=painterById(id); if(!p) return; $('#formOriginalId').value=p.id; $('#formId').value=p.id||''; $('#formName').value=p.name||''; $('#formCountry').value=p.country||''; $('#formSpecialties').value=(p.specialties||[]).join(', '); $('#formYoutube').value=p.youtube||''; $('#formYoutubeChannelId').value=p.youtubeChannelId||''; $('#formWebsite').value=p.website||''; $('#formInstagram').value=p.instagram||''; $('#formPatreon').value=p.patreon||''; $('#formActive').checked=p.active!==false; $('#formRss').checked=Boolean(p.sources?.websiteRssAuto); $('#formSitemap').checked=Boolean(p.sources?.websiteSitemapAuto); $('#formTitle').textContent='EDIT PAINTER'; $('#deletePainterBtn').classList.remove('hidden');
}
function formPainter(){
  const originalId=$('#formOriginalId').value.trim(); const name=$('#formName').value.trim(); let id=$('#formId').value.trim()||slugify(name);
  if(!name) throw new Error('Name은 필수입니다.'); if(!id) throw new Error('ID를 만들 수 없습니다.');
  const existingOriginal=originalId && painterById(originalId); const sources=clone(existingOriginal?.sources||{});
  sources.websiteRssAuto=$('#formRss').checked; sources.websiteSitemapAuto=$('#formSitemap').checked;
  return { id, name, country:$('#formCountry').value.trim(), specialties:$('#formSpecialties').value.split(',').map(x=>x.trim()).filter(Boolean), youtubeChannelId:$('#formYoutubeChannelId').value.trim(), youtube:$('#formYoutube').value.trim(), instagram:$('#formInstagram').value.trim(), patreon:$('#formPatreon').value.trim(), website:$('#formWebsite').value.trim(), active:$('#formActive').checked, sources };
}
function exportPainters(){ const blob=new Blob([JSON.stringify(state.painters,null,2)+'\n'],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='painters.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),500); }
function updateManagerStatus(text,kind=''){ const el=$('#managerStatus'); if(!el) return; el.textContent=text; el.className=`small manager-status ${kind}`; }
async function importPainters(file){ const text=await file.text(); const parsed=JSON.parse(text); if(!Array.isArray(parsed)) throw new Error('painters.json 형식이 아닙니다.'); state.painters=parsed; saveLocalPainters(); resetPainterForm(); updateManagerStatus(`${parsed.length}명의 페인터를 가져왔습니다. GitHub에는 아직 미반영.`,'ok'); }
function b64Unicode(str){ const bytes=new TextEncoder().encode(str); let binary=''; bytes.forEach(b=>binary+=String.fromCharCode(b)); return btoa(binary); }
async function publishToGithub(){
  const owner=$('#githubOwner').value.trim(), repo=$('#githubRepo').value.trim(), branch=$('#githubBranch').value.trim()||'main', token=$('#githubToken').value.trim();
  if(!owner||!repo||!token){ updateManagerStatus('Owner / Repository / Token을 입력해주세요.','error'); return; }
  const api=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/data/painters.json?ref=${encodeURIComponent(branch)}`;
  updateManagerStatus('GitHub의 현재 painters.json 확인 중…');
  try{
    const headers={Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28'};
    const cur=await fetch(api,{headers}); if(!cur.ok) throw new Error(`GitHub 조회 실패 (${cur.status})`); const info=await cur.json();
    const body={message:'Update painters from DVL Painter Feed',content:b64Unicode(JSON.stringify(state.painters,null,2)+'\n'),sha:info.sha,branch};
    updateManagerStatus('painters.json 업로드 중…');
    const put=await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/data/painters.json`,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!put.ok){ const t=await put.text(); throw new Error(`GitHub 저장 실패 (${put.status}) ${t.slice(0,140)}`); }
    localStorage.removeItem('dvlPainterLocalList'); state.localPaintersDirty=false; updateManagerStatus('GitHub 반영 완료 ✓ · 새 페인터의 피드는 다음 6시간 자동 갱신 때 수집됩니다.','ok');
  }catch(err){ console.error(err); updateManagerStatus(err.message||'GitHub 반영 실패','error'); }
}

$('#searchInput').addEventListener('input',e=>{state.query=e.target.value;renderFeed();renderSummary();});
$('#showAllPainters').onclick=()=>{state.selectedPainter=null;closeProfile(false);renderAll();};
$('#refreshBtn').onclick=()=>loadData().catch(showLoadError);
$('#themeBtn').onclick=()=>{document.body.classList.toggle('light');localStorage.setItem('dvlPainterTheme',document.body.classList.contains('light')?'light':'dark');};
$('#closeProfileBtn').onclick=()=>closeProfile(true); $('#profileBackdrop').onclick=()=>closeProfile(true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){ if($('#profileDrawer').classList.contains('open')) closeProfile(true); if($('#managerModal').classList.contains('open')) closeManager(); }});
document.querySelectorAll('.main-tab').forEach(t=>t.onclick=()=>{state.view=t.dataset.view;renderAll();});

$('#managePaintersBtn').onclick=openManager; $('#closeManagerBtn').onclick=closeManager; $('#managerBackdrop').onclick=closeManager;
$('#addPainterBtn').onclick=resetPainterForm; $('#resetPainterFormBtn').onclick=resetPainterForm;
$('#exportPaintersBtn').onclick=exportPainters; $('#importPaintersInput').onchange=e=>{ if(e.target.files?.[0]) importPainters(e.target.files[0]).catch(err=>updateManagerStatus(err.message,'error')); e.target.value=''; };
$('#painterForm').onsubmit=e=>{ e.preventDefault(); try{ const p=formPainter(); const originalId=$('#formOriginalId').value.trim(); if(state.painters.some(x=>x.id===p.id && x.id!==originalId)) throw new Error('같은 ID의 페인터가 이미 있습니다.'); if(originalId){ const idx=state.painters.findIndex(x=>x.id===originalId); state.painters[idx]=p; } else state.painters.push(p); saveLocalPainters(); fillPainterForm(p.id); updateManagerStatus(`${p.name} 저장 완료 · GitHub에는 아직 미반영`,'ok'); }catch(err){ updateManagerStatus(err.message,'error'); }};
$('#deletePainterBtn').onclick=()=>{ const id=$('#formOriginalId').value.trim(); const p=painterById(id); if(!p) return; if(!confirm(`${p.name}을(를) 목록에서 완전히 삭제할까요?\n피드 기록 자체는 feed.json에 남아있을 수 있습니다.`)) return; state.painters=state.painters.filter(x=>x.id!==id); if(state.selectedPainter===id) state.selectedPainter=null; saveLocalPainters(); resetPainterForm(); updateManagerStatus(`${p.name} 삭제됨 · GitHub에는 아직 미반영`,'ok'); };
$('#publishGithubBtn').onclick=publishToGithub;

function showLoadError(err){ console.error(err); $('#feedStatus').textContent='데이터를 불러오지 못했습니다.'; }
if(localStorage.getItem('dvlPainterTheme')==='light') document.body.classList.add('light');
loadData().catch(showLoadError);
