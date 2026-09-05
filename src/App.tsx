import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type ScreenMode = 'registration' | 'game'
type Player = { id: string; name: string; created_at: string }
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
const ADMIN_PASSWORD = 'Psswd$123'
const PLAYER_ID_KEY = 'all-in-player-id'
const ADMIN_KEY = 'all-in-admin'
const supabaseReady = Boolean(SUPABASE_URL && SUPABASE_KEY)

async function supabaseRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Brak konfiguracji Supabase')
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...init?.headers } })
  if (!response.ok) throw new Error((await response.text()) || 'Nie udało się połączyć z bazą')
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function Brand() { return <div className="brand" aria-label="All in"><span className="brand-mark">A</span><span>ALL IN</span></div> }
function StatusPill({ online }: { online: boolean }) { return <div className={`status-pill ${online ? '' : 'offline'}`}><span className="status-dot" />{online ? 'Połączono na żywo' : 'Tryb podglądu'}</div> }

function PlayerView() {
  const [mode, setMode] = useState<ScreenMode>('registration')
  const [player, setPlayer] = useState<Player | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [players, setPlayers] = useState<Player[]>([])
  const joinUrl = window.location.href.split('?')[0].split('#')[0]
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=520x520&margin=0&data=${encodeURIComponent(joinUrl)}`
  const loadState = useCallback(async () => {
    if (!supabaseReady) return
    try {
      const [states, people] = await Promise.all([supabaseRequest<{ mode: ScreenMode }[]>('game_state?id=eq.main&select=mode'), supabaseRequest<Player[]>('players?select=id,name,created_at&order=created_at.asc')])
      if (states[0]?.mode) setMode(states[0].mode)
      setPlayers(people)
    }
    catch { setMessage('Nie udało się odświeżyć stanu gry.') }
  }, [])
  useEffect(() => { loadState(); const timer = window.setInterval(loadState, 1800); return () => window.clearInterval(timer) }, [loadState])
  useEffect(() => {
    const savedId = localStorage.getItem(PLAYER_ID_KEY)
    if (!savedId || !supabaseReady) return
    supabaseRequest<Player[]>(`players?id=eq.${encodeURIComponent(savedId)}&select=id,name,created_at`).then((rows) => rows[0] && setPlayer(rows[0])).catch(() => localStorage.removeItem(PLAYER_ID_KEY))
  }, [])
  async function register(event: FormEvent) {
    event.preventDefault(); const cleanName = name.trim().replace(/\s+/g, ' ')
    if (cleanName.length < 2) return setMessage('Podaj imię mające co najmniej 2 znaki.')
    if (!supabaseReady) return setMessage('Najpierw dodaj dane Supabase do pliku .env.')
    setBusy(true); setMessage('')
    try {
      const rows = await supabaseRequest<Player[]>('players?select=id,name,created_at', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: cleanName }) })
      const created = rows[0]; if (!created) throw new Error('Baza nie zwróciła gracza')
      localStorage.setItem(PLAYER_ID_KEY, created.id); setPlayer(created)
    } catch { setMessage('Nie udało się dołączyć. Sprawdź połączenie i spróbuj ponownie.') } finally { setBusy(false) }
  }
  if (mode === 'game') return <main className="player-shell game-screen"><div className="ambient ambient-one" /><div className="ambient ambient-two" /><Brand /><section className="game-placeholder"><span className="eyebrow">RUNDA 1</span><h1>Gra za chwilę się zacznie</h1><p>{player ? `${player.name}, jesteś na pokładzie.` : 'Prowadzący przygotowuje pierwsze pytanie.'}</p><div className="waiting-orbit"><span /></div></section><StatusPill online={supabaseReady} /></main>
  return <main className="player-shell"><div className="ambient ambient-one" /><div className="ambient ambient-two" /><Brand />
    <section className="display-lobby"><div className="display-copy"><span className="eyebrow">ZESKANUJ I DOŁĄCZ</span><h1>Wchodzisz<br />za wszystko?</h1><p>Otwórz aparat w telefonie, zeskanuj kod i wpisz swoje imię.</p><div className="display-count"><strong>{players.length}</strong><span>{players.length === 1 ? 'gracz gotowy' : 'graczy gotowych'}</span></div></div><div className="display-qr"><img src={qrUrl} alt={`Kod QR prowadzący do ${joinUrl}`} /><span>{joinUrl}</span></div></section>
    <section className="join-card">{player ? <div className="success-state"><div className="success-icon">✓</div><span className="eyebrow">JESTEŚ W GRZE</span><h1>Cześć, {player.name}!</h1><p>Twoje miejsce jest zapisane. Nie zamykaj tej strony — zaraz zaczynamy.</p><div className="waiting-line"><span /></div></div> : <><span className="eyebrow">DOŁĄCZ DO GRY</span><h1>Wchodzisz<br />za wszystko?</h1><p className="lead">Wpisz swoje imię. Tylko tyle dzieli Cię od gry.</p><form onSubmit={register}><label htmlFor="player-name">Twoje imię</label><input id="player-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="np. Krzysiek" maxLength={32} autoComplete="given-name" autoFocus /><button className="primary-button" disabled={busy} type="submit">{busy ? 'Dołączanie…' : 'Wchodzę do gry'} <span>→</span></button></form>{message && <p className="form-message" role="alert">{message}</p>}</>}</section><StatusPill online={supabaseReady} /></main>
}

function AdminView() {
  const [authenticated, setAuthenticated] = useState(() => sessionStorage.getItem(ADMIN_KEY) === 'yes')
  const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [mode, setMode] = useState<ScreenMode>('registration'); const [players, setPlayers] = useState<Player[]>([]); const [busy, setBusy] = useState(false)
  const joinUrl = useMemo(() => `${window.location.origin}${window.location.pathname.replace(/\/admin\/?$/, '/')}`, [])
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=420x420&margin=0&data=${encodeURIComponent(joinUrl)}`
  const refresh = useCallback(async () => {
    if (!supabaseReady || !authenticated) return
    try { const [states, people] = await Promise.all([supabaseRequest<{ mode: ScreenMode }[]>('game_state?id=eq.main&select=mode'), supabaseRequest<Player[]>('players?select=id,name,created_at&order=created_at.asc')]); if (states[0]?.mode) setMode(states[0].mode); setPlayers(people) }
    catch { setError('Brak połączenia z Supabase. Sprawdź konfigurację.') }
  }, [authenticated])
  useEffect(() => { refresh(); const timer = window.setInterval(refresh, 1800); return () => window.clearInterval(timer) }, [refresh])
  function login(event: FormEvent) { event.preventDefault(); if (password !== ADMIN_PASSWORD) return setError('Nieprawidłowe hasło.'); sessionStorage.setItem(ADMIN_KEY, 'yes'); setAuthenticated(true); setError('') }
  async function changeMode(nextMode: ScreenMode) {
    if (!supabaseReady) return setError('Najpierw skonfiguruj Supabase w pliku .env.')
    setBusy(true)
    try { await supabaseRequest('game_state?id=eq.main', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ mode: nextMode, updated_at: new Date().toISOString() }) }); setMode(nextMode) }
    catch { setError('Nie udało się zmienić widoku głównego.') } finally { setBusy(false) }
  }
  if (!authenticated) return <main className="admin-login"><Brand /><section className="login-card"><div className="lock-icon">◆</div><span className="eyebrow">PANEL PROWADZĄCEGO</span><h1>Wejście tylko<br />dla prowadzącego</h1><form onSubmit={login}><label htmlFor="admin-password">Hasło</label><input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" autoFocus /><button className="primary-button" type="submit">Otwórz panel <span>→</span></button></form>{error && <p className="form-message" role="alert">{error}</p>}</section></main>
  return <main className="admin-shell"><header className="admin-header"><Brand /><div className="admin-badge">PANEL ADMINA</div></header><section className="admin-grid"><article className="control-card"><div className="section-heading"><div><span className="eyebrow">STEROWANIE EKRANEM</span><h1>Co widzą gracze?</h1></div><StatusPill online={supabaseReady} /></div><div className="mode-switch" role="group" aria-label="Widok główny"><button disabled={busy} className={mode === 'registration' ? 'active' : ''} onClick={() => changeMode('registration')}><span>01</span>ZAPISY<small>Kod QR i lista graczy</small></button><button disabled={busy} className={mode === 'game' ? 'active' : ''} onClick={() => changeMode('game')}><span>02</span>GRA<small>Ekran rozpoczęcia</small></button></div>{error && <p className="form-message" role="alert">{error}</p>}</article><article className="qr-card"><span className="eyebrow">KOD DOŁĄCZENIA</span><div className="qr-frame"><img src={qrUrl} alt={`Kod QR prowadzący do ${joinUrl}`} /></div><p>{joinUrl}</p></article><article className="players-card"><div className="players-heading"><div><span className="eyebrow">UCZESTNICY</span><h2>Gracze w lobby</h2></div><strong>{players.length}</strong></div><div className="player-list">{players.length === 0 ? <p className="empty-list">Jeszcze nikogo tu nie ma. Pokaż kod QR na głównym ekranie.</p> : players.map((item, index) => <div className="player-row" key={item.id}><span>{String(index + 1).padStart(2, '0')}</span><b>{item.name}</b><i>gotowy</i></div>)}</div></article></section></main>
}

export default function App() { return window.location.pathname.replace(/\/$/, '').endsWith('/admin') ? <AdminView /> : <PlayerView /> }
