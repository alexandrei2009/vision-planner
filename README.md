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

## AI si securitate

AI-ul pentru impartirea taskurilor in subtaskuri foloseste `OPENAI_API_KEY` daca este setat in Render. Fara aceasta variabila, aplicatia foloseste un fallback local de planificare.

Aplicatia include conturi cu sesiuni HTTP-only, parole hash-uite cu PBKDF2, rate limiting simplu, validari pe API si security headers. Firewall-ul de retea ramane o setare de platforma in Render.

## Ce include

- backend JavaScript pe Node.js
- persistenta PostgreSQL pe Render, cu fallback JSON local
- conturi, echipe, coduri de invitatie si date separate pe echipa
- notificari in aplicatie pentru asignari, deadline in 24h si taskuri dupa deadline
- asistent AI optional pentru subtaskuri
- API REST pentru taskuri si membri
- persistenta locala in `data/events.json`
- vizualizare Gantt, calendar si alocare pe echipa
- prioritati, deadlineuri, bugete, participanti si statusuri
