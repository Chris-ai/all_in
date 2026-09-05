import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import './App.css'
import gameData from './assets/data.json'

type ScreenMode = 'registration' | 'game' | 'question'
type Player = { id: string; name: string; color: string; balance: number; created_at: string }
type GameState = { mode: ScreenMode; category_options: CategoryId[]; round_number: number; selected_category: CategoryId | null; question_phase: RoundPhase; betting_ends_at: string | null; category_ends_at: string | null; used_categories: CategoryId[]; current_question: string | null; correct_answer_index: number | null; settled_round: number }
type RoundPhase = 'betting' | 'locked' | 'review' | 'result'
type QuestionBet = { player_id: string; round_number: number; amounts: number[] }
const CategoryId = { FilmTv: 'film-tv', Music: 'music', World: 'world', ScienceNature: 'science-nature', FoodDrink: 'food-drink', PopCulture: 'pop-culture', WeirdFacts: 'weird-facts', Internet: 'internet' } as const
type CategoryId = typeof CategoryId[keyof typeof CategoryId]
type Category = { id: CategoryId; name: string; icon: string }
type GameQuestion = { id: string; question: string; answers: { id: string; text: string; correct: boolean }[] }
type AnswerBet = { name: string; amount: number; color: string }
const ALL_CATEGORIES = gameData.categories.map(({ id, name, icon }) => ({ id: id as CategoryId, name, icon }))
const CATEGORY_COLORS = ['#7657ff', '#ff3f9b', '#20d5f2']
function sampleCategories(excluded: CategoryId[]) {
  const available = ALL_CATEGORIES.filter((category) => !excluded.includes(category.id))
  return [...available].sort(() => Math.random() - .5).slice(0, 3)
}
function weightedPick(weights: number[]) {
  let cursor = Math.random() * weights.reduce((sum, weight) => sum + weight, 0)
  for (let index = 0; index < weights.length; index += 1) { cursor -= weights[index]; if (cursor < 0) return index }
  return weights.length - 1
}
const ALL_QUESTIONS = gameData.categories.flatMap((category) => category.questions) as GameQuestion[]
const FALLBACK_QUESTION = ALL_QUESTIONS[0]
function getQuestion(questionId: string | null) { return ALL_QUESTIONS.find((question) => question.id === questionId) ?? FALLBACK_QUESTION }
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
const ADMIN_PASSWORD = 'Psswd$123'
const PLAYER_ID_KEY = 'all-in-player-id'
const PLAYER_DEVICE_KEY = 'all-in-device-token'
const ADMIN_KEY = 'all-in-admin'
const supabaseReady = Boolean(SUPABASE_URL && SUPABASE_KEY)

async function supabaseRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Brak konfiguracji Supabase')
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...init?.headers } })
  if (!response.ok) throw new Error((await response.text()) || 'Nie udało się połączyć z bazą')
  if (response.status === 204) return undefined as T
  const body = await response.text()
  return (body ? JSON.parse(body) : undefined) as T
}

function Brand() { return <div className="brand" aria-label="All in"><span className="brand-mark">A</span><span>ALL IN</span></div> }
function StatusPill({ online }: { online: boolean }) { return <div className={`status-pill ${online ? '' : 'offline'}`}><span className="status-dot" />{online ? 'Połączono na żywo' : 'Tryb podglądu'}</div> }

function MobilePlayerView() {
  const [player, setPlayer] = useState<Player | null>(null)
  const [mode, setMode] = useState<ScreenMode>('registration')
  const [name, setName] = useState('')
  const [selectedVote, setSelectedVote] = useState<{ round: number; index: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [restoring, setRestoring] = useState(true)
  const [phoneBets, setPhoneBets] = useState([0, 0, 0, 0])
  const [questionPhase, setQuestionPhase] = useState<RoundPhase>('locked')
  const [betSaved, setBetSaved] = useState(false)
  const [loadedBetKey, setLoadedBetKey] = useState('')
  const [categoryIds, setCategoryIds] = useState<CategoryId[]>([])
  const [roundNumber, setRoundNumber] = useState(0)
  const roundNumberRef = useRef(0)
  const [selectedCategoryId, setSelectedCategoryId] = useState<CategoryId | null>(null)
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(null)
  const [mobileRanking, setMobileRanking] = useState<Player[]>([])
  const activeQuestion = getQuestion(currentQuestionId)
  const playerId = player?.id
  const selected = selectedVote?.round === roundNumber ? selectedVote.index : null
  const betHydrated = Boolean(playerId) && loadedBetKey === `${playerId}:${roundNumber}`
  const options = useMemo(() => categoryIds.length === 3 ? categoryIds.map((id) => ALL_CATEGORIES.find((category) => category.id === id)).filter((category): category is Category => Boolean(category)) : ALL_CATEGORIES.slice(0, 3), [categoryIds])
  useEffect(() => {
    const savedId = localStorage.getItem(PLAYER_ID_KEY)
    const deviceToken = localStorage.getItem(PLAYER_DEVICE_KEY)
    if (!supabaseReady) { setRestoring(false); return }
    const lookup = savedId ? `id=eq.${encodeURIComponent(savedId)}` : deviceToken ? `device_token=eq.${encodeURIComponent(deviceToken)}` : ''
    if (!lookup) { setRestoring(false); return }
    supabaseRequest<Player[]>(`players?${lookup}&select=id,name,color,balance,created_at`).then((rows) => {
      if (rows[0]) { setPlayer(rows[0]); localStorage.setItem(PLAYER_ID_KEY, rows[0].id) }
      else localStorage.removeItem(PLAYER_ID_KEY)
    }).catch(() => localStorage.removeItem(PLAYER_ID_KEY)).finally(() => setRestoring(false))
  }, [])
  useEffect(() => {
    if (!supabaseReady) return
    const refresh = () => supabaseRequest<GameState[]>('game_state?id=eq.main&select=mode,category_options,round_number,selected_category,question_phase,betting_ends_at,category_ends_at,used_categories,current_question,correct_answer_index,settled_round').then((rows) => { if (!rows[0]) return; setMode(rows[0].mode); setCategoryIds((current) => JSON.stringify(current) === JSON.stringify(rows[0].category_options ?? []) ? current : (rows[0].category_options ?? [])); const nextRound = rows[0].round_number ?? 0; if (nextRound !== roundNumberRef.current) { roundNumberRef.current = nextRound; setRoundNumber(nextRound); setSelectedVote(null) }; setSelectedCategoryId(rows[0].selected_category ?? null); setQuestionPhase(rows[0].question_phase ?? 'locked'); setCurrentQuestionId(rows[0].current_question ?? null) }).catch(() => setError('Brak połączenia z grą.'))
    refresh(); const timer = window.setInterval(refresh, 1500); return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!playerId || !supabaseReady) return
    const refreshPlayer = () => supabaseRequest<Player[]>('players?select=id,name,color,balance,created_at&order=balance.desc').then((rows) => { setMobileRanking(rows); const ownPlayer = rows.find((item) => item.id === playerId); if (ownPlayer) setPlayer((current) => current?.balance === ownPlayer.balance ? current : ownPlayer) }).catch(() => undefined)
    refreshPlayer()
    const timer = window.setInterval(refreshPlayer, 1500); return () => window.clearInterval(timer)
  }, [playerId])
  useEffect(() => {
    if (!playerId || mode !== 'game' || roundNumber === 0 || options.length !== 3) return
    let cancelled = false
    supabaseRequest<{ category_id: CategoryId }[]>(`category_votes?player_id=eq.${playerId}&round_number=eq.${roundNumber}&select=category_id`).then((rows) => {
      if (cancelled || !rows[0]) return
      const savedIndex = options.findIndex((category) => category.id === rows[0].category_id)
      if (savedIndex >= 0) setSelectedVote({ round: roundNumber, index: savedIndex })
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [playerId, mode, roundNumber, options])
  useEffect(() => {
    if (selected === null || !playerId || mode !== 'game' || roundNumber === 0 || !options[selected]) return
    supabaseRequest(`category_votes?on_conflict=player_id,round_number`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ player_id: playerId, round_number: roundNumber, category_id: options[selected].id }) }).catch(() => setError('Nie udało się zapisać głosu.'))
  }, [selected, playerId, mode, roundNumber, options])
  useEffect(() => {
    if (!playerId || mode !== 'question' || roundNumber === 0) return
    supabaseRequest<QuestionBet[]>(`question_bets?player_id=eq.${playerId}&round_number=eq.${roundNumber}&select=player_id,round_number,amounts`).then((rows) => {
      if (rows[0]?.amounts?.length === 4) { setPhoneBets(rows[0].amounts); setBetSaved(true) }
      else { setPhoneBets([0, 0, 0, 0]); setBetSaved(false) }
    }).catch(() => setError('Nie udało się odczytać stawki.')).finally(() => setLoadedBetKey(`${playerId}:${roundNumber}`))
  }, [playerId, mode, roundNumber])
  async function join(event: FormEvent) {
    event.preventDefault(); const cleanName = name.trim().replace(/\s+/g, ' ')
    if (cleanName.length < 2) return setError('Podaj imię mające co najmniej 2 znaki.')
    if (!supabaseReady) return setError('Gra nie jest jeszcze połączona z Supabase.')
    setBusy(true); setError('')
    try {
      let deviceToken = localStorage.getItem(PLAYER_DEVICE_KEY)
      if (!deviceToken) { deviceToken = crypto.randomUUID(); localStorage.setItem(PLAYER_DEVICE_KEY, deviceToken) }
      const existing = await supabaseRequest<Player[]>(`players?device_token=eq.${encodeURIComponent(deviceToken)}&select=id,name,color,balance,created_at`)
      const rows = existing.length ? existing : await supabaseRequest<Player[]>('players?select=id,name,color,balance,created_at', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: cleanName, device_token: deviceToken }) })
      if (!rows[0]) throw new Error('Brak gracza'); localStorage.setItem(PLAYER_ID_KEY, rows[0].id); setPlayer(rows[0])
    } catch { setError('Nie udało się dołączyć. Spróbuj ponownie.') } finally { setBusy(false) }
  }
  const committed = phoneBets.reduce((sum, amount) => sum + amount, 0)
  const availableBalance = Math.max(0, (player?.balance ?? 1000000) - committed)
  function adjustPhoneBet(index: number, direction: -1 | 1) {
    if (!betHydrated || questionPhase !== 'betting' || betSaved) return
    setPhoneBets((current) => current.map((amount, answerIndex) => answerIndex === index ? Math.max(0, Math.min(amount + direction * 50000, amount + availableBalance)) : amount))
  }
  async function submitBet() {
    if (!player || !betHydrated || questionPhase !== 'betting' || committed <= 0 || betSaved) return
    setBusy(true); setError('')
    try {
      await supabaseRequest('question_bets?on_conflict=player_id,round_number', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ player_id: player.id, round_number: roundNumber, amounts: phoneBets }) })
      setBetSaved(true)
    } catch { setError('Nie udało się zapisać stawki. Spróbuj ponownie.') } finally { setBusy(false) }
  }
  if (restoring) return <main className="mobile-play"><div className="mobile-glow" /><section><div className="mobile-confirmed"><span className="mobile-waiting"><i /></span></div></section></main>
  if (player && mode === 'game' && selectedCategoryId) { const chosen = ALL_CATEGORIES.find((category) => category.id === selectedCategoryId); return <main className="mobile-play"><div className="mobile-glow" /><div className="balance-notch"><strong>{player.balance.toLocaleString('pl-PL')}</strong><small>PLN</small></div><section><div className="mobile-confirmed"><div>✓</div><span className="mobile-kicker">WYLOSOWANA KATEGORIA</span><h1>{chosen?.name ?? selectedCategoryId}</h1><p>Pytanie pojawi się za chwilę.</p><span className="mobile-waiting"><i /></span></div></section></main> }
  if (!player) return <main className="mobile-play"><div className="mobile-glow" /><div className="mobile-game-mark">ALL IN</div><section><span className="mobile-kicker">DOŁĄCZ DO GRY</span><h1>Jak masz na imię?</h1><p>Podaj nazwę, pod którą zobaczą Cię pozostali gracze.</p><form className="mobile-join" onSubmit={join}><label htmlFor="join-name">Twoje imię lub nazwa</label><input id="join-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={32} placeholder="np. Krzysiek" autoFocus /><button className="primary-button" disabled={busy} type="submit">{busy ? 'Dołączanie…' : 'Dołączam'} <span>→</span></button></form>{error && <p className="form-message">{error}</p>}</section></main>
  if (mode === 'registration') return <main className="mobile-play"><div className="mobile-glow" /><div className="mobile-game-mark">ALL IN</div><div className="balance-notch"><span>SALDO</span><strong>{player.balance.toLocaleString('pl-PL')}</strong><small>PLN</small></div><section><div className="mobile-confirmed"><div style={{ background: player.color }}>{player.name.charAt(0)}</div><span className="mobile-kicker">JESTEŚ W GRZE</span><h1>{player.name}</h1><p>Gra niedługo się zacznie…</p><span className="mobile-waiting"><i /></span></div></section></main>
  if (mode === 'question' && questionPhase !== 'betting') return <main className="mobile-play mobile-results"><div className="mobile-glow" /><div className="balance-notch"><strong>{player.balance.toLocaleString('pl-PL')}</strong><small>PLN</small></div><section><div className="mobile-results-heading"><span className="mobile-kicker">STAWKI ZAMKNIĘTE</span><h1>Ranking na żywo</h1><p>Saldo zmieni się automatycznie po odsłonięciu wyniku.</p></div><div className="mobile-ranking">{mobileRanking.map((item, index) => <div key={item.id} className={item.id === player.id ? 'is-me' : ''} style={{ '--player-color': item.color } as CSSProperties}><span>{index + 1}</span><i>{item.name.charAt(0)}</i><strong>{item.name}</strong><b>{item.balance.toLocaleString('pl-PL')} <small>PLN</small></b></div>)}</div><span className="mobile-waiting"><i /></span></section></main>
  if (mode === 'question') return <main className="mobile-play mobile-question"><div className="balance-notch"><span>DOSTĘPNE</span><strong>{availableBalance.toLocaleString('pl-PL')}</strong><small>PLN</small></div><section><h2>{activeQuestion.question}</h2><div className="mobile-answers">{activeQuestion.answers.map((answer, index) => <article key={answer.id}><div><span>{answer.id}</span><strong>{answer.text}</strong></div><div className="bet-control"><button type="button" onClick={() => adjustPhoneBet(index, -1)} disabled={!betHydrated || betSaved || phoneBets[index] === 0}>−</button><b>{phoneBets[index].toLocaleString('pl-PL')} <small>PLN</small></b><button type="button" onClick={() => adjustPhoneBet(index, 1)} disabled={!betHydrated || betSaved || availableBalance < 50000}>+</button></div></article>)}</div><button className="primary-button mobile-submit-bet" type="button" onClick={submitBet} disabled={!betHydrated || busy || betSaved || committed === 0}>{!betHydrated ? 'Przygotowanie…' : betSaved ? 'Stawka zapisana ✓' : busy ? 'Zapisywanie…' : 'Postaw'}</button>{error && <p className="form-message">{error}</p>}</section></main>
  return <main className="mobile-play"><div className="mobile-glow" /><div className="mobile-game-mark">ALL IN</div><div className="balance-notch"><span>SALDO</span><strong>{player.balance.toLocaleString('pl-PL')}</strong><small>PLN</small></div><section>{selected === null ? <><span className="mobile-kicker">WYBÓR KATEGORII</span><h1>Na co oddajesz głos?</h1><p>Wybierz jedną kategorię. Po zatwierdzeniu nie możesz zmienić decyzji.</p><div className="mobile-categories">{options.map((category, index) => <button key={category.id} type="button" onClick={() => setSelectedVote({ round: roundNumber, index })}><strong>{category.name}</strong><i>→</i></button>)}</div></> : <div className="mobile-confirmed"><div>✓</div><span className="mobile-kicker">GŁOS ODDANY</span><h1>{options[selected].name}</h1><p>Czekamy na pozostałych graczy i wynik losowania.</p><span className="mobile-waiting"><i /></span></div>}</section></main>
}

function PlayerView() {
  const [openedDoors, setOpenedDoors] = useState<Set<number>>(() => new Set())
  const [phase, setPhase] = useState<RoundPhase>('betting')
  const [secondsLeft, setSecondsLeft] = useState(60)
  const [showCategory, setShowCategory] = useState(true)
  const [usedCategories, setUsedCategories] = useState<CategoryId[]>([])
  const [categoryOptions, setCategoryOptions] = useState<Category[]>(() => sampleCategories([]))
  const [categoryPhase, setCategoryPhase] = useState<'voting' | 'drawing' | 'selected'>('voting')
  const [categorySeconds, setCategorySeconds] = useState(20)
  const [votes, setVotes] = useState([0, 0, 0])
  const [myVote, setMyVote] = useState<number | null>(null)
  const [focusedCategory, setFocusedCategory] = useState<number | null>(null)
  const [winningCategory, setWinningCategory] = useState<number | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const DEMO_PLAYERS = players
  const [showStart, setShowStart] = useState(true)
  const [roundNumber, setRoundNumber] = useState(0)
  const [bettingEndsAt, setBettingEndsAt] = useState<string | null>(null)
  const [categoryEndsAt, setCategoryEndsAt] = useState<string | null>(null)
  const [questionBets, setQuestionBets] = useState<QuestionBet[]>([])
  const [hydrated, setHydrated] = useState(!supabaseReady)
  const [currentQuestionId, setCurrentQuestionId] = useState<string | null>(null)
  const [leaderboardOpen, setLeaderboardOpen] = useState(false)
  const activeQuestion = getQuestion(currentQuestionId)
  const questionAnswers = useMemo(() => {
    const playerById = new Map(players.map((player) => [player.id, player]))
    const totals = [0, 0, 0, 0]
    const bets = [[], [], [], []] as AnswerBet[][]
    questionBets.forEach((bet) => bet.amounts.forEach((amount, index) => {
      const player = playerById.get(bet.player_id)
      if (!player || !Number.isFinite(amount) || amount <= 0 || !bets[index]) return
      totals[index] += amount; bets[index].push({ name: player.name, color: player.color, amount })
    }))
    const grandTotal = totals.reduce((sum, amount) => sum + amount, 0)
    return activeQuestion.answers.map((answer, index) => ({ label: answer.text, correct: answer.correct, total: totals[index], share: grandTotal ? Math.round(totals[index] / grandTotal * 100) : 0, bets: bets[index] }))
  }, [players, questionBets, activeQuestion])
  const playUrl = `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}/play`
  const startQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=700x700&margin=0&data=${encodeURIComponent(playUrl)}`
  const loadState = useCallback(async () => {
    if (!supabaseReady) return
    try {
      const [people, states] = await Promise.all([supabaseRequest<Player[]>('players?select=id,name,color,balance,created_at&order=balance.desc'), supabaseRequest<GameState[]>('game_state?id=eq.main&select=mode,category_options,round_number,selected_category,question_phase,betting_ends_at,category_ends_at,used_categories,current_question,correct_answer_index,settled_round')])
      setPlayers(people)
      const state = states[0]
      if (state) {
        setRoundNumber(state.round_number ?? 0)
        setBettingEndsAt(state.betting_ends_at ?? null)
        setCategoryEndsAt(state.category_ends_at ?? null)
        setUsedCategories(state.used_categories ?? [])
        setCurrentQuestionId(state.current_question ?? null)
        setShowStart(state.mode === 'registration')
        setShowCategory(state.mode !== 'question')
        if (state.mode === 'question') {
          const restoredPhase = state.question_phase ?? 'locked'
          setPhase(restoredPhase)
          setOpenedDoors(restoredPhase === 'result' ? new Set(getQuestion(state.current_question).answers.map((answer, index) => !answer.correct ? index : -1).filter((index) => index >= 0)) : new Set())
        }
        const resolvedOptions = state.category_options?.length === 3 ? state.category_options.map((id) => ALL_CATEGORIES.find((category) => category.id === id)).filter((category): category is Category => Boolean(category)) : categoryOptions
        if (resolvedOptions.length === 3) setCategoryOptions(resolvedOptions)
        if (state.mode === 'game' && state.selected_category) {
          const winnerIndex = resolvedOptions.findIndex((category) => category.id === state.selected_category)
          if (winnerIndex >= 0) { setWinningCategory(winnerIndex); setFocusedCategory(winnerIndex); setCategoryPhase('selected'); setCategorySeconds(0) }
        }
        const categoryVotes = await supabaseRequest<{ category_id: CategoryId }[]>(`category_votes?round_number=eq.${state.round_number}&select=category_id`)
        setVotes(resolvedOptions.map((category) => categoryVotes.filter((vote) => vote.category_id === category.id).length))
        if (state.mode === 'question') setQuestionBets(await supabaseRequest<QuestionBet[]>(`question_bets?round_number=eq.${state.round_number}&select=player_id,round_number,amounts`))
      }
      setHydrated(true)
    }
    catch { setHydrated(true) }
  }, [])
  useEffect(() => { loadState(); const timer = window.setInterval(loadState, 1800); return () => window.clearInterval(timer) }, [loadState])
  useEffect(() => {
    if (phase !== 'betting' || showCategory || !bettingEndsAt) return
    const update = () => {
      const remaining = Math.max(0, Math.ceil((new Date(bettingEndsAt).getTime() - Date.now()) / 1000))
      setSecondsLeft(remaining)
      if (remaining === 0) {
        setPhase('locked')
        supabaseRequest('game_state?id=eq.main', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ question_phase: 'locked', updated_at: new Date().toISOString() }) }).catch(() => undefined)
      }
    }
    update(); const timer = window.setInterval(update, 250)
    return () => window.clearInterval(timer)
  }, [phase, showCategory, bettingEndsAt])
  useEffect(() => {
    if (phase === 'locked') { const timer = window.setTimeout(() => { setPhase('review'); supabaseRequest('game_state?id=eq.main', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ question_phase: 'review' }) }).catch(() => undefined) }, 3000); return () => window.clearTimeout(timer) }
    if (phase === 'review') { const timer = window.setTimeout(() => { setPhase('result'); setOpenedDoors(new Set(activeQuestion.answers.map((answer, index) => !answer.correct ? index : -1).filter((index) => index >= 0))); supabaseRequest('rpc/settle_question_round', { method: 'POST', body: '{}' }).catch(() => undefined) }, 5000); return () => window.clearTimeout(timer) }
  }, [phase, activeQuestion])
  useEffect(() => {
    if (showStart || !showCategory || categoryPhase !== 'voting' || !categoryEndsAt) return
    const update = () => {
      const remaining = Math.max(0, Math.ceil((new Date(categoryEndsAt).getTime() - Date.now()) / 1000))
      setCategorySeconds(remaining)
      if (remaining === 0) setCategoryPhase('drawing')
    }
    update(); const timer = window.setInterval(update, 250)
    return () => window.clearInterval(timer)
  }, [showStart, showCategory, categoryPhase, categoryEndsAt])
  useEffect(() => {
    if (categoryPhase !== 'drawing') return
    const winner = weightedPick(votes.map((count) => count + 1))
    const startedAt = performance.now()
    let step = 0
    let timer = 0
    const tick = () => {
      const elapsed = performance.now() - startedAt
      if (elapsed >= 3000) {
        setFocusedCategory(winner); setWinningCategory(winner); setCategoryPhase('selected')
        supabaseRequest('game_state?id=eq.main', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ selected_category: categoryOptions[winner].id, updated_at: new Date().toISOString() }) }).catch(() => undefined)
        return
      }
      setFocusedCategory(step % 3); step += 1
      timer = window.setTimeout(tick, Math.max(65, 310 - elapsed / 12))
    }
    tick()
    return () => window.clearTimeout(timer)
  }, [categoryPhase])
  function castVote(index: number) {
    if (categoryPhase !== 'voting') return
    setVotes((current) => current.map((count, optionIndex) => count + (optionIndex === index ? 1 : 0) - (optionIndex === myVote ? 1 : 0)))
    setMyVote(index)
  }
  async function startQuestion() {
    if (winningCategory === null) return
    const selectedCategory = categoryOptions[winningCategory]
    const nextUsedCategories = Array.from(new Set([...usedCategories, selectedCategory.id]))
    const categoryQuestions = gameData.categories.find((category) => category.id === selectedCategory.id)?.questions ?? []
    const selectedQuestion = categoryQuestions[Math.floor(Math.random() * categoryQuestions.length)] as GameQuestion | undefined
    if (!selectedQuestion) return
    setUsedCategories(nextUsedCategories)
    setCurrentQuestionId(selectedQuestion.id)
    const deadline = new Date(Date.now() + 60_000).toISOString()
    setSecondsLeft(60); setPhase('betting'); setBettingEndsAt(deadline); setQuestionBets([])
    setShowCategory(false)
    await supabaseRequest('game_state?id=eq.main', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ mode: 'question', question_phase: 'betting', betting_ends_at: deadline, used_categories: nextUsedCategories, current_question: selectedQuestion.id, correct_answer_index: selectedQuestion.answers.findIndex((answer) => answer.correct), updated_at: new Date().toISOString() }) }).catch(() => undefined)
  }
  async function startGame() {
    setShowStart(false)
    const nextRound = roundNumber + 1
    const deadline = new Date(Date.now() + 20_000).toISOString()
    setRoundNumber(nextRound); setVotes([0, 0, 0]); setCategorySeconds(20); setCategoryPhase('voting'); setCategoryEndsAt(deadline); setUsedCategories([])
    await supabaseRequest('game_state?id=eq.main', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ mode: 'game', round_number: nextRound, category_options: categoryOptions.map((category) => category.id), selected_category: null, category_ends_at: deadline, used_categories: [], current_question: null, correct_answer_index: null, settled_round: 0, updated_at: new Date().toISOString() }) }).catch(() => undefined)
  }
  async function nextQuestion() {
    setOpenedDoors(new Set()); setSecondsLeft(60); setPhase('betting')
    const nextOptions = sampleCategories(usedCategories)
    const chosenOptions = nextOptions.length === 3 ? nextOptions : sampleCategories([])
    const nextRound = roundNumber + 1
    const categoryDeadline = new Date(Date.now() + 20_000).toISOString()
    setRoundNumber(nextRound); setCategoryOptions(chosenOptions); setVotes([0, 0, 0]); setMyVote(null); setFocusedCategory(null); setWinningCategory(null); setCategorySeconds(20); setCategoryPhase('voting'); setShowCategory(true); setBettingEndsAt(null); setCategoryEndsAt(categoryDeadline); setQuestionBets([])
    await supabaseRequest('game_state?id=eq.main', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ mode: 'game', round_number: nextRound, category_options: chosenOptions.map((category) => category.id), selected_category: null, question_phase: 'locked', betting_ends_at: null, category_ends_at: categoryDeadline, used_categories: usedCategories, current_question: null, correct_answer_index: null, updated_at: new Date().toISOString() }) }).catch(() => undefined)
  }
  const leaderboard = <aside className={`leaderboard leaderboard-drawer ${leaderboardOpen ? 'is-open' : ''}`}><button className="leaderboard-toggle" type="button" onClick={() => setLeaderboardOpen((open) => !open)} aria-label={leaderboardOpen ? 'Zwiń ranking' : 'Pokaż ranking'} aria-expanded={leaderboardOpen}>{leaderboardOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}</button><header>Ranking</header><div>{DEMO_PLAYERS.map((item) => <div className="leader-row" key={item.id} style={{ '--player-color': item.color } as CSSProperties}><i>{item.name.charAt(0)}</i><div><strong title={item.name}>{item.name}</strong><small>{item.balance.toLocaleString('pl-PL')} PLN</small></div></div>)}</div></aside>
  if (!hydrated) return <main className="start-screen"><div className="stage-rays" /></main>
  if (showStart) return <main className="start-screen"><div className="stage-rays" /><section><div className="start-qr"><img src={startQrUrl} alt={`Kod QR prowadzący do ${playUrl}`} /></div><button type="button" onClick={startGame}>Rozpocznij grę <span>→</span></button></section></main>
  if (showCategory) return <main className="category-screen">{leaderboard}<section className="category-stage"><p>Wybierz kategorię</p><h1>Na co dziś stawiamy?</h1><div className={`category-ring ${categoryPhase === 'drawing' ? 'is-drawing' : ''}`}><svg className="ring-arcs" viewBox="0 0 100 100" aria-hidden="true">{categoryOptions.map((category, index) => <g key={category.id} transform={`rotate(${index * 120 - 90} 50 50)`}><circle className={`category-arc-track ${focusedCategory === index ? 'focused' : ''} ${winningCategory === index ? 'winner' : ''}`} cx="50" cy="50" r="43" pathLength="100" /><circle className={`category-arc-fill ${votes[index] > 0 ? 'has-votes' : ''} ${focusedCategory === index ? 'focused' : ''} ${winningCategory === index ? 'winner' : ''}`} style={{ '--category-color': CATEGORY_COLORS[index] } as CSSProperties} cx="50" cy="50" r="43" pathLength="100" /></g>)}</svg>{categoryOptions.map((category, index) => <button key={category.id} type="button" disabled={categoryPhase !== 'voting'} onClick={() => castVote(index)} className={`category-option option-${index} ${myVote === index ? 'my-vote' : ''}`}><span>{category.icon}</span><strong>{category.name}</strong><small>{votes[index]} {votes[index] === 1 ? 'głos' : 'głosów'}</small></button>)}<div className="ring-center">{categoryPhase === 'selected' ? <button className="start-question" type="button" onClick={startQuestion}><strong>Zaczynamy</strong><span>→</span></button> : <><strong>{categoryPhase === 'voting' ? categorySeconds : '•'}</strong><span>{categoryPhase === 'voting' ? 'sekund' : 'losowanie'}</span></>}</div></div></section></main>
  return <main className={`question-screen phase-${phase}`}><div className="stage-rays" />
    {phase === 'betting' && <div className="betting-progress" style={{ transform: `scaleX(${secondsLeft / 60})` }} />}
    {phase === 'review' && <div className="review-progress" />}
    {phase === 'result' && <button className="next-question" type="button" onClick={nextQuestion}>NASTĘPNE PYTANIE <span>→</span></button>}
    {leaderboard}
    <section className="question-stage"><div className="question-banner"><span>{String(roundNumber || 1).padStart(2, '0')}</span><h1>{activeQuestion.question}</h1></div><div className="trapdoors">{questionAnswers.map((answer, index) => <div className={`answer-station ${openedDoors.has(index) ? 'is-open' : ''} ${answer.correct ? 'is-correct' : 'is-wrong'}`} key={answer.label}>
      <div className="answer-display"><span>{String.fromCharCode(65 + index)}</span><strong>{answer.label}</strong><b>{answer.share}%</b></div>
      <button className="trapdoor" type="button" onClick={() => setOpenedDoors((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next })} aria-label={`${openedDoors.has(index) ? 'Zamknij' : 'Otwórz'} klapę odpowiedzi ${answer.label}`}><div className="door-money" aria-hidden="true" style={{ '--pile-height': `${10 + answer.share * 1.15}px` } as CSSProperties}><span /><span /><span /><span /></div><span className="door-hinge left" /><span className="door-hinge right" /><span className="door-edge" /></button>
      <div className="stake-meter"><div className="meter-total">{answer.total.toLocaleString('pl-PL')} <small>PLN</small></div><div className="meter-track"><div className="meter-empty" /><div className="meter-stack" style={{ height: `${Math.max(18, answer.share * 2.15)}%` }}>{answer.bets.map((bet) => <span key={bet.name} style={{ background: bet.color, flex: bet.amount }} title={`${bet.name}: ${bet.amount.toLocaleString('pl-PL')} PLN`} />)}</div></div><div className="bet-list">{answer.bets.map((bet) => <div key={bet.name} title={`${bet.name}: ${bet.amount.toLocaleString('pl-PL')} PLN`}><i style={{ background: bet.color }} /><span>{bet.name}</span><b>{(bet.amount / 1000).toFixed(0)}k</b></div>)}</div></div>
    </div>)}</div></section>
  </main>
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

export default function App() {
  const path = window.location.pathname.replace(/\/$/, '')
  if (path.endsWith('/play')) return <MobilePlayerView />
  return path.endsWith('/admin') ? <AdminView /> : <PlayerView />
}
