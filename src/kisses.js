import { NTFY_URL, PEOPLE } from './config.js'

// "Backend": un topic secreto de ntfy.sh. Cada evento es un mensaje cuyas tags
// llevan los datos: t:<req|send>, f:<from>, o:<to>, n:<cantidad>.
// ntfy.sh guarda los mensajes 12 h, que es más que suficiente para pedir besos.

const nameOf = (id) => PEOPLE.find((p) => p.id === id)?.name ?? id

export async function publish(topic, { type, from, to, n }) {
  const message =
    type === 'req'
      ? `${nameOf(from)} te pide ${n} ${n === 1 ? 'beso' : 'besos'} 💋`
      : `${nameOf(from)} te manda ${n} ${n === 1 ? 'beso' : 'besos'} 😘`
  const res = await fetch(`${NTFY_URL}/`, {
    method: 'POST',
    body: JSON.stringify({
      topic,
      title: 'Besitos',
      message,
      tags: ['kiss', `t:${type}`, `f:${from}`, `o:${to}`, `n:${n}`],
    }),
  })
  if (!res.ok) throw new Error(`ntfy respondió ${res.status}`)
  if (type === 'req') notify(topic, to, message)
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
  return { id: raw.id, time: raw.time, type: data.t, from: data.f, to: data.o, n: Number(data.n) || 0 }
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
