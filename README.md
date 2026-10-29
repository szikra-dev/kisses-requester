# 💋 Besitos

App web (móvil) para pedir besos entre dos personas. Vite + React, desplegada en GitHub Pages.

## Cómo funciona

- Al entrar eliges quién eres (David u Olga; se guarda en el navegador).
- Pulsa el botón tantas veces como besos quieras. Tras ~1 s sin pulsar se envía la petición.
- La otra persona ve "X te pide N besos" y le da a **Mandar besos** → a ti te llueven besos.

## "Base de datos"

No hay servidor: se usa un topic secreto de [ntfy.sh](https://ntfy.sh) (pub/sub gratis, sin cuenta).
Cada acción es un mensaje; el estado se calcula a partir de los mensajes. ntfy.sh guarda los
mensajes **12 horas**: una petición sin responder durante más de 12 h se pierde.

El topic secreto **no está en el repo**: va en el enlace, `https://<url>/#k=<topic-secreto>`.
Ábrelo una vez en cada móvil y queda guardado. Bonus: si os suscribís a ese topic en la app de
ntfy (Android/iOS) os llegan notificaciones push.

Personas y ajustes en `src/config.js`.

## Desarrollo

```sh
npm install
npm run dev      # luego abre http://localhost:5173/#k=algun-topic-de-pruebas
npm run build
```

Cada push a `main` despliega en GitHub Pages (`.github/workflows/deploy.yml`).
