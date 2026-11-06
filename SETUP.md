# 🌊 Wave — Panduan Setup

Wave adalah aplikasi musik PWA (bisa di-install di Android & desktop) dengan desain *deep ocean*. Lagu di-upload dari file mp3 di perangkatmu, lengkap dengan baca tag ID3 otomatis (judul, artis, cover).

---

## 1. Buat Project Supabase (gratis)

1. Buka [https://supabase.com](https://supabase.com) → **Sign Up** (bisa pakai GitHub).
2. Klik **New Project** → isi nama (misal `wave`), buat password database, pilih region terdekat (Singapore), klik **Create new project**.
3. Tunggu ±2 menit sampai project selesai dibuat.

## 2. Buat Tabel Database

1. Di menu kiri, klik ikon **SQL Editor** (ikon `>_`).
2. Klik **New query**, tempel SQL di bawah, lalu klik **Run** (atau Ctrl+Enter):

```sql
create table public.songs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  artist text default '',
  album text default '',
  duration numeric default 0,
  storage_path text not null,
  cover_url text,
  created_at timestamptz default now()
);

create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

create table public.playlist_songs (
  playlist_id uuid references public.playlists(id) on delete cascade,
  song_id uuid references public.songs(id) on delete cascade,
  position int not null default 0,
  added_at timestamptz default now(),
  primary key (playlist_id, song_id)
);

alter table public.songs enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_songs enable row level security;

create policy "songs_own" on public.songs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "playlists_own" on public.playlists
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "pl_songs_own" on public.playlist_songs
  for all using (
    auth.uid() = (select user_id from public.playlists p where p.id = playlist_id)
  ) with check (
    auth.uid() = (select user_id from public.playlists p where p.id = playlist_id)
  );
```

Kalau berhasil akan muncul pesan `Success. No rows returned`.

## 3. Buat Storage Bucket

1. Menu kiri → **Storage** → **New bucket**.
2. Buat bucket bernama `songs`, centang **Public bucket** → Create.
3. Buat lagi bucket bernama `covers`, centang **Public bucket** → Create.

## 4. Ambil Kredensial & Isi Config

1. Menu kiri → ⚙️ **Project Settings** → **API**.
2. Salin **Project URL** dan **anon public key**.
3. Buat/isi file `js/config.js` dari template:

```powershell
copy js\config.example.js js\config.js
```

`js/config.js` **tidak di-commit** (di-ignore Git). Isi dengan Project URL dan anon public key seperti ini:

```js
window.WAVE_CONFIG = {
  SUPABASE_URL: 'https://abcdxyz.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi... (anon key kamu)'
};
```

> Anon/publishable key memang dipakai di browser, tapi **jangan pernah** commit `service_role` / `sb_secret_` key. RLS harus aktif di semua tabel yang diakses frontend.

## 5. Jalankan Aplikasi

Service worker butuh server (tidak bisa buka file langsung). Pilih salah satu:

```powershell
# Opsi A — Node
cd D:\SPOTIFY\wave
npx serve .

# Opsi B — Python
cd D:\SPOTIFY\wave
python -m http.server 8080
```

Lalu buka `http://localhost:3000` (serve) atau `http://localhost:8080` (python) di browser.

## 6. Daftar Akun & Pakai

1. Klik **Daftar**, masukkan email + password (min. 6 karakter).
2. Cek email untuk verifikasi kalau Supabase memintanya (bisa dimatikan di **Authentication → Providers → Email**, matikan *Confirm email* biar langsung masuk).
3. Klik **Tambah Lagu** → pilih beberapa file mp3 sekaligus → tunggu upload selesai.
4. Buat playlist di tab **Playlist**, tambahkan lagu lewat tombol `⋮` pada lagu.

## 7. Install di Android

1. Buka URL aplikasi di **Chrome** (HP dan PC harus di jaringan yang sama, atau deploy ke hosting).
2. Menu ⋮ Chrome → **Tambahkan ke layar utama** → selesai, muncul ikon Wave seperti aplikasi biasa.

## 8. Install di Desktop (Windows/Mac/Linux)

1. Buka aplikasi di **Chrome/Edge**.
2. Klik ikon **install** (⊕ / monitor kecil) di address bar → **Install**.
3. Wave terbuka di jendela aplikasinya sendiri.

---

## Tips: Biar Bisa Diakses dari HP

`localhost` hanya bisa di PC. Pilih salah satu:

- **Termudah**: deploy gratis ke [Netlify Drop](https://app.netlify.com/drop) atau [Vercel](https://vercel.com) — drag & drop folder `wave`, langsung dapat URL https yang bisa dibuka dari mana saja (dan service worker jalan penuh).
- **Lokal**: cari IP PC (`ipconfig` → IPv4), jalankan server, lalu di HP buka `http://192.168.x.xx:8080`.

## Struktur File

```
wave/
├── index.html          # Markup aplikasi
├── manifest.webmanifest # Metadata PWA
├── sw.js               # Service worker (cache offline shell)
├── css/style.css       # Tema deep ocean
├── js/config.example.js # Template konfigurasi (salin ke js/config.js)
├── js/config.js        # ⬅️ Lokal only; isi kredensial Supabase, tidak di-commit
├── js/app.js           # Logika aplikasi
└── icons/              # Ikon PWA
```
