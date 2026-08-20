const state = {
  painters: [], feed: [], selectedPainter: null, selectedSource: 'ALL', selectedTag: 'ALL',
  selectedAge: 'ALL', view: 'latest', query: '',
  saved: new Set(JSON.parse(localStorage.getItem('dvlPainterSaved') || '[]'))
};

const $ = (s) => document.querySelector(s);
const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function loadData(){
  const [paintersRes, feedRes] = await Promise.all([
    fetch('data/painters.json?ts=' + Date.now()), fetch('data/feed.json?ts=' + Date.now())
  ]);
  if(!paintersRes.ok || !feedRes.ok) throw new Error('Data fetch failed');
  state.painters = await paintersRes.json(); state.feed = await feedRes.json(); renderAll();
}

function painterById(id){ return state.painters.find(p => p.id === id); }
function initials(name){ return name.split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase(); }
function ageHours(dateStr){ return Math.max(0, (Date.now() - new Date(dateStr).getTime()) / 36e5); }
function relativeDate(dateStr){
  const d = new Date(dateStr); const h = Math.floor(ageHours(dateStr)); const days = Math.floor(h/24);
  if (h < 1) return '방금 전'; if (h < 24) return `${h}시간 전`; if (days < 7) return `${days}일 전`;
  return d.toLocaleDateString('ko-KR',{month:'short',day:'numeric'});
}
function freshness(item){ const h=ageHours(item.publishedAt); return h<=24?'NEW':h<=72?'3D':h<=168?'7D':''; }

function renderAll(){ renderPainters(); renderProfile(); renderFilters(); renderFeed(); renderSummary(); }

function renderPainters(){
  const el = $('#paintersList');
  const counts = Object.fromEntries(state.painters.map(p => [p.id, state.feed.filter(f=>f.painterId===p.id).length]));
  el.innerHTML = state.painters.map(p => `
    <button class="painter-item ${state.selectedPainter===p.id?'active':''}" data-id="${p.id}">
      <span class="avatar">${initials(p.name)}</span>
      <span class="painter-meta"><strong>${esc(p.name)}</strong><span>${esc((p.specialties||[]).slice(0,2).join(' · '))}</span></span>
      <span class="count-badge">${counts[p.id]||0}</span>
    </button>`).join('');
  el.querySelectorAll('.painter-item').forEach(btn=>btn.addEventListener('click',()=>{
    state.selectedPainter = state.selectedPainter === btn.dataset.id ? null : btn.dataset.id; renderAll();
  }));
}

function renderProfile(){
  const el=$('#painterProfile'); const p=state.selectedPainter && painterById(state.selectedPainter);
  if(!p){ el.classList.add('hidden'); el.innerHTML=''; return; }
  const links=[['YouTube',p.youtube],['Instagram',p.instagram],['Patreon',p.patreon],['Website',p.website]].filter(x=>x[1]);
  el.innerHTML=`
    <div class="profile-head"><span class="profile-avatar">${initials(p.name)}</span><div><strong>${esc(p.name)}</strong><span>${esc(p.country||'')}</span></div></div>
    <div class="profile-tags">${(p.specialties||[]).map(t=>`<span>#${esc(t)}</span>`).join('')}</div>
    <div class="profile-links">${links.map(([name,url])=>`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${name} ↗</a>`).join('')}</div>`;
  el.classList.remove('hidden');
}

function renderFilters(){
  const sources = ['ALL', ...new Set(state.feed.map(x=>x.source).filter(Boolean))];
  $('#sourceFilters').innerHTML = sources.map(s=>`<button class="filter-btn ${state.selectedSource===s?'active':''}" data-source="${esc(s)}">${esc(s)}</button>`).join('');
  $('#sourceFilters').querySelectorAll('button').forEach(b=>b.onclick=()=>{state.selectedSource=b.dataset.source;renderAll();});

  const freq={}; state.feed.flatMap(x=>x.tags||[]).forEach(t=>freq[t]=(freq[t]||0)+1);
  const tags=['ALL',...Object.keys(freq).sort((a,b)=>freq[b]-freq[a]).slice(0,18)];
  $('#tagFilters').innerHTML=tags.map(t=>`<button class="filter-btn ${state.selectedTag===t?'active':''}" data-tag="${esc(t)}">${t==='ALL'?'ALL':'# '+esc(t)}</button>`).join('');
  $('#tagFilters').querySelectorAll('button').forEach(b=>b.onclick=()=>{state.selectedTag=b.dataset.tag;renderAll();});

  $('#ageFilters').querySelectorAll('button').forEach(b=>{b.classList.toggle('active',state.selectedAge===b.dataset.age); b.onclick=()=>{state.selectedAge=b.dataset.age;renderAll();};});
}

function filteredFeed(){
  const q = state.query.trim().toLowerCase();
  return state.feed
    .filter(x => state.view==='latest' || state.saved.has(x.id))
    .filter(x => !state.selectedPainter || x.painterId===state.selectedPainter)
    .filter(x => state.selectedSource==='ALL' || x.source===state.selectedSource)
    .filter(x => state.selectedTag==='ALL' || (x.tags||[]).includes(state.selectedTag))
    .filter(x => state.selectedAge==='ALL' || ageHours(x.publishedAt) <= Number(state.selectedAge)*24)
    .filter(x => { if(!q) return true; const p=painterById(x.painterId); return [x.title,x.description,p?.name,...(x.tags||[])].join(' ').toLowerCase().includes(q); })
    .sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));
}

function renderFeed(){
  const list=$('#feedList'); const rows=filteredFeed(); list.innerHTML=''; const tpl=$('#feedCardTemplate');
  for(const item of rows){
    const p=painterById(item.painterId)||{name:'Unknown'}; const node=tpl.content.cloneNode(true); const card=node.querySelector('.feed-card');
    const thumbWrap=node.querySelector('.thumb-wrap'); const img=node.querySelector('.thumb'); thumbWrap.href=item.url; img.src=item.thumbnail; img.alt=item.title;
    img.onerror=()=>{img.remove();thumbWrap.classList.add('thumb-fallback');};
    node.querySelector('.source-badge').textContent=(item.source||'LINK').toUpperCase();
    const fresh=freshness(item); const freshBadge=node.querySelector('.fresh-badge'); if(fresh){freshBadge.textContent=fresh;freshBadge.classList.remove('hidden');card.classList.add('is-fresh');}
    const painterBtn=node.querySelector('.painter-link'); painterBtn.textContent=p.name; painterBtn.onclick=()=>{state.selectedPainter=item.painterId;renderAll();window.scrollTo({top:0,behavior:'smooth'});};
    node.querySelector('.date').textContent=relativeDate(item.publishedAt);
    const title=node.querySelector('.title'); title.textContent=item.title; title.href=item.url;
    node.querySelector('.description').textContent=item.description||'';
    node.querySelector('.tag-list').innerHTML=(item.tags||[]).map(t=>`<button class="tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join('');
    node.querySelectorAll('.tag').forEach(t=>t.onclick=()=>{state.selectedTag=t.dataset.tag;renderAll();window.scrollTo({top:0,behavior:'smooth'});});
    const save=node.querySelector('.save-btn'); const isSaved=state.saved.has(item.id); save.textContent=isSaved?'★ SAVED':'☆ SAVE'; save.classList.toggle('saved',isSaved); save.onclick=()=>toggleSave(item.id);
    node.querySelector('.open-link').href=item.url; list.appendChild(card);
  }
  $('#emptyState').classList.toggle('hidden',rows.length!==0); $('#feedStatus').textContent=`${rows.length} items · ${state.feed.length} total`;
}

function toggleSave(id){ state.saved.has(id)?state.saved.delete(id):state.saved.add(id); localStorage.setItem('dvlPainterSaved',JSON.stringify([...state.saved])); renderFeed(); renderSummary(); }
function renderSummary(){
  const rows=filteredFeed(); const selected=state.selectedPainter&&painterById(state.selectedPainter);
  $('#summaryTitle').textContent=selected?`${selected.name} 업데이트`:(state.view==='saved'?'저장한 레퍼런스':'오늘의 페인팅 업데이트');
  $('#summaryText').textContent=selected?(selected.specialties||[]).join(' · '):'최신 영상과 저장한 레퍼런스를 빠르게 확인하세요.';
  $('#newCount').textContent=rows.filter(x=>ageHours(x.publishedAt)<=24).length;
}

$('#searchInput').addEventListener('input',e=>{state.query=e.target.value;renderFeed();renderSummary();});
$('#showAllPainters').onclick=()=>{state.selectedPainter=null;renderAll();};
$('#refreshBtn').onclick=()=>loadData().catch(showLoadError);
$('#themeBtn').onclick=()=>{document.body.classList.toggle('light');localStorage.setItem('dvlPainterTheme',document.body.classList.contains('light')?'light':'dark');};
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');state.view=t.dataset.view;renderFeed();renderSummary();});
function showLoadError(err){ console.error(err); $('#feedStatus').textContent='데이터를 불러오지 못했습니다.'; }
if(localStorage.getItem('dvlPainterTheme')==='light') document.body.classList.add('light');
loadData().catch(showLoadError);
