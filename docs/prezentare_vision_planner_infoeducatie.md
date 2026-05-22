# Vision Planner - prezentare proiect InfoEducatie

## 1. Date generale

**Numele proiectului:** Vision Planner  
**Sectiunea:** Software Utilitar  
**Tip aplicatie:** aplicatie web/PWA pentru planificarea evenimentelor, managementul taskurilor si colaborare in echipa  
**Link public:** https://vision-planner.onrender.com  
**Repository GitHub:** https://github.com/alexandrei2009/vision-planner  
**Tehnologii principale:** Node.js, JavaScript, HTML, CSS, PostgreSQL, Render, PWA, OpenAI Responses API optional  

Vision Planner este o aplicatie utilitara pentru organizarea clara a unui eveniment sau proiect. Aplicatia permite crearea de conturi, formarea de echipe, invitarea membrilor prin cod, planificarea taskurilor intr-un Gantt chart, alocarea responsabililor, setarea prioritatilor, bugetelor si deadlineurilor, precum si generarea de subtaskuri cu ajutorul unui modul AI.

Proiectul a pornit de la o aplicatie C++ de organizare a evenimentelor, bazata pe lista de evenimente, sortare calendaristica, cautare, modificare si calcul de buget. Vision Planner transforma acea idee intr-un produs web colaborativ, accesibil public, instalabil ca PWA si pregatit pentru utilizare reala.

## 2. Problema identificata

Organizarea unui eveniment presupune multe activitati simultane: rezervarea locatiei, bugetarea, coordonarea membrilor, confirmarea furnizorilor, pregatirea materialelor si verificarea deadlineurilor. In multe echipe, aceste informatii sunt impartite intre mesaje, fisiere, foi de calcul sau discutii informale. Din acest motiv apar frecvent probleme precum:

- taskuri uitate sau neasumate;
- deadlineuri ratate;
- bugete greu de urmarit;
- lipsa unei imagini de ansamblu asupra calendarului;
- comunicare neclara intre membrii echipei;
- dificultatea de a imparti un task complex in pasi mici si executabili.

Vision Planner incearca sa rezolve aceste probleme printr-un spatiu unic in care echipa vede planul, responsabilitatile, bugetele si notificarile.

## 3. Public tinta

Publicul tinta este format din:

- elevi sau studenti care organizeaza proiecte, concursuri, cluburi sau evenimente;
- echipe mici care au nevoie de o unealta clara de planificare;
- coordonatori de proiecte educationale;
- organizatori de workshopuri, prezentari, conferinte sau activitati locale;
- echipe care nu au nevoie de un sistem enterprise complex, dar vor o aplicatie intuitiva si rapida.

Exemplu de utilizare: o echipa care organizeaza o conferinta poate crea echipa in Vision Planner, poate invita membrii prin cod, poate adauga taskuri precum "Rezervare locatie", "Materiale vizuale", "Confirmare furnizori", poate atribui fiecare task unui membru si poate urmari evolutia in Gantt chart.

## 4. Analiza pietei si elemente distinctive

Exista deja aplicatii cunoscute pentru managementul taskurilor, precum Trello, Asana, Notion, Monday.com sau Google Calendar. Acestea sunt produse puternice, dar pot fi prea generale sau prea incarcate pentru o echipa mica aflata la inceput. Vision Planner se diferentiaza prin faptul ca este orientat direct spre organizarea de evenimente si proiecte scolare, nu spre management enterprise.

Elemente distinctive ale aplicatiei:

- Gantt chart-ul este primul ecran principal, nu o functie ascunsa;
- fiecare task are deadline, prioritate, buget si responsabil;
- aplicatia are echipe separate, fiecare cu date independente;
- membrii reali intra in echipa prin cod de invitatie;
- taskurile pot fi impartite in subtaskuri cu un asistent AI;
- notificarile sunt integrate in aplicatie;
- aplicatia poate fi instalata ca PWA si folosita aproape ca o aplicatie desktop;
- proiectul este open-source si usor de explicat tehnic in fata juriului.

Prin comparatie cu un simplu calendar, Vision Planner arata si durata taskului, persoana responsabila, bugetul si statusul. Prin comparatie cu o foaie de calcul, aplicatia are validari, conturi, echipe si notificari. Prin comparatie cu un tool enterprise, este mai simpla si mai potrivita pentru publicul tinta.

## 5. Planificarea dezvoltarii

Dezvoltarea proiectului a fost gandita incremental:

1. Transformarea aplicatiei C++ initiale intr-un backend web.
2. Crearea unei interfete Gantt intuitive.
3. Adaugarea persistentei datelor.
4. Publicarea aplicatiei pe web.
5. Transformarea in PWA instalabila.
6. Adaugarea bazei de date PostgreSQL.
7. Adaugarea conturilor, echipelor si codurilor de invitatie.
8. Adaugarea notificarilor si a asistentei AI.
9. Pregatirea documentatiei si a pachetului pentru juriu.

Roadmap propus:

- notificari prin email pentru deadlineuri;
- roluri mai detaliate: owner, manager, membru;
- istoric de activitate pe task;
- export PDF/CSV pentru planul proiectului;
- comentarii pe taskuri;
- dashboard cu progres pe echipa;
- integrare cu calendar extern;
- teste automate mai extinse.

## 6. Solutia propusa

Vision Planner propune o aplicatie web colaborativa in care fiecare utilizator isi creeaza cont, isi creeaza sau se alatura unei echipe si gestioneaza proiectele acelei echipe. Fiecare echipa are taskurile si membrii ei, separate de cele ale altor echipe.

Functionalitati principale:

- creare cont si autentificare;
- creare echipa;
- redenumire echipa;
- generare cod de invitatie;
- alaturare la o echipa prin cod;
- afisarea taskurilor intr-un Gantt chart;
- calendar al deadlineurilor;
- vizualizare pe membrii echipei;
- adaugare, editare si stergere taskuri;
- setare prioritate: critica, mare, medie, mica;
- setare status: planificat, in lucru, finalizat, blocat;
- alocare responsabil;
- buget si numar de membri implicati;
- notificari in aplicatie;
- AI pentru impartirea unui task complex in subtaskuri;
- instalare ca PWA.

## 7. Arhitectura aplicatiei

Aplicatia are o arhitectura client-server:

- **Frontend:** HTML, CSS si JavaScript, servite static din folderul `public/`.
- **Backend:** server Node.js in `server.js`, construit peste modulul nativ `http`.
- **Baza de date:** PostgreSQL pe Render, accesata prin driverul `pg`.
- **Fallback local:** `data/events.json`, pentru rularea locala fara baza de date.
- **PWA:** `manifest.webmanifest`, `sw.js` si iconite in `public/icons/`.
- **AI:** endpoint backend care apeleaza OpenAI Responses API daca exista `OPENAI_API_KEY`; altfel foloseste un fallback local.

Flux simplificat:

1. Utilizatorul deschide aplicatia.
2. Daca nu este autentificat, vede ecranul de login/register.
3. Dupa autentificare, backendul returneaza echipele utilizatorului.
4. Frontendul trimite cereri API cu echipa activa.
5. Backendul verifica sesiunea si accesul la echipa.
6. Datele sunt citite/scrise in PostgreSQL.
7. Notificarile sunt generate la asignare, deadline apropiat sau task depasit.

## 8. Tehnologii folosite si justificare

**Node.js** a fost ales pentru backend deoarece permite un server web rapid, portabil si usor de publicat pe Render. Pentru un proiect utilitar web, JavaScript pe frontend si backend reduce complexitatea si permite dezvoltarea rapida.

**JavaScript, HTML si CSS** au fost folosite pentru frontend pentru ca sunt tehnologii standard, suportate nativ de browser. Nu a fost nevoie de un framework greu, deoarece aplicatia are o structura clara si poate fi controlata eficient cu JavaScript simplu.

**PostgreSQL** a fost ales pentru persistenta reala a datelor. Spre deosebire de un fisier JSON, PostgreSQL este potrivit pentru conturi, echipe, sesiuni, notificari si taskuri separate.

**Render** a fost folosit pentru publicare deoarece poate rula servicii Node.js si poate crea o baza PostgreSQL prin `render.yaml`. Aplicatia are un link public, ceea ce creste maturitatea proiectului.

**PWA** a fost folosita pentru ca utilizatorul sa poata instala aplicatia pe dispozitiv si sa o deschida ca pe o aplicatie normala.

**OpenAI Responses API** este folosita optional pentru generarea de subtaskuri. Daca nu exista cheie API, aplicatia ramane functionala prin fallback local.

## 9. Stabilitatea aplicatiei

Aplicatia a fost construita astfel incat sa foloseasca responsabil resursele:

- nu foloseste frameworkuri frontend mari;
- fisierele statice sunt servite direct;
- backendul foloseste conexiuni PostgreSQL prin pool;
- datele sunt filtrate pe echipa inainte de afisare;
- PWA-ul foloseste cache pentru fisiere statice;
- API-ul returneaza JSON compact;
- logica de notificari este limitata si deduplicata prin chei unice.

Rularea pe Render permite restart automat al serviciului in caz de eroare, iar endpointul `/healthz` poate fi folosit pentru verificarea starii serviciului.

## 10. Securitatea aplicatiei

Securitatea a fost tratata proportional cu faptul ca aplicatia gestioneaza conturi, echipe si date de proiect.

Masuri implementate:

- parole hash-uite cu PBKDF2 si salt;
- sesiuni stocate prin token hash-uit;
- cookie HTTP-only pentru sesiune;
- cookie `Secure` in productie;
- validarea datelor de intrare;
- verificarea accesului la echipa pentru fiecare cerere;
- separarea datelor pe echipa;
- rate limiting simplu pe IP si ruta;
- blocarea cererilor mutante fara header intern `X-Requested-With`;
- security headers: `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`;
- tratarea erorilor prin raspunsuri JSON controlate;
- evitarea expunerii cheilor API in frontend.

Protectia de tip firewall/DDoS este oferita la nivel de platforma de Render. In plus, aplicatia contine protectii la nivel de cod impotriva scenariilor nedorite.

## 11. Testarea produsului

Au fost facute verificari functionale si tehnice:

- `node --check server.js` pentru verificarea sintaxei backendului;
- `node --check public/app.js` pentru verificarea sintaxei frontendului;
- test API fara autentificare, care trebuie sa intoarca 401;
- test register/login;
- test creare echipa si cod de invitatie;
- test incarcare taskuri dupa autentificare;
- test endpoint AI cu fallback local;
- test persistenta taskurilor dupa refresh;
- test publicare pe Render;
- test PWA si iconita aplicatiei;
- test Git/GitHub prin commituri si push.

Riscuri testate sau luate in considerare:

- lipsa conexiunii la baza de date;
- lipsa cheii OpenAI;
- utilizator neautentificat;
- incercarea de acces la alta echipa;
- date invalide pentru taskuri;
- cache vechi in PWA.

## 12. Maturitatea aplicatiei

Aplicatia este deja publicata si poate fi folosita de utilizatori reali. Are conturi, echipe, baza de date si interfata instalabila. Este suficient de matura pentru o demonstratie in fata juriului si pentru utilizare de catre o echipa mica.

Limitari existente:

- notificarile sunt in-app, nu email sau push native;
- AI-ul real necesita o cheie `OPENAI_API_KEY`;
- nu exista inca roluri avansate;
- nu exista inca comentarii pe taskuri;
- testele sunt in principal manuale si de integrare simpla.

Aceste limitari sunt potrivite pentru roadmap si nu impiedica folosirea produsului in scenarii reale de baza.

## 13. Sistem de versionare

Proiectul foloseste Git si GitHub. Repository-ul este publicat la:

https://github.com/alexandrei2009/vision-planner

Exemple de commituri relevante:

- `Initial Vision Planner app`;
- `Add PostgreSQL persistence`;
- `Improve compact Gantt task labels`;
- `Add accounts teams notifications and AI planning`.

Folosirea Git permite urmarirea evolutiei proiectului, revenirea la versiuni anterioare si publicarea automata pe Render.

## 14. Interfata si experienta utilizatorului

Interfata a fost gandita pentru a fi clara si directa. Primul ecran dupa autentificare este Gantt chart-ul, deoarece acesta ofera imediat imaginea de ansamblu asupra proiectului.

Principii UI/UX aplicate:

- navigare prin taburi: Gantt, Calendar, Echipa;
- formular lateral pentru adaugare/editare task;
- culori diferite pentru prioritati;
- badge-uri compacte pentru taskuri scurte;
- summary cards pentru numar de taskuri, buget si deadlineuri;
- layout responsive;
- butoane clare pentru actiuni principale;
- codul de invitatie este vizibil si usor de copiat;
- notificarile sunt accesibile din bara de sus;
- aplicatia poate fi instalata ca PWA.

Aplicatia este rapida deoarece nu depinde de frameworkuri grele si foloseste JavaScript simplu.

## 15. Lucrul in echipa

Daca proiectul este prezentat individual, rolurile au fost acoperite de autor:

- analiza problemei;
- proiectarea arhitecturii;
- implementarea backendului;
- implementarea frontendului;
- publicarea pe Render;
- testarea functionalitatilor;
- documentarea proiectului.

Daca proiectul este prezentat de o echipa, se poate completa astfel:

- membru 1: backend, baza de date, securitate;
- membru 2: frontend, UX/UI, PWA;
- membru 3: testare, documentatie, prezentare;
- membru 4: analiza pietei, roadmap, feedback utilizatori.

Pentru lucru in echipa se foloseste GitHub. Vision Planner poate fi folosit chiar ca instrument de task tracking pentru dezvoltarea sa, deoarece permite crearea de taskuri, alocarea responsabililor si urmarirea deadlineurilor.

## 16. Resurse obligatorii

Pachetul pentru juriu trebuie sa contina:

- codul sursa complet;
- fisierele necesare rularii: `package.json`, `render.yaml`, `public/`, `server.js`, `data/events.json`;
- lista bibliotecilor externe;
- ghidul de instalare;
- linkul GitHub;
- linkul public Render;
- documentatia proiectului.

Resurse externe folosite:

- Node.js;
- PostgreSQL;
- pachetul `pg`;
- Render;
- OpenAI Responses API optional;
- GitHub;
- standarde web HTML/CSS/JavaScript;
- PWA manifest si service worker.

Nu au fost folosite fragmente de cod externe copiate direct fara declarare. Iconitele PWA sunt generate local prin `scripts/generate-icons.js`.

## 17. Ghid de instalare si configurare

### Rulare locala

1. Se cloneaza repository-ul:

```bash
git clone https://github.com/alexandrei2009/vision-planner.git
```

2. Se intra in folder:

```bash
cd vision-planner
```

3. Se instaleaza dependintele:

```bash
npm install
```

4. Se porneste aplicatia:

```bash
npm start
```

5. Se deschide:

```text
http://localhost:3000
```

### Configurare AI

Pentru AI real se seteaza in Render variabila:

```text
OPENAI_API_KEY
```

Fara aceasta cheie, aplicatia foloseste un fallback local.

### Publicare

Aplicatia este pregatita pentru Render prin `render.yaml`. Render creeaza serviciul web si baza PostgreSQL.

## 18. Testimoniale

Aceasta sectiune trebuie completata cu feedback real de la persoane care au folosit aplicatia.

Model de completare:

> "Aplicatia m-a ajutat sa vad clar ce taskuri sunt urgente si cine este responsabil de ele." - nume utilizator, rol

> "Gantt chart-ul este mai usor de inteles decat o lista simpla de taskuri." - nume utilizator, rol

> "Codul de invitatie face simpla adaugarea colegilor in echipa." - nume utilizator, rol

## 19. Concluzie

Vision Planner este o aplicatie utilitara completa pentru organizarea evenimentelor si proiectelor in echipa. Proiectul porneste de la o idee simpla, un organizator de evenimente, si o extinde intr-un produs web colaborativ, cu baza de date, conturi, echipe, notificari, PWA si asistenta AI.

Aplicatia rezolva o problema reala: lipsa unei imagini clare asupra responsabilitatilor si deadlineurilor. Prin interfata Gantt si prin separarea pe echipe, Vision Planner ofera un mod intuitiv de a planifica, urmari si coordona munca.

Proiectul este pregatit pentru prezentare in fata juriului deoarece are documentatie, cod sursa versionat, link public, functionalitati demonstrabile si o directie clara de dezvoltare.
