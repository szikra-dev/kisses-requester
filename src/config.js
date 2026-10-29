// Las dos únicas personas de la app.
export const PEOPLE = [
  { id: 'david', name: 'David' },
  { id: 'olga', name: 'Olga' },
]

export const NTFY_URL = 'https://ntfy.sh'

// Tras dejar de pulsar el botón, esperamos este tiempo antes de enviar la petición
// agrupada (así 18 toques son 1 mensaje y no chocamos con el rate limit de ntfy).
export const REQUEST_DEBOUNCE_MS = 1200
