const state = {
  painters: [], feed: [], meta: {}, selectedPainter: null, selectedSource: 'ALL', selectedTag: 'ALL',
  selectedAge: 'ALL', view: 'latest', query: '',
  display: localStorage.getItem('dvlPainterDisplay') || 'list',
  includeYoutubeThumbs: localStorage.getItem('dvlIncludeYoutubeThumbs') === 'true',
  saved: new Set(JSON.parse(localStorage.getItem('dvlPainterSaved') || '[]'))
};

const $ = (s) => document.querySelector(s);
const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function loadData(){
  const ts = Date.now();
  const [paintersRes, feedRes, metaRes] = await Promise.all([
    fetch('data/painters.json?ts=' + ts), fetch('data/feed.json?ts=' + ts), fetch('data/meta.json?ts=' + ts).catch(()=>null)
  ]);
  if(!paintersRes.ok || !feedRes.ok) throw new Error('Data fetch failed');
  state.painters = await paintersRes.json();
  state.feed = await feedRes.json();
  if(metaRes && metaRes.ok) state.meta = await metaRes.json();
  renderAll();
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
function hasImage(item){ return Boolean((item.thumbnail||'').trim()); }

function renderAll(){ renderPainters(); renderProfile(); renderFilters(); renderFeed(); renderSummary(); renderSourceSummary(); renderDisplayButtons(); renderLastUpdated(); }

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
  el.innerHTML = state.painters.map(p => `
    <button class="painter-item ${state.selectedPainter===p.id?'active':''}" data-id="${p.id}">
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
  el.querySelectorAll('[data-profile-tag]').forEach(btn=>btn.onclick=()=>{ state.selectedTag=btn.dataset.profileTag; renderAll(); closeProfile(false); window.scrollTo({top:0,behavior:'smooth'}); });
}

function openProfile(){ $('#profileDrawer').classList.add('open'); $('#profileDrawer').setAttribute('aria-hidden','false'); $('#profileBackdrop').classList.remove('hidden'); requestAnimationFrame(()=>$('#profileBackdrop').classList.add('show')); }
function closeProfile(clearSelection=true){ $('#profileDrawer').classList.remove('open'); $('#profileDrawer').setAttribute('aria-hidden','true'); $('#profileBackdrop').classList.remove('show'); setTimeout(()=>$('#profileBackdrop').classList.add('hidden'),180); if(clearSelection && state.selectedPainter){ state.selectedPainter=null; renderAll(); } }

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

function baseFilteredFeed(){
  const q = state.query.trim().toLowerCase();
  return state.feed
    .filter(x => state.view!=='saved' || state.saved.has(x.id))
    .filter(x => !state.selectedPainter || x.painterId===state.selectedPainter)
    .filter(x => state.selectedSource==='ALL' || x.source===state.selectedSource)
    .filter(x => state.selectedTag==='ALL' || (x.tags||[]).includes(state.selectedTag))
    .filter(x => state.selectedAge==='ALL' || ageHours(x.publishedAt) <= Number(state.selectedAge)*24)
    .filter(x => { if(!q) return true; const p=painterById(x.painterId); return [x.title,x.description,p?.name,...(x.tags||[])].join(' ').toLowerCase().includes(q); })
    .sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));
}
function filteredFeed(){
  let rows=baseFilteredFeed();
  if(state.view==='images') rows=rows.filter(hasImage).filter(x=>state.includeYoutubeThumbs || x.source!=='YouTube');
  return rows;
}

function renderFeed(){
  const list=$('#feedList'); const rows=filteredFeed(); list.innerHTML='';
  const galleryMode=state.view==='images';
  $('#galleryOptions').classList.toggle('hidden',!galleryMode);
  $('#displayTabs').classList.toggle('hidden',galleryMode);
  list.className = galleryMode ? 'feed-list artwork-gallery' : `feed-list ${state.display==='gallery'?'gallery-view':'list-view'}`;
  if(galleryMode){
    const tpl=$('#imageCardTemplate');
    for(const item of rows){
      const p=painterById(item.painterId)||{name:'Unknown'}; const node=tpl.content.cloneNode(true);
      const link=node.querySelector('.image-link'); link.href=item.url;
      const img=node.querySelector('.gallery-image'); img.src=item.thumbnail; img.alt=item.title;
      img.onerror=()=>node.querySelector('.image-card')?.remove();
      node.querySelector('.gallery-source').textContent=(item.source||'LINK').toUpperCase();
      node.querySelector('.gallery-date').textContent=relativeDate(item.publishedAt);
      const painter=node.querySelector('.gallery-painter'); painter.textContent=p.name; painter.onclick=()=>{state.selectedPainter=item.painterId;renderAll();openProfile();};
      const title=node.querySelector('.gallery-title'); title.textContent=item.title; title.href=item.url;
      list.appendChild(node);
    }
  } else {
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
      node.querySelectorAll('.tag').forEach(t=>t.onclick=()=>{state.selectedTag=t.dataset.tag;renderAll();window.scrollTo({top:0,behavior:'smooth'});});
      const save=node.querySelector('.save-btn'); const isSaved=state.saved.has(item.id); save.textContent=isSaved?'★ SAVED':'☆ SAVE'; save.classList.toggle('saved',isSaved); save.onclick=()=>toggleSave(item.id);
      node.querySelector('.open-link').href=item.url; list.appendChild(card);
    }
  }
  $('#emptyState').classList.toggle('hidden',rows.length!==0);
  $('#feedStatus').textContent=galleryMode?`${rows.length} images · ${state.feed.filter(hasImage).length} image-ready`:`${rows.length} items · ${state.feed.length} total`;
}

function toggleSave(id){ state.saved.has(id)?state.saved.delete(id):state.saved.add(id); localStorage.setItem('dvlPainterSaved',JSON.stringify([...state.saved])); renderFeed(); renderSummary(); if(state.selectedPainter) renderProfile(); }
function renderSourceSummary(){
  const el=$('#sourceSummary'); if(!el) return; const counts={}; state.feed.forEach(x=>{const k=x.source||'Other';counts[k]=(counts[k]||0)+1;});
  const order=['YouTube','ArtStation','Website',...Object.keys(counts).filter(x=>!['YouTube','ArtStation','Website'].includes(x))];
  el.innerHTML=order.filter(x=>counts[x]).map(x=>`<button data-source-jump="${esc(x)}"><span>${esc(x)}</span><strong>${counts[x]}</strong></button>`).join('');
  el.querySelectorAll('button').forEach(b=>b.onclick=()=>{state.selectedSource=b.dataset.sourceJump;renderAll();});
}
function renderSummary(){
  const rows=filteredFeed(); const selected=state.selectedPainter&&painterById(state.selectedPainter);
  const defaultTitle=state.view==='saved'?'저장한 레퍼런스':state.view==='images'?'작품 이미지 갤러리':'오늘의 페인팅 업데이트';
  $('#summaryTitle').textContent=selected?`${selected.name} 업데이트`:defaultTitle;
  $('#summaryText').textContent=selected?(selected.specialties||[]).join(' · '):(state.view==='images'?'공식 사이트 등 공개 소스에서 수집된 이미지가 있는 게시물을 모아봅니다.':'최신 영상과 저장한 레퍼런스를 빠르게 확인하세요.');
  $('#newCount').textContent=rows.filter(x=>ageHours(x.publishedAt)<=24).length;
}
function renderDisplayButtons(){ document.querySelectorAll('.display-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.display===state.display)); }

$('#searchInput').addEventListener('input',e=>{state.query=e.target.value;renderFeed();renderSummary();});
$('#showAllPainters').onclick=()=>{state.selectedPainter=null;closeProfile(false);renderAll();};
$('#refreshBtn').onclick=()=>loadData().catch(showLoadError);
$('#themeBtn').onclick=()=>{document.body.classList.toggle('light');localStorage.setItem('dvlPainterTheme',document.body.classList.contains('light')?'light':'dark');};
$('#closeProfileBtn').onclick=()=>closeProfile(true); $('#profileBackdrop').onclick=()=>closeProfile(true);
$('#includeYoutubeThumbs').checked=state.includeYoutubeThumbs;
$('#includeYoutubeThumbs').onchange=e=>{state.includeYoutubeThumbs=e.target.checked;localStorage.setItem('dvlIncludeYoutubeThumbs',String(state.includeYoutubeThumbs));renderFeed();renderSummary();};
document.addEventListener('keydown',e=>{if(e.key==='Escape' && $('#profileDrawer').classList.contains('open')) closeProfile(true);});
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');state.view=t.dataset.view;renderFeed();renderSummary();});
document.querySelectorAll('.display-btn').forEach(btn=>btn.onclick=()=>{state.display=btn.dataset.display;localStorage.setItem('dvlPainterDisplay',state.display);renderFeed();renderDisplayButtons();});
function showLoadError(err){ console.error(err); $('#feedStatus').textContent='데이터를 불러오지 못했습니다.'; }
if(localStorage.getItem('dvlPainterTheme')==='light') document.body.classList.add('light');
loadData().catch(showLoadError);
