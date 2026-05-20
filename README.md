# Vision Planner

Aplicatie web pentru organizarea evenimentelor, pornita de la logica din `ProiectInfo.cpp`.

## Rulare

```bash
node server.js
```

Apoi deschide `http://localhost:3000`.

## Instalare ca aplicatie

Aplicatia este pregatita ca PWA. Dupa ce este deschisa pe `localhost` sau pe un link `https`, browserul poate afisa optiunea de instalare. Cand browserul permite, apare si butonul `Instaleaza` in bara de sus.

## Publicare pe web

Proiectul include `package.json` si `render.yaml`, deci poate fi publicat ca serviciu Node pe Render.

Setari principale:

- Build Command: `npm install --omit=dev`
- Start Command: `npm start`
- Health Check Path: `/healthz`

Blueprint-ul creeaza si o baza de date PostgreSQL `vision-planner-db`, apoi seteaza automat `DATABASE_URL` pentru serviciul web.

## Ce include

- backend JavaScript pe Node.js
- persistenta PostgreSQL pe Render, cu fallback JSON local
- API REST pentru taskuri si membri
- persistenta locala in `data/events.json`
- vizualizare Gantt, calendar si alocare pe echipa
- prioritati, deadlineuri, bugete, participanti si statusuri
