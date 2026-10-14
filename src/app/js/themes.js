/* Palette choices deliberately use a single set of semantic surface tokens.
 * Preview changes appearance only; Settings.apply owns persistence. */
(() => {
  'use strict';
  const palettes = [
    {id:'aurora',name:'极光青',caption:'青绿 · 夜色',bg:'#0c1920',surface:'#203943',ink:'#edf9fa',muted:'#adcad1',accent:'#9cebd6',secondary:'#aab9ed',buttonInk:'#123c36'},
    {id:'abyss',name:'深海蓝',caption:'蔚蓝 · 深海',bg:'#0b1728',surface:'#233c5d',ink:'#eef6ff',muted:'#b0c6e2',accent:'#9ecaff',secondary:'#b5a9f1',buttonInk:'#163354'},
    {id:'nebula',name:'星云紫',caption:'紫罗兰 · 星云',bg:'#1b142d',surface:'#423252',ink:'#faf1ff',muted:'#cbbadf',accent:'#d3b1fa',secondary:'#e6b7d6',buttonInk:'#44265f'},
    {id:'sakura',name:'绯樱粉',caption:'玫瑰 · 薄暮',bg:'#291820',surface:'#583746',ink:'#fff2f6',muted:'#dfbccb',accent:'#f3b5d0',secondary:'#d2b7f0',buttonInk:'#5a2d42'},
    {id:'ember',name:'熔金橙',caption:'琥珀 · 暖夜',bg:'#231b12',surface:'#51402a',ink:'#fff7e9',muted:'#d6c2a6',accent:'#f2c184',secondary:'#ebbfa8',buttonInk:'#4c3212'},
    {id:'grove',name:'青柠绿',caption:'嫩绿 · 林荫',bg:'#152016',surface:'#344934',ink:'#f4fbed',muted:'#bdceb3',accent:'#cae6a5',secondary:'#9cd7bd',buttonInk:'#2f421c'},
    {id:'sandstone',name:'砂岩棕',caption:'沙金 · 岩层',bg:'#241e1b',surface:'#50463d',ink:'#fff4e9',muted:'#d4c1b2',accent:'#ddc1a0',secondary:'#c6a7b5',buttonInk:'#443225'},
    {id:'graphite',name:'岩墨灰',caption:'银灰 · 低饱和',bg:'#181b20',surface:'#373f48',ink:'#f4f7fb',muted:'#bec8d2',accent:'#d0dae8',secondary:'#aebfd5',buttonInk:'#293643'},
    {id:'glacier',name:'冰川蓝',caption:'浅蓝 · 晨光',bg:'#d1e4ee',surface:'#f1f8fc',ink:'#173748',muted:'#45657b',accent:'#265f92',secondary:'#655593',buttonInk:'#ffffff',light:true},
    {id:'mist',name:'云雾白',caption:'珍珠 · 薄雾',bg:'#e6e4df',surface:'#fffdf6',ink:'#323c40',muted:'#646b6d',accent:'#426d69',secondary:'#7c626f',buttonInk:'#ffffff',light:true}
  ];
  const map = new Map(palettes.map(palette => [palette.id, palette]));
  const normalize = id => map.has(id) ? id : 'aurora';
  const rgb = hex => [1,3,5].map(offset => parseInt(hex.slice(offset,offset+2),16)).join(',');
  let current = 'aurora';

  function syncChoices() {
    for (const button of document.querySelectorAll('[data-theme-choice]')) {
      const chosen = button.dataset.themeChoice === current;
      button.classList.toggle('selected', chosen);
      button.setAttribute('aria-pressed', String(chosen));
    }
    const input = document.querySelector('.option[name="theme"] .actions input');
    if (input) input.value = current;
    const hint = document.getElementById('themePreviewHint');
    if (hint) {
      const persisted = normalize(settings.theme);
      hint.textContent = current === persisted ? `当前主题：${map.get(current).name}` : `正在预览 ${map.get(current).name} · 保存后保留`;
    }
  }

  function apply(id) {
    current = normalize(id);
    const palette = map.get(current);
    const root = document.documentElement;
    root.dataset.theme = current;
    root.dataset.themeTone = palette.light ? 'light' : 'dark';
    const tokens = {
      'theme-bg':palette.bg,'theme-surface':palette.surface,'bg':palette.bg,'selbg':palette.surface,'ink':palette.ink,'muted':palette.muted,
      'cyan':palette.accent,'lavender':palette.secondary,'theme-primary-ink':palette.buttonInk,
      'theme-accent-rgb':rgb(palette.accent),'theme-secondary-rgb':rgb(palette.secondary),
      'theme-surface-rgb':rgb(palette.surface),'theme-ink-rgb':rgb(palette.ink),
      'theme-bg-rgb':rgb(palette.bg),'blue':rgb(palette.accent),'red':rgb(palette.accent),
      'blue2':rgb(palette.secondary),'orange2':rgb(palette.secondary),
      'theme-error':palette.light?'#ad3156':'#f3b2c5','theme-warning':palette.light?'#83591b':'#e9ce9f',
      'line':`rgba(${rgb(palette.ink)},${palette.light?'.15':'.13'})`,
      'theme-glass-alpha':palette.light?'.56':'.44',
      'theme-popup-alpha':palette.light?'.79':'.75',
      'theme-shadow':palette.light?'rgba(49,77,88,.14)':'rgba(0,0,0,.2)'
    };
    for (const [name,value] of Object.entries(tokens)) root.style.setProperty('--'+name,value);
    root.style.colorScheme = palette.light ? 'light' : 'dark';
    syncChoices();
    return current;
  }

  function mount() {
    const grid = document.getElementById('themeChoices');
    if (!grid || grid.children.length) return;
    for (const palette of palettes) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-choice';
      button.dataset.themeChoice = palette.id;
      button.setAttribute('aria-label',`${palette.name}，${palette.light?'浅色':'深色'}主题`);
      button.style.setProperty('--swatch-bg',palette.bg);
      button.style.setProperty('--swatch-surface',palette.surface);
      button.style.setProperty('--swatch-accent',palette.accent);
      button.style.setProperty('--swatch-secondary',palette.secondary);
      const swatch = document.createElement('span');
      swatch.className = 'theme-swatch';
      swatch.setAttribute('aria-hidden','true');
      for (let i=0;i<3;i++) swatch.append(document.createElement('i'));
      const label = document.createElement('strong'); label.textContent = palette.name;
      const caption = document.createElement('small'); caption.textContent = palette.caption;
      button.append(swatch,label,caption);
      button.addEventListener('click',() => apply(palette.id));
      grid.append(button);
    }
    syncChoices();
  }

  window.Themes = {
    list:palettes.map(({id,name,light})=>({id,name,light:Boolean(light)})),normalize,
    apply,preview:apply,mount,
    get current(){return current;},
    load(){mount();settings.theme=normalize(settings.theme);return apply(settings.theme);},
    cancel(){return apply(settings.theme);}
  };
  Themes.load();
})();
