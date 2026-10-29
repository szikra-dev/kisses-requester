import { useEffect, useMemo, useRef, useState } from 'react'
import { NTFY_URL, PEOPLE, REQUEST_DEBOUNCE_MS } from './config.js'
import { deriveState, kissWord, latestLater, notifyTopic, publish, subscribe } from './kisses.js'

const store = {
  get(key) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    } catch {
      /* sin storage: no pasa nada */
    }
  },
}

// El topic secreto viaja en el enlace (#k=...) para no meterlo en el repo público.
function readTopic() {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('k')
  if (fromHash) store.set('topic', fromHash)
  return fromHash || store.get('topic')
}

// Acepta el enlace entero (…#k=xxx) o solo el código.
function parseTopic(input) {
  const text = input.trim()
  const i = text.indexOf('#')
  const code = i >= 0 ? new URLSearchParams(text.slice(i + 1)).get('k') : text
  return code && /^[\w-]+$/.test(code) ? code : null
}

export default function App() {
  const [topic, setTopic] = useState(readTopic)
  const [meId, setMeId] = useState(() => store.get('me'))

  if (!topic) {
    return (
      <LinkSetup
        onTopic={(t) => {
          store.set('topic', t)
          setTopic(t)
        }}
      />
    )
  }

  if (!meId || !PEOPLE.some((p) => p.id === meId)) {
    return (
      <main className="screen center">
        <div className="big-emoji">💞</div>
        <h1>¿Quién eres?</h1>
        <div className="who">
          {PEOPLE.map((p) => (
            <button
              key={p.id}
              className="btn btn-secondary"
              onClick={() => {
                store.set('me', p.id)
                setMeId(p.id)
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      </main>
    )
  }

  return <Kisses topic={topic} meId={meId} onLogout={() => (store.set('me', null), setMeId(null))} />
}

function LinkSetup({ onTopic }) {
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)
  const submit = (e) => {
    e.preventDefault()
    const t = parseTopic(value)
    if (t) onTopic(t)
    else setInvalid(true)
  }
  return (
    <main className="screen center">
      <div className="big-emoji">🔒</div>
      <h1>Falta el enlace secreto</h1>
      <p className="muted">Pega aquí el enlace que te han pasado (el que termina en <code>#k=…</code>).</p>
      <form className="link-form" onSubmit={submit}>
        <input
          className="input"
          value={value}
          onChange={(e) => (setValue(e.target.value), setInvalid(false))}
          placeholder="https://…#k=…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck="false"
        />
        <button className="btn btn-primary" disabled={!value.trim()}>
          Entrar 💋
        </button>
      </form>
      {invalid && <p className="error">Ese enlace no parece correcto</p>}
    </main>
  )
}

// Contador "para cuando nos veamos" de from → to: el valor más reciente entre la copia
// local (persistente) y lo que hay en el topic (caduca a las 12 h).
function useLater(topic, from, to, events) {
  const key = `later:${topic}:${from}:${to}`
  const [local, setLocal] = useState(() => {
    try {
      return JSON.parse(store.get(key)) ?? { n: 0, u: 0 }
    } catch {
      return { n: 0, u: 0 }
    }
  })
  const remote = useMemo(() => latestLater(events, from, to), [events, from, to])
  const current = remote && remote.u > local.u ? { n: remote.n, u: remote.u } : local
  const lastSeen = useMemo(
    () => events.reduce((t, ev) => (ev.type === 'later' && ev.from === from && ev.to === to ? Math.max(t, ev.time) : t), 0),
    [events, from, to],
  )
  useEffect(() => store.set(key, JSON.stringify({ n: current.n, u: current.u })), [key, current.n, current.u])
  const set = (n) => setLocal({ n: Math.max(0, n), u: Date.now() })
  return { ...current, lastSeen, set }
}

function Kisses({ topic, meId, onLogout }) {
  const me = PEOPLE.find((p) => p.id === meId)
  const other = PEOPLE.find((p) => p.id !== meId)

  const [events, setEvents] = useState([])
  const [status, setStatus] = useState('connecting')
  const [mode, setMode] = useState(() => (store.get('mode') === 'later' ? 'later' : 'now'))
  const [taps, setTaps] = useState(0) // toques acumulados aún sin enviar
  const [bump, setBump] = useState(0)
  const [rain, setRain] = useState(null)
  const [error, setError] = useState(null)
  const timer = useRef(null)
  const pending = useRef(0)
  const laterTimer = useRef(null)
  const laterAdded = useRef(0) // besos "para luego" pedidos aún sin publicar (para el aviso)

  const addEvent = (ev) =>
    setEvents((prev) =>
      prev.some((e) => e.id === ev.id) ? prev : [...prev, ev].sort((a, b) => a.time - b.time),
    )

  useEffect(() => subscribe(topic, addEvent, setStatus), [topic])

  const { askedOfMe, iAsked, lastReceived } = useMemo(
    () => deriveState(events, me.id, other.id),
    [events, me.id, other.id],
  )
  const owedToMe = useLater(topic, me.id, other.id, events) // lo que el otro me debe (lo gestiono yo)
  const iOwe = useLater(topic, other.id, me.id, events) // lo que le debo al otro
  const latest = useRef({ owedToMe, iOwe }) // para leer valores frescos desde timers
  useEffect(() => {
    latest.current = { owedToMe, iOwe }
  })

  // Lluvia de besos cuando llega un envío nuevo que aún no hemos visto.
  useEffect(() => {
    if (!lastReceived || store.get('seenSend') === lastReceived.id) return
    store.set('seenSend', lastReceived.id)
    setRain(lastReceived)
  }, [lastReceived])

  const send = async (payload, opts) => {
    setError(null)
    try {
      const ev = await publish(topic, payload, opts)
      if (ev) addEvent(ev)
      return true
    } catch {
      setError('No se ha podido enviar. ¿Hay internet?')
      return false
    }
  }

  // Republica los contadores "para luego" si el topic está a punto de olvidarlos.
  useEffect(() => {
    const STALE_S = 6 * 3600
    const check = () => {
      if (document.hidden) return
      const now = Date.now() / 1000
      for (const [later, from, to] of [
        [latest.current.owedToMe, me.id, other.id],
        [latest.current.iOwe, other.id, me.id],
      ]) {
        if (later.u && now - later.lastSeen > STALE_S) {
          publish(topic, { type: 'later', from, to, n: later.n, u: later.u }, { notify: false })
            .then((ev) => ev && addEvent(ev))
            .catch(() => {})
        }
      }
    }
    const first = setTimeout(check, 4000) // tras recibir el histórico
    const every = setInterval(check, 15 * 60 * 1000)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearTimeout(first)
      clearInterval(every)
      document.removeEventListener('visibilitychange', check)
    }
  }, [topic, me.id, other.id])

  // Publica (agrupado) el contador "para luego" que gestiono yo.
  const scheduleLaterPublish = () => {
    clearTimeout(laterTimer.current)
    laterTimer.current = setTimeout(() => {
      const { n, u } = latest.current.owedToMe
      const added = laterAdded.current
      laterAdded.current = 0
      setTaps(0)
      const message =
        added > 0
          ? `${me.name} te guarda ${added} ${kissWord(added)} más para cuando os veáis 🫶 (${n} en total)`
          : undefined
      send({ type: 'later', from: me.id, to: other.id, n, u }, { message, notify: added > 0 })
    }, REQUEST_DEBOUNCE_MS)
  }

  const tap = () => {
    navigator.vibrate?.(15)
    setBump((b) => b + 1)
    if (mode === 'later') {
      laterAdded.current += 1
      setTaps(laterAdded.current)
      owedToMe.set(owedToMe.n + 1)
      scheduleLaterPublish()
      return
    }
    pending.current += 1
    setTaps(pending.current)
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const n = pending.current
      pending.current = 0
      setTaps(0)
      const ok = await send({ type: 'req', from: me.id, to: other.id, n })
      if (!ok) {
        pending.current += n
        setTaps(pending.current)
      }
    }, REQUEST_DEBOUNCE_MS)
  }

  const markReceived = (all) => {
    if (all && !confirm(`¿${other.name} te ha dado los ${owedToMe.n} ${kissWord(owedToMe.n)}?`)) return
    navigator.vibrate?.(20)
    owedToMe.set(all ? 0 : owedToMe.n - 1)
    scheduleLaterPublish()
  }

  const switchMode = (m) => {
    if (m === mode) return
    // Lo que se estuviera acumulando se envía ya, para no mezclar modos.
    if (pending.current) {
      clearTimeout(timer.current)
      const n = pending.current
      pending.current = 0
      send({ type: 'req', from: me.id, to: other.id, n })
    }
    setTaps(0)
    setMode(m)
    store.set('mode', m)
  }

  useEffect(
    () => () => {
      clearTimeout(timer.current)
      clearTimeout(laterTimer.current)
    },
    [],
  )

  const sendKisses = () => {
    navigator.vibrate?.([20, 40, 20])
    send({ type: 'send', from: me.id, to: other.id, n: askedOfMe })
  }

  const later = mode === 'later'

  return (
    <main className="screen">
      <header className="top">
        <span>
          Hola, <b>{me.name}</b>
        </span>
        <span className={`dot ${status}`} title={status} />
        <button className="link" onClick={onLogout}>
          No soy {me.name}
        </button>
      </header>

      {askedOfMe > 0 && (
        <section className="card incoming">
          <p className="card-title">
            {other.name} te pide <b>{askedOfMe}</b> {kissWord(askedOfMe)}
          </p>
          <KissRow n={askedOfMe} />
          <button className="btn btn-primary" onClick={sendKisses}>
            Mandar {askedOfMe} {kissWord(askedOfMe)} 😘
          </button>
        </section>
      )}

      <div className="modes" role="tablist">
        <button role="tab" aria-selected={!later} className={!later ? 'active' : ''} onClick={() => switchMode('now')}>
          💋 Ahora
        </button>
        <button role="tab" aria-selected={later} className={later ? 'active' : ''} onClick={() => switchMode('later')}>
          🫶 Al vernos
        </button>
      </div>

      <section className="ask">
        <button
          className={`kiss-button ${later ? 'later' : ''}`}
          onClick={tap}
          aria-label={later ? `Guardar besos de ${other.name} para cuando os veáis` : `Pedir besos a ${other.name}`}
        >
          <span key={bump} className="kiss-icon">
            {later ? '🫶' : '💋'}
          </span>
        </button>
        <p className="ask-label">
          {later ? (
            <>
              Besos de <b>{other.name}</b> para cuando os veáis
            </>
          ) : (
            <>
              Pedir besos a <b>{other.name}</b>
            </>
          )}
        </p>
        <p className="counter">
          {taps > 0 ? (
            <span key={taps} className="pop">
              +{taps}
            </span>
          ) : !later && iAsked > 0 ? (
            <span className="muted">
              Esperando {iAsked} {kissWord(iAsked)} de {other.name}…
            </span>
          ) : (
            <span className="muted">
              {later ? 'Se guardan hasta que te los dé en persona' : 'Pulsa tantas veces como besos quieras'}
            </span>
          )}
        </p>
      </section>

      {lastReceived && askedOfMe === 0 && !later && (
        <p className="muted small center-text">
          Último envío de {other.name}: {lastReceived.n} {kissWord(lastReceived.n)} ·{' '}
          {new Date(lastReceived.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}

      {(owedToMe.n > 0 || iOwe.n > 0) && (
        <section className="card later-card">
          <p className="card-title">🫶 Para cuando nos veamos</p>
          {owedToMe.n > 0 && (
            <div className="later-block">
              <p>
                {other.name} te debe <b>{owedToMe.n}</b> {kissWord(owedToMe.n)}
              </p>
              <KissRow n={owedToMe.n} emoji="🫶" onTapOne={() => markReceived(false)} />
              <div className="later-actions">
                <span className="muted small">Toca uno cuando te lo dé</span>
                <button className="link" onClick={() => markReceived(true)}>
                  Me los ha dado todos ✓
                </button>
              </div>
            </div>
          )}
          {iOwe.n > 0 && (
            <div className="later-block">
              <p>
                Le debes <b>{iOwe.n}</b> {kissWord(iOwe.n)} a {other.name}
              </p>
              <KissRow n={iOwe.n} emoji="🫶" />
            </div>
          )}
        </section>
      )}

      {error && <p className="error">{error}</p>}

      <NotifySetup channel={notifyTopic(topic, me.id)} other={other.name} />

      {rain && <KissRain ev={rain} from={other.name} onClose={() => setRain(null)} />}
    </main>
  )
}

function NotifySetup({ channel, other }) {
  const [copied, setCopied] = useState(false)
  const host = new URL(NTFY_URL).host
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(channel)
      setCopied(true)
    } catch {
      /* sin portapapeles: que lo copie a mano */
    }
  }
  return (
    <details className="notify">
      <summary>🔔 Avisos en el móvil</summary>
      <p className="small">Para que te salte una notificación cuando {other} te pida besos:</p>
      <ol className="small">
        <li>
          Instala la app <b>ntfy</b> (
          <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy">Android</a> ·{' '}
          <a href="https://apps.apple.com/app/ntfy/id1625396347">iPhone</a>).
        </li>
        <li>
          Pulsa <b>+</b> y suscríbete a este canal (servidor {host}):
          <code className="channel">{channel}</code>
          <span className="notify-actions">
            <button className="link" onClick={copy}>
              {copied ? '¡Copiado!' : 'Copiar'}
            </button>
            <a className="link" href={`ntfy://${host}/${channel}`}>
              Abrir en ntfy
            </a>
          </span>
        </li>
      </ol>
    </details>
  )
}

function KissRow({ n, emoji = '💋', onTapOne }) {
  const shown = Math.min(n, 60)
  return (
    <div className="kiss-row">
      {Array.from({ length: shown }, (_, i) =>
        onTapOne ? (
          <button key={i} className="kiss-tap" onClick={onTapOne} aria-label="Marcar uno como recibido">
            {emoji}
          </button>
        ) : (
          <span key={i} style={{ animationDelay: `${i * 40}ms` }}>
            {emoji}
          </span>
        ),
      )}
      {n > shown && <span className="muted">+{n - shown}</span>}
    </div>
  )
}

// Pseudoaleatorio determinista para que el render sea puro.
const rand = (i, k) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
  return x - Math.floor(x)
}

function KissRain({ ev, from, onClose }) {
  const drops = useMemo(
    () =>
      Array.from({ length: Math.min(ev.n, 80) }, (_, i) => ({
        left: rand(i, 1) * 92,
        delay: rand(i, 2) * 1.5 + (i % 10) * 0.1,
        duration: 2.5 + rand(i, 3) * 2,
        size: 24 + rand(i, 4) * 28,
        emoji: ['💋', '😘', '❤️', '💕'][i % 4],
      })),
    [ev],
  )
  return (
    <div className="rain" onClick={onClose}>
      {drops.map((d, i) => (
        <span
          key={i}
          className="drop"
          style={{
            left: `${d.left}%`,
            animationDelay: `${d.delay}s`,
            animationDuration: `${d.duration}s`,
            fontSize: d.size,
          }}
        >
          {d.emoji}
        </span>
      ))}
      <div className="rain-card">
        <div className="big-emoji">😘</div>
        <h2>
          ¡{from} te ha mandado {ev.n} {kissWord(ev.n)}!
        </h2>
        <p className="muted small">Toca para cerrar</p>
      </div>
    </div>
  )
}
