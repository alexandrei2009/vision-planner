# Vision Planner - cod sursa si resurse pentru juriu

## 1. Linkuri

- Aplicatie publica: https://vision-planner.onrender.com
- Repository GitHub: https://github.com/alexandrei2009/vision-planner

## 2. Structura proiectului

```text
vision-planner/
  server.js
  package.json
  render.yaml
  README.md
  ProiectInfo.cpp
  data/
    events.json
  public/
    index.html
    app.js
    styles.css
    sw.js
    manifest.webmanifest
    icons/
      icon.svg
      icon-192.png
      icon-512.png
      maskable-192.png
      maskable-512.png
  scripts/
    generate-icons.js
  docs/
    prezentare_vision_planner_infoeducatie.md
    pachet_juriu_cod_sursa_si_resurse.md
```

## 3. Fisiere sursa principale

- `server.js` - backend Node.js, API, autentificare, echipe, taskuri, notificari, integrare PostgreSQL si AI.
- `public/app.js` - logica frontend pentru Gantt, calendar, echipe, notificari si AI.
- `public/index.html` - structura interfetei.
- `public/styles.css` - stilizarea aplicatiei.
- `public/sw.js` - service worker PWA.
- `public/manifest.webmanifest` - configurare PWA.
- `scripts/generate-icons.js` - generare iconite PWA.
- `ProiectInfo.cpp` - sursa initiala C++ de la care a pornit proiectul.
- `render.yaml` - configurare Render pentru web service si PostgreSQL.
- `package.json` - dependinte si scripturi Node.js.

## 4. Biblioteci si resurse externe declarate

| Resursa | Rol in proiect |
| --- | --- |
| Node.js | Runtime backend |
| PostgreSQL | Baza de date pentru conturi, echipe, taskuri, notificari |
| `pg` | Driver Node.js pentru PostgreSQL |
| Render | Hosting web si baza de date |
| GitHub | Versionare si publicare cod sursa |
| OpenAI Responses API | Generare optionala de subtaskuri cu AI |
| HTML/CSS/JavaScript | Interfata web |
| PWA manifest/service worker | Instalare ca aplicatie |

Nu au fost folosite fragmente de cod externe copiate direct fara declarare. Iconitele sunt generate local.

## 5. Comenzi utile

```bash
npm install
npm start
npm run check
```

## 6. Variabile de mediu

```text
DATABASE_URL     - setata automat de Render pentru PostgreSQL
OPENAI_API_KEY   - optional, pentru AI real
OPENAI_MODEL     - optional, implicit gpt-5-mini
NODE_ENV         - production pe Render
PORT             - portul serverului
```

## 7. Observatii pentru juriu

Codul sursa complet se afla in repository. Acest fisier declara structura proiectului, dependintele si resursele externe. Pentru prezentare, cele mai importante fisiere de analizat sunt `server.js`, `public/app.js`, `public/index.html`, `public/styles.css` si `render.yaml`.

Pentru a evita un document greu de parcurs in Word, codul complet nu este duplicat integral aici. Daca juriul solicita codul in format text unic, se poate genera usor cu comanda:

```bash
find . -maxdepth 3 -type f \( -name "*.js" -o -name "*.html" -o -name "*.css" -o -name "*.json" -o -name "*.yaml" -o -name "*.cpp" -o -name "*.md" \) -not -path "./.git/*" -print
```

## 8. Checklist resurse obligatorii

- [x] Cod sursa
- [x] Fisiere necesare rularii
- [x] Biblioteci declarate
- [x] Link GitHub
- [x] Link aplicatie publica
- [x] Documentatie proiect
- [x] Ghid instalare
- [x] Lista resurse externe
