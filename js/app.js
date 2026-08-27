/* ============ WAVE — App Logic ============ */
'use strict';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.WAVE_CONFIG;
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
  user: null,
  songs: [],
  playlists: [],
  view: 'home',
  currentPlaylist: null,
  queue: [],
  qIndex: -1,
  shuffle: false,
  repeat: 0, // 0 off, 1 all, 2 one
  isAuthMode: 'login'
};

const audio = $('#audio');
audio.crossOrigin = 'anonymous';

let audioCtx = null, analyser = null, vizData = null, vizRaf = 0, vizTried = false;
let sleepInterval = null, sleepLeft = 0;

/* ---------- Helpers ---------- */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function fmtTime(sec) {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

function coverHtml(song, cls) {
  if (song.cover_url) return `<img class="${cls}" src="${esc(song.cover_url)}" alt="" loading="lazy" />`;
  return `<div class="${cls} ph">♪</div>`;
}

function setRangeFill(input) {
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100 || 0;
  input.style.setProperty('--fill', pct + '%');
}

/* ---------- Auth ---------- */
function switchAuthMode(mode) {
  state.isAuthMode = mode;
  $('#authSubmit').textContent = mode === 'login' ? 'Masuk' : 'Daftar';
  $('#authSwitchText').textContent = mode === 'login' ? 'Belum punya akun?' : 'Sudah punya akun?';
  $('#authSwitchBtn').textContent = mode === 'login' ? 'Daftar' : 'Masuk';
  $('#authError').classList.add('hidden');
}

$('#authSwitchBtn').addEventListener('click', () =>
  switchAuthMode(state.isAuthMode === 'login' ? 'register' : 'login')
);

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#authEmail').value.trim();
  const pass = $('#authPass').value;
  const btn = $('#authSubmit');
  btn.disabled = true;
  btn.textContent = state.isAuthMode === 'login' ? 'Memproses…' : 'Mendaftar…';
  const { error } = state.isAuthMode === 'login'
    ? await sb.auth.signInWithPassword({ email, password: pass })
    : await sb.auth.signUp({ email, password: pass });
  btn.disabled = false;
  switchAuthMode(state.isAuthMode);
  if (error) {
    setAuthMood('error');
    const el = $('#authError');
    el.textContent = error.message.includes('Registered')
      ? 'Pendaftaran berhasil! Cek email untuk verifikasi, lalu masuk.'
      : error.message;
    el.classList.remove('hidden');
  } else {
    setAuthMood('success');
  }
});

/* Mood latar auth: typing kuning, error merah, sukses teal */
function setAuthMood(mood) {
  const view = $('#authView');
  view.classList.remove('is-typing', 'is-error', 'is-success');
  if (mood) view.classList.add('is-' + mood);
}
['#authEmail', '#authPass'].forEach((s) => {
  $(s).addEventListener('input', () => setAuthMood('typing'));
  $(s).addEventListener('focus', () => {
    if ($(s).value) setAuthMood('typing');
  });
});

async function doLogout() {
  pauseAudio();
  await sb.auth.signOut();
}
$('#logoutBtn').addEventListener('click', doLogout);
['#logoutBtnM1', '#logoutBtnM2'].forEach((s) => {
  $(s)?.addEventListener('click', doLogout);
});

/* ---------- Hint animasi di halaman login ---------- */
(function setupAuthHint() {
  const card = document.querySelector('.auth-card');
  const hint = $('.auth-hint');
  if (!card || !hint) return;
  const targets = ['#authEmail', '#authPass', '#authSubmit'].map((s) => $(s));
  const place = () => {
    const cr = card.getBoundingClientRect();
    targets.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      hint.style.setProperty(`--x${i + 1}`, (r.left - cr.left + r.width * 0.68) + 'px');
      hint.style.setProperty(`--y${i + 1}`, (r.top - cr.top + r.height / 2 - 8) + 'px');
    });
    card.classList.add('hinting');
  };
  place();
  window.addEventListener('resize', place);
  const stop = () => card.classList.remove('hinting');
  targets.forEach((el) => {
    el.addEventListener('focus', stop);
    el.addEventListener('input', stop);
  });
  $('#authForm').addEventListener('submit', stop);
})();

/* ---------- Session ---------- */
sb.auth.onAuthStateChange(async (_evt, session) => {
  if (session?.user) {
    state.user = session.user;
    showApp();
  } else {
    state.user = null;
    $('#appView').classList.add('hidden');
    $('#authView').classList.remove('hidden');
  }
});

(async function initSession() {
  const { data } = await sb.auth.getSession();
  if (data.session?.user) {
    state.user = data.session.user;
    showApp();
  } else {
    $('#authView').classList.remove('hidden');
  }
})();

async function showApp() {
  setAuthMood(null);
  $('#authView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  await Promise.all([loadSongs(), loadPlaylists()]);
  navigate('home');
}

/* ---------- Data ---------- */
async function loadSongs() {
  const { data, error } = await sb
    .from('songs')
    .select('*')
    .order('created_at', { ascending: false });
  state.songs = error ? [] : data;
  renderHome();
  renderSidebarPlaylists();
}

async function loadPlaylists() {
  const { data, error } = await sb
    .from('playlists')
    .select('*, playlist_songs(song_id)')
    .order('created_at', { ascending: false });
  state.playlists = error ? [] : data;
  renderPlaylists();
  renderSidebarPlaylists();
  if (state.currentPlaylist) openPlaylist(state.currentPlaylist.id, true);
}

/* ---------- Navigation ---------- */
function navigate(view) {
  state.view = view;
  ['homeView', 'playlistsView', 'playlistDetail'].forEach((id) =>
    $('#' + id).classList.add('hidden')
  );
  if (view === 'home') $('#homeView').classList.remove('hidden');
  if (view === 'playlists') $('#playlistsView').classList.remove('hidden');
  if (view === 'playlistDetail') $('#playlistDetail').classList.remove('hidden');
  $$('.side-link, .nav-link').forEach((b) =>
    b.classList.toggle('active', b.dataset.nav === view)
  );
  $$('.side-pl-item').forEach((b) =>
    b.classList.toggle('active', view === 'playlistDetail' && b.dataset.id === state.currentPlaylist?.id)
  );
  $$('.song-list').forEach((l) => l.classList.add('fresh'));
  setTimeout(() => $$('.song-list').forEach((l) => l.classList.remove('fresh')), 500);
}

$$('[data-nav]').forEach((btn) =>
  btn.addEventListener('click', () => {
    state.currentPlaylist = null;
    navigate(btn.dataset.nav);
  })
);

/* ---------- Beranda ---------- */
function renderHome() {
  const list = $('#songList');
  list.innerHTML = '';
  $('#emptyLibrary').classList.toggle('hidden', state.songs.length > 0);

  for (const song of state.songs) {
    const row = document.createElement('div');
    row.className = 'song-row' + (isCurrent(song) ? ' playing' : '');
    row.innerHTML = `
      ${coverHtml(song, 'song-cover')}
      <div class="song-info">
        <div class="song-title">${isCurrent(song) && !audio.paused ? '<span class="eq"><span></span><span></span><span></span></span>' : ''}${esc(song.title)}</div>
        <div class="song-artist">${esc(song.artist || 'Tidak diketahui')}</div>
      </div>
      <span class="song-dur">${fmtTime(song.duration)}</span>
      <button class="song-menu" aria-label="Menu">⋮</button>`;
    row.addEventListener('click', (e) => {
      if (e.target.closest('.song-menu')) return;
      playFrom(state.songs, state.songs.indexOf(song));
    });
    row.querySelector('.song-menu').addEventListener('click', (e) => {
      e.stopPropagation();
      openSongMenu(song);
    });
    list.appendChild(row);
  }
}

function isCurrent(song) {
  return state.queue[state.qIndex]?.id === song.id;
}

/* ---------- Upload ---------- */
$('#uploadBtn').addEventListener('click', () => $('#fileInput').click());

$('#fileInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  await uploadFiles(files);
});

function probeDuration(file) {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = 'metadata';
    a.src = URL.createObjectURL(file);
    a.onloadedmetadata = () => { resolve(a.duration); URL.revokeObjectURL(a.src); };
    a.onerror = () => resolve(0);
  });
}

function readTags(file) {
  return new Promise((resolve) => {
    window.jsmediatags.read(file, {
      onSuccess: (r) => resolve(r.tags || {}),
      onError: () => resolve({})
    });
  });
}

function pictureToBlob(pic) {
  if (!pic?.data) return null;
  try {
    const bytes = new Uint8Array(pic.data);
    return new Blob([bytes], { type: pic.format || 'image/jpeg' });
  } catch {
    return null;
  }
}

async function uploadFiles(files) {
  const status = $('#uploadStatus');
  status.classList.remove('hidden');
  let done = 0;

  for (const file of files) {
    status.textContent = `Mengunggah ${++done} dari ${files.length}: ${file.name}`;
    try {
      const [tags, duration] = await Promise.all([readTags(file), probeDuration(file)]);
      const uid = state.user.id;
      const id = crypto.randomUUID();
      const ext = (file.name.split('.').pop() || 'mp3').toLowerCase();

      const audioPath = `${uid}/${id}.${ext}`;
      let { error: upErr } = await sb.storage.from('songs').upload(audioPath, file, {
        cacheControl: '3600', upsert: false
      });
      if (upErr) throw upErr;

      let coverUrl = null;
      const picBlob = pictureToBlob(tags.picture);
      if (picBlob) {
        const coverPath = `${uid}/${id}.jpg`;
        const { error: cErr } = await sb.storage.from('covers').upload(coverPath, picBlob, {
          cacheControl: '3600', upsert: false, contentType: 'image/jpeg'
        });
        if (!cErr) {
          coverUrl = sb.storage.from('covers').getPublicUrl(coverPath).data.publicUrl;
        }
      }

      await sb.from('songs').insert({
        user_id: uid,
        title: tags.title?.trim() || file.name.replace(/\.[^.]+$/, ''),
        artist: tags.artist?.trim() || '',
        album: tags.album?.trim() || '',
        duration: Math.round(duration) || 0,
        storage_path: audioPath,
        cover_url: coverUrl
      });
    } catch (err) {
      console.error(err);
      toast(`Gagal: ${file.name} — ${err.message || 'error'}`);
    }
  }
  status.classList.add('hidden');
  toast(`${files.length} lagu selesai diunggah 🌊`);
  await loadSongs();
}

/* ---------- Song menu ---------- */
async function deleteSong(song) {
  if (!confirm(`Hapus "${song.title}" dari library?`)) return;
  await sb.storage.from('songs').remove([song.storage_path]);
  if (song.cover_url) {
    const path = song.cover_url.split('/covers/')[1];
    if (path) await sb.storage.from('covers').remove([decodeURIComponent(path)]);
  }
  const wasCurrent = isCurrent(song);
  await sb.from('songs').delete().eq('id', song.id);
  if (wasCurrent) {
    state.queue = state.queue.filter((s) => s.id !== song.id);
    if (!state.queue.length) stopPlayback();
    else {
      state.qIndex = Math.min(state.qIndex, state.queue.length - 1);
      loadCurrent();
    }
  }
  await Promise.all([loadSongs(), loadPlaylists()]);
  toast('Lagu dihapus');
}

function openSongMenu(song) {
  openModal(`
    <h3>${esc(song.title)}</h3>
    <button class="menu-item" data-act="play">
      <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> Putar
    </button>
    <button class="menu-item" data-act="addpl">
      <svg viewBox="0 0 24 24"><path d="M4 6h11v2H4zm0 4h11v2H4zm0 4h7v2H4zm14-6v7.1a3 3 0 1 0 2 2.8V6z"/></svg> Tambah ke Playlist
    </button>
    <button class="menu-item danger" data-act="del">
      <svg viewBox="0 0 24 24"><path d="M6 7h12l-1 14H7zm3-3h6l1 2h4v2H4V6h4z"/></svg> Hapus Lagu
    </button>
  `, (modal) => {
    modal.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      closeModal();
      if (act === 'play') playFrom(state.songs, state.songs.indexOf(song));
      if (act === 'addpl') openAddToPlaylist(song);
      if (act === 'del') deleteSong(song);
    });
  });
}

/* ---------- Playlists ---------- */
$('#newPlaylistBtn').addEventListener('click', () => {
  openModal(`
    <h3>Playlist Baru</h3>
    <input type="text" id="plNameInput" placeholder="Nama playlist" maxlength="60" />
    <div class="modal-actions">
      <button class="btn-cancel" data-close>Batal</button>
      <button class="btn-primary" id="plCreate">Buat</button>
    </div>
  `, (modal) => {
    const input = modal.querySelector('#plNameInput');
    input.focus();
    const create = async () => {
      const name = input.value.trim();
      if (!name) return;
      await sb.from('playlists').insert({ user_id: state.user.id, name });
      closeModal();
      toast('Playlist dibuat 🌊');
      await loadPlaylists();
    };
    modal.querySelector('#plCreate').addEventListener('click', create);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && create());
  });
});

function renderPlaylists() {
  const grid = $('#playlistGrid');
  grid.innerHTML = '';
  $('#emptyPlaylists').classList.toggle('hidden', state.playlists.length > 0);
  for (const pl of state.playlists) {
    const count = pl.playlist_songs?.length || 0;
    const card = document.createElement('button');
    card.className = 'pl-card glass';
    card.innerHTML = `
      <div class="pl-card-art">🌊</div>
      <div class="pl-card-name">${esc(pl.name)}</div>
      <div class="pl-card-count">${count} lagu</div>`;
    card.addEventListener('click', () => openPlaylist(pl.id));
    grid.appendChild(card);
  }
}

function renderSidebarPlaylists() {
  const wrap = $('#sidebarPlaylists');
  wrap.innerHTML = '';
  for (const pl of state.playlists) {
    const b = document.createElement('button');
    b.className = 'side-pl-item';
    b.dataset.id = pl.id;
    b.textContent = pl.name;
    b.addEventListener('click', () => openPlaylist(pl.id));
    wrap.appendChild(b);
  }
}

$('#plBack').addEventListener('click', () => {
  state.currentPlaylist = null;
  navigate('playlists');
});

async function openPlaylist(id, silent) {
  const { data: pl } = await sb.from('playlists').select('*').eq('id', id).single();
  if (!pl) return;
  const { data: rows } = await sb
    .from('playlist_songs')
    .select('position, song_id, songs(*)')
    .eq('playlist_id', id)
    .order('position');
  const songs = (rows || []).filter((r) => r.songs).map((r) => r.songs);

  state.currentPlaylist = { ...pl, songs };
  $('#plName').textContent = pl.name;
  $('#plCount').textContent = `${songs.length} lagu`;
  navigate('playlistDetail');

  const list = $('#plSongList');
  list.innerHTML = '';
  $('#plEmpty').classList.toggle('hidden', songs.length > 0);
  songs.forEach((song, i) => {
    const row = document.createElement('div');
    row.className = 'song-row' + (isCurrent(song) ? ' playing' : '');
    row.innerHTML = `
      ${coverHtml(song, 'song-cover')}
      <div class="song-info">
        <div class="song-title">${esc(song.title)}</div>
        <div class="song-artist">${esc(song.artist || 'Tidak diketahui')}</div>
      </div>
      <button class="q-btn" data-remove title="Hapus dari playlist">✕</button>`;
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-remove]')) return;
      playFrom(songs, i);
    });
    row.querySelector('[data-remove]').addEventListener('click', async () => {
      await sb.from('playlist_songs').delete().eq('playlist_id', id).eq('song_id', song.id);
      await loadPlaylists();
    });
    list.appendChild(row);
  });
}

$('#plPlayAll').addEventListener('click', () => {
  const songs = state.currentPlaylist?.songs || [];
  if (songs.length) playFrom(songs, 0);
});

$('#plDelete').addEventListener('click', async () => {
  const pl = state.currentPlaylist;
  if (!pl || !confirm(`Hapus playlist "${pl.name}"?`)) return;
  await sb.from('playlists').delete().eq('id', pl.id);
  state.currentPlaylist = null;
  navigate('playlists');
  await loadPlaylists();
  toast('Playlist dihapus');
});

function openAddToPlaylist(song) {
  if (!state.playlists.length) {
    toast('Buat playlist dulu di tab Playlist');
    return;
  }
  const items = state.playlists
    .map(
      (pl) => `
      <button class="pl-pick" data-pl="${pl.id}">
        <div class="pl-pick-art">🌊</div>
        <div class="pl-pick-name">${esc(pl.name)}</div>
      </button>`
    )
    .join('');
  openModal(`<h3>Tambah ke Playlist</h3>${items}`, async (modal) => {
    modal.addEventListener('click', async (e) => {
      const id = e.target.closest('[data-pl]')?.dataset.pl;
      if (!id) return;
      const { count } = await sb
        .from('playlist_songs')
        .select('*', { count: 'exact', head: true })
        .eq('playlist_id', id).eq('song_id', song.id);
      if (count) {
        toast('Lagu sudah ada di playlist itu');
      } else {
        const { count: total } = await sb
          .from('playlist_songs')
          .select('*', { count: 'exact', head: true })
          .eq('playlist_id', id);
        await sb.from('playlist_songs').insert({
          playlist_id: id, song_id: song.id, position: total || 0
        });
        toast('Ditambahkan ke playlist ✨');
        await loadPlaylists();
      }
      closeModal();
    });
  });
}

/* ---------- Modal ---------- */
function openModal(html, onOpen) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal">${html}</div>`;
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) closeModal();
  });
  $('#modalRoot').appendChild(backdrop);
  if (onOpen) onOpen(backdrop.querySelector('.modal'));
}
function closeModal() {
  $('#modalRoot').innerHTML = '';
}

/* ---------- Player ---------- */
function publicAudioUrl(path) {
  return sb.storage.from('songs').getPublicUrl(path).data.publicUrl;
}

async function playFrom(songs, index) {
  state.queue = [...songs];
  state.qIndex = index;
  loadCurrent();
  openNowPlaying();
}

function loadCurrent() {
  const song = state.queue[state.qIndex];
  if (!song) return;
  audio.src = publicAudioUrl(song.storage_path);
  audio.play().catch(() => {});
  updateNowPlayingUi(song);
  renderHome();
  if (state.view === 'playlistDetail' && state.currentPlaylist) {
    openPlaylist(state.currentPlaylist.id, true);
  }
  renderQueue();
}

function updateNowPlayingUi(song) {
  $('#mpTitle').textContent = song.title;
  $('#mpArtist').textContent = song.artist || 'Tidak diketahui';
  $('#npTitle').textContent = song.title;
  $('#npArtist').textContent = song.artist || 'Tidak diketahui';
  for (const [id, cls] of [['#mpCover', 'mp-cover'], ['#npCover', 'np-cover']]) {
    const el = $(id);
    if (song.cover_url) {
      el.outerHTML = `<img id="${id.slice(1)}" class="${cls}" src="${esc(song.cover_url)}" alt="" />`;
    } else {
      el.outerHTML = `<div id="${id.slice(1)}" class="${cls} ph">♪</div>`;
    }
  }
  $('#miniPlayer').classList.remove('hidden');
  tintNp(song.cover_url);
}

function playPause() {
  if (!state.queue.length) return;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function pauseAudio() { audio.pause(); }

function stopPlayback() {
  audio.pause();
  audio.removeAttribute('src');
  state.queue = [];
  state.qIndex = -1;
  $('#miniPlayer').classList.add('hidden');
  closeNowPlaying();
}

function nextSong(auto) {
  if (!state.queue.length) return;
  if (auto && state.repeat === 2) {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  let i;
  if (state.shuffle && state.queue.length > 1) {
    do { i = Math.floor(Math.random() * state.queue.length); } while (i === state.qIndex);
  } else {
    i = state.qIndex + 1;
    if (i >= state.queue.length) {
      if (auto && state.repeat === 1) i = 0;
      else if (auto) { audio.pause(); syncPlayIcons(); return; }
      else i = 0;
    }
  }
  state.qIndex = i;
  loadCurrent();
}

function prevSong() {
  if (!state.queue.length) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  state.qIndex = (state.qIndex - 1 + state.queue.length) % state.queue.length;
  loadCurrent();
}

function syncPlayIcons() {
  const playing = !audio.paused && audio.src;
  $('#mpPlay').classList.toggle('is-playing', playing);
  $('#btnPlay').classList.toggle('is-playing', playing);
}

audio.addEventListener('play', () => { syncPlayIcons(); renderHome(); });
audio.addEventListener('pause', () => { syncPlayIcons(); renderHome(); });
audio.addEventListener('ended', () => nextSong(true));
audio.addEventListener('timeupdate', () => {
  const d = audio.duration || 0;
  const cur = audio.currentTime || 0;
  $('#npCur').textContent = fmtTime(cur);
  $('#npDur').textContent = fmtTime(d);
  const pct = d ? (cur / d) * 100 : 0;
  $('#mpProgress').style.width = pct + '%';
  const bar = $('#seekBar');
  if (!bar.matches(':active')) {
    bar.value = pct;
    setRangeFill(bar);
  }
});
audio.addEventListener('loadedmetadata', () => {
  $('#npDur').textContent = fmtTime(audio.duration);
});
audio.addEventListener('playing', () => {
  if (!vizTried) { vizTried = true; initVisualizer(); }
  startViz();
});
audio.addEventListener('pause', stopViz);
audio.addEventListener('error', () => {
  if (audio.crossOrigin && !vizTried) {
    audio.crossOrigin = null;
    const t = audio.currentTime;
    audio.src = audio.src;
    if (t) audio.currentTime = t;
    audio.play().catch(() => {});
  }
});

/* ---------- Controls wiring ---------- */
$('#mpPlay').addEventListener('click', (e) => { e.stopPropagation(); playPause(); });
$('#btnPlay').addEventListener('click', playPause);
$('#mpNext').addEventListener('click', (e) => { e.stopPropagation(); nextSong(false); });
$('#btnNext').addEventListener('click', () => nextSong(false));
$('#btnPrev').addEventListener('click', prevSong);

$('#seekBar').addEventListener('input', (e) => {
  setRangeFill(e.target);
  $('#npCur').textContent = fmtTime((e.target.value / 100) * (audio.duration || 0));
});
$('#seekBar').addEventListener('change', (e) => {
  if (audio.duration) audio.currentTime = (e.target.value / 100) * audio.duration;
});

$('#btnShuffle').addEventListener('click', () => {
  state.shuffle = !state.shuffle;
  $('#btnShuffle').classList.toggle('active', state.shuffle);
  toast(state.shuffle ? 'Shuffle aktif' : 'Shuffle mati');
});

$('#btnRepeat').addEventListener('click', () => {
  state.repeat = (state.repeat + 1) % 3;
  $('#btnRepeat').classList.toggle('active', state.repeat > 0);
  $('#repeatOne').classList.toggle('hidden', state.repeat !== 2);
  toast(['Repeat mati', 'Repeat semua', 'Repeat satu lagu'][state.repeat]);
});

/* ---------- Now Playing overlay ---------- */
function openNowPlaying() {
  if (!state.queue.length) return;
  $('#nowPlaying').classList.remove('hidden');
}
function closeNowPlaying() {
  $('#nowPlaying').classList.add('hidden');
  $('#npQueue').classList.add('hidden');
  stopViz();
}
$('#npClose').addEventListener('click', closeNowPlaying);
$('#miniPlayer').addEventListener('click', (e) => {
  if (e.target.closest('button')) return;
  openNowPlaying();
});
$('#npQueueBtn').addEventListener('click', () => {
  $('#npQueue').classList.toggle('hidden');
  renderQueue();
});
$('#queueClose').addEventListener('click', () => $('#npQueue').classList.add('hidden'));

/* ---------- Queue ---------- */
function renderQueue() {
  const list = $('#queueList');
  if (!list) return;
  list.innerHTML = '';
  state.queue.forEach((song, i) => {
    const row = document.createElement('div');
    row.className = 'q-row' + (i === state.qIndex ? ' playing' : '');
    row.innerHTML = `
      ${coverHtml(song, 'q-cover')}
      <div class="q-info">
        <div class="q-title">${esc(song.title)}</div>
        <div class="q-artist">${esc(song.artist || 'Tidak diketahui')}</div>
      </div>
      <button class="q-btn" data-up title="Naik">▲</button>
      <button class="q-btn" data-down title="Turun">▼</button>
      <button class="q-btn" data-rm title="Hapus">✕</button>`;
    row.addEventListener('click', (e) => {
      if (e.target.closest('.q-btn')) return;
      state.qIndex = i;
      loadCurrent();
    });
    row.querySelector('[data-up]').addEventListener('click', () => moveQueue(i, i - 1));
    row.querySelector('[data-down]').addEventListener('click', () => moveQueue(i, i + 1));
    row.querySelector('[data-rm]').addEventListener('click', () => {
      const wasCurrent = i === state.qIndex;
      state.queue.splice(i, 1);
      if (!state.queue.length) { stopPlayback(); return; }
      if (wasCurrent) {
        state.qIndex = Math.min(i, state.queue.length - 1);
        loadCurrent();
      } else {
        if (i < state.qIndex) state.qIndex--;
        renderQueue();
      }
    });
    list.appendChild(row);
  });
}

function moveQueue(from, to) {
  if (to < 0 || to >= state.queue.length) return;
  const [item] = state.queue.splice(from, 1);
  state.queue.splice(to, 0, item);
  if (state.qIndex === from) state.qIndex = to;
  else if (from < state.qIndex && to >= state.qIndex) state.qIndex--;
  else if (from > state.qIndex && to <= state.qIndex) state.qIndex++;
  renderQueue();
}

/* ---------- Visualizer (fitur keren #1) ---------- */
function initVisualizer() {
  if (audioCtx || (!window.AudioContext && !window.webkitAudioContext)) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaElementSource(audio);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    analyser.smoothingTimeConstant = 0.82;
    src.connect(analyser);
    analyser.connect(audioCtx.destination);
    vizData = new Uint8Array(analyser.frequencyBinCount);
  } catch {
    analyser = null;
  }
}

function startViz() {
  if (!analyser) return;
  cancelAnimationFrame(vizRaf);
  const canvas = $('#npViz');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const draw = () => {
    vizRaf = requestAnimationFrame(draw);
    if ($('#nowPlaying').classList.contains('hidden')) { stopViz(); return; }
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    analyser.getByteFrequencyData(vizData);
    const bars = 28, gap = 3;
    const bw = (w - gap * (bars - 1)) / bars;
    const grad = ctx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, 'rgba(20, 184, 166, 0.5)');
    grad.addColorStop(1, 'rgba(94, 234, 212, 0.95)');
    ctx.fillStyle = grad;
    for (let i = 0; i < bars; i++) {
      const v = (vizData[i + 2] || 0) / 255;
      const bh = Math.max(2, v * h * 0.92);
      ctx.beginPath();
      ctx.roundRect(i * (bw + gap), h - bh, bw, bh, bw / 2);
      ctx.fill();
    }
  };
  draw();
}

function stopViz() { cancelAnimationFrame(vizRaf); vizRaf = 0; }

function tintNp(url) {
  const np = $('#nowPlaying');
  if (!url) { np.style.removeProperty('--tint'); return; }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 24;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0, 24, 24);
      const d = x.getImageData(0, 0, 24, 24).data;
      let r = 0, g = 0, b = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      r /= n; g /= n; b /= n;
      const boost = 120 / (Math.max(r, g, b) || 1);
      np.style.setProperty('--tint', `${Math.min(255, r * boost * 0.9) | 0} ${Math.min(255, g * boost * 0.9) | 0} ${Math.min(255, b * boost * 0.9) | 0}`);
    } catch { /* tainted canvas, skip */ }
  };
  img.src = url;
}

/* ---------- Sleep Timer (fitur keren #2) ---------- */
function setSleepTimer(minutes) {
  clearInterval(sleepInterval);
  sleepInterval = null;
  const badge = $('#sleepBadge');
  const btn = $('#npSleepBtn');
  if (!minutes) {
    sleepLeft = 0;
    badge.classList.add('hidden');
    btn.classList.remove('active');
    return;
  }
  sleepLeft = minutes * 60;
  badge.classList.remove('hidden');
  btn.classList.add('active');
  badge.textContent = fmtTime(sleepLeft);
  toast(`Musik berhenti otomatis dalam ${minutes} menit`);
  sleepInterval = setInterval(() => {
    sleepLeft--;
    if (sleepLeft <= 0) {
      clearInterval(sleepInterval);
      sleepInterval = null;
      pauseAudio();
      badge.classList.add('hidden');
      btn.classList.remove('active');
      toast('Sleep timer selesai — selamat tidur 🌙');
      return;
    }
    badge.textContent = fmtTime(sleepLeft);
  }, 1000);
}

$('#npSleepBtn').addEventListener('click', () => {
  openModal(`
    <h3>Sleep Timer</h3>
    <button class="menu-item" data-min="15">
      <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 10.4 4.2 2.5-.8 1.3L11 13V7h2z"/></svg>
      15 menit
    </button>
    <button class="menu-item" data-min="30">
      <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 10.4 4.2 2.5-.8 1.3L11 13V7h2z"/></svg>
      30 menit
    </button>
    <button class="menu-item" data-min="60">
      <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 10.4 4.2 2.5-.8 1.3L11 13V7h2z"/></svg>
      60 menit
    </button>
    <button class="menu-item danger" data-min="0">
      <svg viewBox="0 0 24 24"><path d="M6 7h12l-1 14H7zm3-3h6l1 2h4v2H4V6h4z"/></svg>
      Matikan timer
    </button>
  `, (modal) => {
    modal.addEventListener('click', (e) => {
      const min = e.target.closest('[data-min]')?.dataset.min;
      if (min === undefined) return;
      closeModal();
      if (Number(min) === 0) toast('Sleep timer dimatikan');
      setSleepTimer(Number(min));
    });
  });
});

/* ---------- Swipe turun buat nutup Now Playing ---------- */
(function () {
  const np = $('#nowPlaying');
  let startY = 0, dy = 0, dragging = false;
  np.addEventListener('touchstart', (e) => {
    if (e.target.closest('#npQueue') || e.target.closest('input')) return;
    startY = e.touches[0].clientY;
    dy = 0;
    dragging = true;
  }, { passive: true });
  np.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    np.style.transition = 'none';
    np.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  np.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    np.style.transition = 'transform .28s cubic-bezier(0.2, 0, 0, 1)';
    np.style.transform = '';
    if (dy > 130) closeNowPlaying();
    setTimeout(() => { np.style.transition = ''; }, 300);
  });
})();

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('./sw.js').catch(console.error)
  );
}
