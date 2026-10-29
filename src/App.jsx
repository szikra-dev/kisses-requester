import { useEffect, useMemo, useRef, useState } from 'react'
import { PEOPLE, REQUEST_DEBOUNCE_MS } from './config.js'
import { deriveState, publish, subscribe } from './kisses.js'

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

const kissWord = (n) => (n === 1 ? 'beso' : 'besos')

export default function App() {
  const [topic] = useState(readTopic)
  const [meId, setMeId] = useState(() => store.get('me'))

  if (!topic) {
    return (
      <main className="screen center">
        <div className="big-emoji">🔒</div>
        <h1>Falta el enlace secreto</h1>
        <p className="muted">Abre la app con el enlace que te han pasado (el que termina en <code>#k=…</code>).</p>
      </main>
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

function Kisses({ topic, meId, onLogout }) {
  const me = PEOPLE.find((p) => p.id === meId)
  const other = PEOPLE.find((p) => p.id !== meId)

  const [events, setEvents] = useState([])
  const [status, setStatus] = useState('connecting')
  const [taps, setTaps] = useState(0) // toques acumulados aún sin enviar
  const [bump, setBump] = useState(0)
  const [rain, setRain] = useState(null)
  const [error, setError] = useState(null)
  const timer = useRef(null)
  const pending = useRef(0)

  const addEvent = (ev) =>
    setEvents((prev) =>
      prev.some((e) => e.id === ev.id) ? prev : [...prev, ev].sort((a, b) => a.time - b.time),
    )

  useEffect(() => subscribe(topic, addEvent, setStatus), [topic])

  const { askedOfMe, iAsked, lastReceived } = useMemo(
    () => deriveState(events, me.id, other.id),
    [events, me.id, other.id],
  )

  // Lluvia de besos cuando llega un envío nuevo que aún no hemos visto.
  useEffect(() => {
    if (!lastReceived || store.get('seenSend') === lastReceived.id) return
    store.set('seenSend', lastReceived.id)
    setRain(lastReceived)
  }, [lastReceived])

  const send = async (payload) => {
    setError(null)
    try {
      const ev = await publish(topic, payload)
      if (ev) addEvent(ev)
      return true
    } catch {
      setError('No se ha podido enviar. ¿Hay internet?')
      return false
    }
  }

  const tap = () => {
    navigator.vibrate?.(15)
    setBump((b) => b + 1)
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

  useEffect(() => () => clearTimeout(timer.current), [])

  const sendKisses = () => {
    navigator.vibrate?.([20, 40, 20])
    send({ type: 'send', from: me.id, to: other.id, n: askedOfMe })
  }

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

      <section className="ask">
        <button className="kiss-button" onClick={tap} aria-label={`Pedir besos a ${other.name}`}>
          <span key={bump} className="kiss-icon">
            💋
          </span>
        </button>
        <p className="ask-label">
          Pedir besos a <b>{other.name}</b>
        </p>
        <p className="counter">
          {taps > 0 ? (
            <span key={taps} className="pop">
              +{taps}
            </span>
          ) : iAsked > 0 ? (
            <span className="muted">
              Esperando {iAsked} {kissWord(iAsked)} de {other.name}…
            </span>
          ) : (
            <span className="muted">Pulsa tantas veces como besos quieras</span>
          )}
        </p>
      </section>

      {lastReceived && askedOfMe === 0 && (
        <p className="muted small center-text">
          Último envío de {other.name}: {lastReceived.n} {kissWord(lastReceived.n)} ·{' '}
          {new Date(lastReceived.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}

      {error && <p className="error">{error}</p>}

      {rain && <KissRain ev={rain} from={other.name} onClose={() => setRain(null)} />}
    </main>
  )
}

function KissRow({ n }) {
  const shown = Math.min(n, 60)
  return (
    <div className="kiss-row">
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} style={{ animationDelay: `${i * 40}ms` }}>
          💋
        </span>
      ))}
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
