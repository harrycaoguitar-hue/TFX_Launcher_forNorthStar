/* One public-directory cache and refresh timer for the server page and home count. */
(() => {
  'use strict';
  const root = document.getElementById('northstarServers');
  if (!root) return;
  const $ = id => document.getElementById(id);
  const list = $('serverListRows');
  const search = $('serverListSearch');
  const details = $('serverListDetails');
  const refreshButton = $('serverListRefresh');
  const summary = $('serverListSummary');
  const status = $('serverListStatus');
  const homeStatus = $('serverstatus');
  const networkButtons = [...document.querySelectorAll('[data-launch-region]')];
  const pageScroller = root.closest('.contentContainer');
  const records = new Map();
  const inflight = new Map();
  let region = settings.northstarRegion === 'global' ? 'global' : 'cn';
  let selected = '';
  let pollTimer = null;
  let requestCount = 0;
  let currentActive = false;
  let changingRegion = false;
  const words = {
    'zh-CN': {
      servers:'服务器', players:'玩家', online:'人在线', lastKnown:'上次记录', loading:'正在获取服务器…', waiting:'等待刷新', empty:'当前没有公开服务器',
      noMatches:'没有匹配的服务器', unavailable:'服务器列表暂时无法获取，请稍后刷新', stale:'刷新失败，显示上次获取的列表',
      updated:'更新于', password:'需要密码', open:'公开', map:'地图', mode:'模式', location:'区域',
      mods:'需要的客户端模组', description:'服务器介绍', noDescription:'服务器未提供介绍', close:'收起详情',
      gameHint:'请在游戏内的服务器浏览器中加入。', truncated:'仅显示前 500 台服务器',
      sources:{cn:'国内 · Northstar CN',global:'全球 · Northstar Global'},
      errors:{timeout:'连接超时',http:'服务暂不可用',format:'服务返回的列表格式无效','too-large':'服务返回的列表过大',network:'网络连接失败'}
    },
    'en-US': {
      servers:'servers', players:'players', online:'players online', lastKnown:'Last known', loading:'Loading servers…', waiting:'Waiting for refresh', empty:'No public servers right now',
      noMatches:'No servers match your search', unavailable:'Server list unavailable. Try refreshing later.', stale:'Refresh failed. Showing the last available list.',
      updated:'Updated', password:'Password required', open:'Public', map:'Map', mode:'Mode', location:'Region',
      mods:'Required client mods', description:'About this server', noDescription:'No description provided', close:'Close details',
      gameHint:'Join through the server browser in the game.', truncated:'Showing the first 500 servers only',
      sources:{cn:'China · Northstar CN',global:'Global · Northstar Global'},
      errors:{timeout:'Connection timed out',http:'Service unavailable',format:'Invalid server response','too-large':'Server response too large',network:'Network connection failed'}
    }
  };
  const locale = () => window.I18n?.locale || 'en-US';
  const copy = (zh,en) => locale() === 'zh-CN' ? zh : I18n.text(en);
  function localizedWords(zh,en) {
    return Object.fromEntries(Object.entries(en).map(([key,value])=>[key,value&&typeof value==='object'?localizedWords(zh[key],value):copy(zh[key],value)]));
  }
  const t = () => localizedWords(words['zh-CN'],words['en-US']);
  const mapNames = {
    mp_angel_city:['天使城','Angel City'], mp_black_water_canal:['黑水运河','Black Water Canal'],
    mp_coliseum:['角斗场','Coliseum'], mp_coliseum_column:['圆柱角斗场','Pillars'], mp_colony02:['殖民地','Colony'],
    mp_complex3:['综合设施','Complex'], mp_crashsite3:['坠机现场','Crash Site'], mp_drydock:['干船坞','Drydock'],
    mp_eden:['伊甸园','Eden'], mp_forwardbase_kodai:['虎大前线基地','Forwardbase Kodai'],
    mp_glitch:['故障','Glitch'], mp_grave:['遗迹','Relic'], mp_homestead:['家园','Homestead'],
    mp_lf_deck:['甲板','Deck'], mp_lf_meadow:['草地','Meadow'], mp_lf_stacks:['集装箱','Stacks'],
    mp_lf_traffic:['交通','Traffic'], mp_lf_township:['城镇','Township'], mp_lf_uma:['UMA','UMA'],
    mp_relic02:['遗迹','Relic'], mp_rise:['崛起','Rise'], mp_thaw:['系外行星','Exoplanet'], mp_wargames:['战争游戏','War Games']
  };
  const modeNames = {aitdm:['消耗战','Attrition'],tdm:['铁驭对战','Pilots vs. Pilots'],cp:['据点争夺','Amped Hardpoint'],
    ctf:['夺旗','Capture the Flag'],lts:['最后泰坦','Last Titan Standing'],ttdm:['泰坦争霸','Titan Brawl'],
    mfd:['死亡标记','Marked for Death'],fd:['边境防御','Frontier Defense'],ps:['强点','Live Fire'],
    coliseum:['角斗场','Coliseum'],gg:['枪械游戏','Gun Game']};
  const label = (table,value) => table[value] ? copy(...table[value]) : value || '—';
  const node = (tag,className,text) => { const el=document.createElement(tag); if(className)el.className=className;if(text!==undefined)el.textContent=text;return el; };
  const userNode = (tag,className,text) => { const el=node(tag,className,text);el.setAttribute('data-i18n-ignore','');return el; };
  function active() {
    const fold = window.Fold;
    const visible = fold?.view === 'servers' || (fold?.view === 'home' && fold?.mode === 'northstar');
    return document.visibilityState !== 'hidden' && visible && !document.querySelector('.popup.shown');
  }
  function stopPolling() { if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer=null; } }
  function schedule() { stopPolling(); if(active())pollTimer=setTimeout(()=>{pollTimer=null;refresh(false);},60000); }
  function timestamp(value) {
    if(!value)return '';
    return new Intl.DateTimeFormat(locale(),{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value));
  }
  function renderDetails(server) {
    details.replaceChildren();
    details.hidden=!server;
    if(!server)return;
    const close=node('button','server-details-close',t().close);close.type='button';close.addEventListener('click',()=>{selected='';render();list.querySelector('[data-server-key="'+server.key+'"]')?.focus({preventScroll:true});});
    const heading=userNode('h4','',server.name);
    const description=userNode('p','server-details-description',server.description||t().noDescription);
    const meta=userNode('p','server-details-meta',[
      `${t().map}: ${label(mapNames,server.map)}`,`${t().mode}: ${label(modeNames,server.mode)}`,
      server.location?`${t().location}: ${server.location}`:'',server.password?t().password:t().open
    ].filter(Boolean).join(' · '));
    details.append(close,heading,description,meta);
    if(server.requiredMods?.length){details.append(userNode('p','server-required-mods',t().mods+': '+server.requiredMods.map(mod=>mod.name+(mod.version?' '+mod.version:'')).join(' · ')));}
    details.append(node('p','server-details-hint',t().gameHint));
  }
  function render() {
    const scrollTop=pageScroller?.scrollTop || 0;
    const data=records.get(region);
    const loading=inflight.has(region);
    const text=t();
    root.dataset.serverState=loading?'loading':(data?.status||'idle');
    root.setAttribute('aria-busy',String(loading));
    refreshButton.disabled=loading;
    for(const button of root.querySelectorAll('[data-server-region]')){
      const chosen=button.dataset.serverRegion===region;
      button.classList.toggle('selected',chosen);button.setAttribute('aria-pressed',String(chosen));
    }
    for(const button of networkButtons){
      const chosen=button.dataset.launchRegion===region;
      button.classList.toggle('selected',chosen);button.setAttribute('aria-pressed',String(chosen));
    }
    const servers=Array.isArray(data?.servers)?data.servers:[];
    const total=servers.reduce((n,server)=>n+server.players,0);
    summary.textContent=!data ? (loading?text.loading:text.waiting) : data.status==='unavailable' ? text.unavailable : servers.length+' '+text.servers+' · '+total+' '+text.players;
    summary.title=text.sources[region]+(data?.sourceUrl?' · '+data.sourceUrl:'');
    if(data?.status==='stale')status.textContent=text.stale+(data.fetchedAt?' · '+text.updated+' '+timestamp(data.fetchedAt):'');
    else if(data?.status==='unavailable')status.textContent=text.unavailable+(data.error?' · '+(text.errors[data.error]||text.errors.network):'');
    else if(loading)status.textContent=text.loading;
    else status.textContent=data?.fetchedAt?text.sources[region]+' · '+text.updated+' '+timestamp(data.fetchedAt):text.waiting;
    if(data?.truncated)status.textContent+=' · '+text.truncated;
    const query=search.value.trim().toLocaleLowerCase();
    const rows=servers.filter(server=>!query||[server.name,server.description,server.map,server.mode,server.location,label(mapNames,server.map),label(modeNames,server.mode)].join(' ').toLocaleLowerCase().includes(query))
      .sort((a,b)=>b.players-a.players||a.name.localeCompare(b.name,locale())||a.key.localeCompare(b.key));
    const focusKey=list.contains(document.activeElement)?document.activeElement.dataset.serverKey:null;
    const fragment=document.createDocumentFragment();
    if(!rows.length){fragment.append(node('p','server-list-empty',loading&&!data?text.loading:data?.status==='unavailable'?text.unavailable:query?text.noMatches:data?text.empty:text.waiting));}
    for(const server of rows){
      const row=node('button','server-row');row.type='button';row.dataset.serverKey=server.key;
      row.setAttribute('aria-pressed',String(selected===server.key));row.setAttribute('aria-controls','serverListDetails');
      const main=node('span','server-row-main');
      const title=userNode('span','server-row-title',server.name);title.title=server.name;
      main.append(title,userNode('span','server-row-meta',[server.location,server.password?text.password:text.open].filter(Boolean).join(' · ')));
      const map=node('span','server-row-map',label(mapNames,server.map));map.title=map.textContent;
      const mode=node('span','server-row-mode',label(modeNames,server.mode));mode.title=mode.textContent;
      const count=node('span','server-row-count',server.players+' / '+(server.maxPlayers||'—'));
      count.setAttribute('aria-label',server.players+' '+text.players);
      row.append(main,map,mode,count);row.addEventListener('click',()=>{selected=selected===server.key?'':server.key;render();});fragment.append(row);
    }
    renderDetails(servers.find(server=>server.key===selected));
    // Keep expanded details beside their row within the same page flow.
    const selectedRow=[...fragment.children].find(row=>row.dataset.serverKey===selected);
    if(selectedRow&&!details.hidden)selectedRow.after(details);else root.append(details);
    list.replaceChildren(fragment);
    if(focusKey)list.querySelector('[data-server-key="'+focusKey+'"]')?.focus({preventScroll:true});
    if(pageScroller)pageScroller.scrollTop=scrollTop;
    if(homeStatus){
      const state=data?.status|| (loading?'loading':'idle');
      const footer=homeStatus.closest('.fold-home-footer');
      if(footer)footer.dataset.serverState=state;
      homeStatus.classList.remove('checking','up','down');
      homeStatus.classList.add(state==='online'?'up':state==='unavailable'?'down':'checking');
      const count=total+' '+text.online+' · '+servers.length+' '+text.servers;
      homeStatus.textContent=text.sources[region]+' · '+(!data ? (loading?text.loading:text.waiting) : state==='unavailable' ? text.unavailable : (state==='stale'?text.lastKnown+' · ':'')+count+(data.truncated?' · '+text.truncated:''));
      homeStatus.title=state==='stale'?text.stale+(data.fetchedAt?' · '+text.updated+' '+timestamp(data.fetchedAt):''):data?.fetchedAt?text.updated+' '+timestamp(data.fetchedAt):'';
    }
  }
  function refresh(force=false) {
    if(!active())return Promise.resolve(null);
    const requestedRegion=region;
    if(inflight.has(requestedRegion))return inflight.get(requestedRegion);
    stopPolling();requestCount++;
    const promise=Promise.resolve().then(()=>ipcRenderer.invoke('server-list-get',{region:requestedRegion,force:force===true}))
      .then(data=>{
        if(!data||!Array.isArray(data.servers)||!['online','stale','unavailable'].includes(data.status))throw new Error('Invalid server-list IPC result');
        records.set(requestedRegion,data);return data;
      }).catch(()=>{
        const previous=records.get(requestedRegion);
        const failed=Object.assign({},previous||{servers:[],region:requestedRegion},{status:previous?.fetchedAt!=null?'stale':'unavailable',error:'network'});
        records.set(requestedRegion,failed);return failed;
      }).finally(()=>{inflight.delete(requestedRegion);if(region===requestedRegion&&active()){render();schedule();}});
    inflight.set(requestedRegion,promise);render();return promise;
  }
  function updateVisibility() {
    // #serverPage owns visibility. Hiding its child before a navigation capture
    // would erase the outgoing server page from the transition snapshot.
    const visible=active();
    if(!visible){currentActive=false;stopPolling();return;}
    if(!currentActive){currentActive=true;render();refresh(false);}
  }
  async function chooseRegion(next){
    if(!['cn','global'].includes(next)||next===region||changingRegion||Settings.saving)return;
    changingRegion=true;
    for(const group of document.querySelectorAll('.servers-region')) group.setAttribute('aria-busy','true');
    try {
      const response=await Settings.savePatch({northstarRegion:next,modProfileServer:next});
      if(!response.ok || response.settings.northstarRegion!==next){
        const reason=Settings.modStateError(response.code,'settings.regionChangeFailed');
        new Toast({key:'server-region-change',scheme:'error',title:I18n.t('settings.regionChangeFailed'),description:I18n.t(reason),timeout:7000});
        return;
      }
      region=next;selected='';
      window.dispatchEvent(new CustomEvent('vyra-region-changed',{detail:{region}}));
      render();refresh(false);
    } finally {
      changingRegion=false;
      region=settings.northstarRegion==='global'?'global':'cn';
      for(const group of document.querySelectorAll('.servers-region')) group.removeAttribute('aria-busy');
      render();
    }
  }
  for(const button of root.querySelectorAll('[data-server-region]'))button.addEventListener('click',()=>chooseRegion(button.dataset.serverRegion));
  for(const button of networkButtons)button.addEventListener('click',()=>chooseRegion(button.dataset.launchRegion));
  refreshButton.addEventListener('click',()=>refresh(true));search.addEventListener('input',render);
  document.addEventListener('visibilitychange',updateVisibility);
  window.addEventListener('vyra-view-change',updateVisibility);
  window.addEventListener('vyra-language-changed',render);
  window.addEventListener('vyra-settings-restored',()=>{
    region=settings.northstarRegion==='global'?'global':'cn';selected='';render();refresh(false);
  });
  ipcRenderer.on('changed-settings',(_event,value)=>{
    if(!changingRegion && value && Object.prototype.hasOwnProperty.call(value,'northstarRegion')){
      region=settings.northstarRegion==='global'?'global':'cn';selected='';render();refresh(false);
    }
  });
  if(typeof events==='object' && typeof events.on==='function')events.on('popup-changed',()=>queueMicrotask(updateVisibility));
  new MutationObserver(updateVisibility).observe(document.body,{attributes:true,attributeFilter:['data-fold-view']});
  window.VyraServers=Object.freeze({refresh,get state(){return {region,active:active(),polling:pollTimer!==null,loading:inflight.has(region),requestCount,status:records.get(region)?.status||'idle',count:records.get(region)?.servers.length||0,fetchedAt:records.get(region)?.fetchedAt||null};}});
  render();updateVisibility();
})();
