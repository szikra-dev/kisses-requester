import { NTFY_URL, PEOPLE } from './config.js'

// "Backend": un topic secreto de ntfy.sh. Cada evento es un mensaje cuyas tags
// llevan los datos: t:<tipo>, f:<from>, o:<to>, n:<cantidad>, u:<updatedAt ms>.
// Tipos:
//   req   → pido n besos ahora (se suman hasta que llega un send)
//   send  → mando los besos pedidos
//   later → "para cuando nos veamos": n es el TOTAL pendiente que `to` le debe a `from`.
//           Solo `from` lo modifica (suma al pedir, resta al desmarcar), así que gana el de
//           mayor `u`. Como ntfy.sh borra los mensajes a las 12 h, las apps lo republican.

const nameOf = (id) => PEOPLE.find((p) => p.id === id)?.name ?? id
export const kissWord = (n) => (n === 1 ? 'beso' : 'besos')

const MESSAGES = {
  req: (from, n) => `${nameOf(from)} te pide ${n} ${kissWord(n)} 💋`,
  send: (from, n) => `${nameOf(from)} te manda ${n} ${kissWord(n)} 😘`,
  later: (from, n) => `${nameOf(from)} te guarda ${n} ${kissWord(n)} para cuando os veáis 🫶`,
}

export async function publish(topic, { type, from, to, n, u }, { message, notify: push } = {}) {
  message ??= MESSAGES[type](from, n)
  const tags = ['kiss', `t:${type}`, `f:${from}`, `o:${to}`, `n:${n}`]
  if (u) tags.push(`u:${u}`)
  const res = await fetch(`${NTFY_URL}/`, {
    method: 'POST',
    body: JSON.stringify({ topic, title: 'Besitos', message, tags }),
  })
  if (!res.ok) throw new Error(`ntfy respondió ${res.status}`)
  if (push ?? type === 'req') notify(topic, to, message)
  return parseEvent(await res.json())
}

// Canal personal de avisos: cada uno se suscribe al suyo en la app de ntfy del móvil.
export const notifyTopic = (topic, person) => `${topic}-${person}`

// Aviso push al destinatario. Si falla no pasa nada: la petición ya está publicada.
function notify(topic, to, message) {
  fetch(`${NTFY_URL}/`, {
    method: 'POST',
    body: JSON.stringify({
      topic: notifyTopic(topic, to),
      title: 'Besitos',
      message,
      tags: ['kiss'],
      priority: 4,
      click: `${location.origin}${location.pathname}#k=${topic}`,
    }),
  }).catch(() => {})
}

export function parseEvent(raw) {
  if (raw?.event !== 'message') return null
  const data = {}
  for (const tag of raw.tags ?? []) {
    const i = tag.indexOf(':')
    if (i > 0) data[tag.slice(0, i)] = tag.slice(i + 1)
  }
  if (!data.t || !data.f || !data.o) return null
  return {
    id: raw.id,
    time: raw.time,
    type: data.t,
    from: data.f,
    to: data.o,
    n: Number(data.n) || 0,
    u: Number(data.u) || 0,
  }
}

// Escucha en tiempo real (y recibe el histórico al conectar). Devuelve una función para cerrar.
export function subscribe(topic, onEvent, onStatus) {
  const es = new EventSource(`${NTFY_URL}/${encodeURIComponent(topic)}/sse?since=all`)
  es.addEventListener('open', () => onStatus?.('online'))
  es.onmessage = (e) => {
    const ev = parseEvent(JSON.parse(e.data))
    if (ev) onEvent(ev)
  }
  es.onerror = () => onStatus?.('offline')
  return () => es.close()
}

// Calcula el estado a partir de la lista de eventos (ordenada por tiempo).
export function deriveState(events, me, other) {
  let askedOfMe = 0 // besos que el otro me ha pedido y aún no he mandado
  let iAsked = 0 // besos que yo he pedido y aún no me han mandado
  let lastReceived = null
  for (const ev of events) {
    if (ev.type === 'req' && ev.from === other && ev.to === me) askedOfMe += ev.n
    if (ev.type === 'req' && ev.from === me && ev.to === other) iAsked += ev.n
    if (ev.type === 'send' && ev.from === me && ev.to === other) askedOfMe = 0
    if (ev.type === 'send' && ev.from === other && ev.to === me) {
      iAsked = 0
      lastReceived = ev
    }
  }
  return { askedOfMe, iAsked, lastReceived }
}

// Último snapshot "para cuando nos veamos" de from → to que hay en el topic.
export function latestLater(events, from, to) {
  let best = null
  for (const ev of events) {
    if (ev.type !== 'later' || ev.from !== from || ev.to !== to) continue
    if (!best || ev.u > best.u || (ev.u === best.u && ev.time > best.time)) best = ev
  }
  return best
}
