// ===== ฟังก์ชันที่ใช้ร่วมกันทั้งหน้าสร้างลิงก์และหน้านำเสนอ =====
const FONTS = {
  cormorant: { label: 'Cormorant Garamond (คลาสสิก)', css: "'Cormorant Garamond', serif" },
  playfair:  { label: 'Playfair Display (หรูหรา)',     css: "'Playfair Display', serif" },
  prompt:    { label: 'Prompt (ไทยโมเดิร์น)',          css: "'Prompt', sans-serif" },
  mali:      { label: 'Mali (ลายมือน่ารัก)',           css: "'Mali', cursive" },
  notoserif: { label: 'Noto Serif Thai (ไทยคลาสสิก)',  css: "'Noto Serif Thai', serif" },
};

// คีย์สั้น ๆ เพื่อให้ลิงก์ไม่ยาวเกินไป
// f=folder b=brand s=subtitle t=title d=date ly=layout so=sort cv=cover mode ci=cover id
// fn=font a=accent bg=background dk=dark dl=allow download
const DEFAULT_CONFIG = {
  v: 1, f: '', b: '', s: '', t: '', d: '',
  ly: 'grid', so: 'new', cv: 'first', ci: '',
  fn: 'cormorant', a: '#A9814B', bg: '#F7F3EC', dk: 0, dl: 1,
};

function apiKey(){ return (window.APP_CONFIG && window.APP_CONFIG.GOOGLE_API_KEY) || ''; }
function hasApiKey(){ const k = apiKey(); return k && !k.startsWith('ใส่'); }

function normalizeConfig(raw){
  const c = { ...DEFAULT_CONFIG, ...(raw || {}) };
  const hex = /^#[0-9a-f]{6}$/i;
  const id = /^[\w-]{10,}$/;
  if(!hex.test(c.a)) c.a = DEFAULT_CONFIG.a;
  if(!hex.test(c.bg)) c.bg = DEFAULT_CONFIG.bg;
  if(!FONTS[c.fn]) c.fn = DEFAULT_CONFIG.fn;
  if(!['grid','masonry'].includes(c.ly)) c.ly = 'grid';
  if(!['new','old','name'].includes(c.so)) c.so = 'new';
  if(!['first','pick','slideshow','none'].includes(c.cv)) c.cv = 'first';
  c.f = id.test(c.f) ? c.f : '';
  c.ci = id.test(c.ci) ? c.ci : '';
  ['b','s','t','d'].forEach(k => c[k] = String(c[k] || '').slice(0, 200));
  c.dk = c.dk ? 1 : 0;
  c.dl = c.dl ? 1 : 0;
  return c;
}

function compactConfig(cfg){
  const out = { v: 1, f: cfg.f };
  Object.keys(DEFAULT_CONFIG).forEach(k => {
    if(k !== 'v' && k !== 'f' && cfg[k] !== DEFAULT_CONFIG[k]) out[k] = cfg[k];
  });
  return out;
}

// JSON -> UTF-8 -> base64url (รองรับภาษาไทย)
function encodeConfig(obj){
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeConfig(str){
  try{
    let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while(s.length % 4) s += '=';
    const bytes = Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
    return normalizeConfig(JSON.parse(new TextDecoder().decode(bytes)));
  }catch(e){ return null; }
}
function buildViewUrl(cfg){
  const url = new URL('view.html', location.href);
  url.search = '';
  url.searchParams.set('c', encodeConfig(compactConfig(cfg)));
  return url.href;
}

function parseFolderId(input){
  const s = (input || '').trim();
  if(!s) return null;
  let m = s.match(/\/folders\/([\w-]+)/);
  if(m) return m[1];
  m = s.match(/[?&]id=([\w-]+)/);
  if(m) return m[1];
  if(/^[\w-]{10,}$/.test(s)) return s;
  return null;
}

// ===== Google Drive API =====
async function apiError(res){
  const body = await res.json().catch(() => ({}));
  const err = new Error((body.error && body.error.message) || ('HTTP ' + res.status));
  err.status = res.status;
  return err;
}

async function fetchFolderInfo(folderId){
  const params = new URLSearchParams({ fields: 'id,name,mimeType', key: apiKey() });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?${params}`);
  if(!res.ok) throw await apiError(res);
  return res.json();
}

async function fetchDriveFiles(folderId, sort){
  const orderBy = { new: 'createdTime desc', old: 'createdTime', name: 'name_natural' }[sort] || 'createdTime desc';
  const q = `'${folderId}' in parents and mimeType contains 'image/' and trashed = false`;
  let files = [], pageToken = '';
  do{
    const params = new URLSearchParams({
      q, orderBy, pageSize: '1000', key: apiKey(),
      fields: 'nextPageToken,files(id,name,createdTime,thumbnailLink,imageMediaMetadata(width,height,rotation))',
    });
    if(pageToken) params.set('pageToken', pageToken);
    const res = await fetch('https://www.googleapis.com/drive/v3/files?' + params);
    if(!res.ok) throw await apiError(res);
    const data = await res.json();
    files = files.concat(data.files || []);
    pageToken = data.nextPageToken || '';
  }while(pageToken);
  return files;
}

function friendlyError(err){
  if(err.status === 403) return 'ไม่มีสิทธิ์เข้าถึง (403) — ตรวจว่าเปิด Google Drive API แล้ว และ API Key อนุญาตโดเมนนี้';
  if(err.status === 404) return 'ไม่พบโฟลเดอร์ (404) — ตรวจลิงก์ และตั้งแชร์เป็น "ทุกคนที่มีลิงก์ดูได้"';
  if(err.status === 400) return 'คำขอไม่ถูกต้อง (400) — ตรวจลิงก์โฟลเดอร์หรือ API Key';
  return 'โหลดข้อมูลไม่สำเร็จ: ' + (err.message || 'เครือข่ายขัดข้อง');
}

// ===== รูปตัวอย่าง (thumbnail) =====
function upsizeThumb(link, size){ return link.replace(/=[swh]\d+[^=?/]*$/, '=s' + size); }
function driveThumbUrl(id, size, bust){
  return `https://drive.google.com/thumbnail?id=${id}&sz=w${size}` + (bust ? `&r=${bust}` : '');
}
function thumbUrl(file, size){
  return file.thumbnailLink ? upsizeThumb(file.thumbnailLink, size) : driveThumbUrl(file.id, size);
}
function setImg(img, file, size){
  img.onerror = () => { img.onerror = null; img.src = driveThumbUrl(file.id, size, 1); };
  img.src = thumbUrl(file, size);
}

// โหลดเฉพาะรูปที่ใกล้หน้าจอ ครั้งละไม่กี่รูป เพื่อไม่ให้ Google ปฏิเสธคำขอ
function createThumbLoader({ maxParallel = 6, rootMargin = '600px 0px' } = {}){
  let active = 0;
  const queue = [];
  const pump = () => {
    while(active < maxParallel && queue.length){
      const job = queue.shift();
      if(!job.img.isConnected) continue;
      active++;
      load(job);
    }
  };
  const load = ({ img, file, size }) => {
    const attempt = (n) => {
      img.onload = () => { img.onload = img.onerror = null; img.classList.add('loaded'); active--; pump(); };
      img.onerror = () => {
        if(n + 1 >= 3){
          img.onload = img.onerror = null;
          if(img.parentElement) img.parentElement.classList.add('failed');
          active--; pump(); return;
        }
        setTimeout(() => attempt(n + 1), 1200 * (n + 1));
      };
      img.src = n % 2 === 0 ? thumbUrl(file, size) : driveThumbUrl(file.id, size, n);
    };
    attempt(0);
  };
  const io = ('IntersectionObserver' in window) ? new IntersectionObserver(entries => {
    entries.forEach(e => {
      if(!e.isIntersecting) return;
      io.unobserve(e.target);
      if(e.target._job){ queue.push(e.target._job); pump(); }
    });
  }, { rootMargin }) : null;
  return {
    watch(img, file, size){
      const job = { img, file, size };
      if(io){ img._job = job; io.observe(img); } else { queue.push(job); pump(); }
    },
    reset(){ if(io) io.disconnect(); queue.length = 0; },
  };
}

// ===== UI helpers =====
function hexToRgba(hex, a){
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function applyTheme(cfg){
  const r = document.documentElement.style;
  r.setProperty('--accent', cfg.a);
  r.setProperty('--accent-soft', hexToRgba(cfg.a, 0.16));
  r.setProperty('--bg', cfg.bg);
  r.setProperty('--title-font', FONTS[cfg.fn].css);
  document.body.classList.toggle('dark', !!cfg.dk);
}
function setStatus(id, text, kind = 'info'){
  const el = document.getElementById(id);
  el.className = 'status ' + kind;
  el.textContent = text || '';
}
function toast(text){
  let t = document.getElementById('toast');
  if(!t){ t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2500);
}
async function copyText(text){
  try{ await navigator.clipboard.writeText(text); return true; }
  catch(e){
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}