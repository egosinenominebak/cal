# Passaggio di consegne: registro presenze e ferie

Per chi continua il lavoro (anche con un altro Claude): questo file riassume lo stato del progetto al 19/11/2026. Il file da usare e modificare è `docs/index.html` (la v6), pubblicato con GitHub Pages dalla cartella `docs/`. Le versioni vecchie sono in `versioni/` (`calendar_v1.html` … `calendar_v5.html`) e servono solo come storico: non vanno messe in `docs/`, perché sullo stesso indirizzo condividerebbero `localStorage` con la v6.

**Nomi dei file e versioni:** dalla v6 il file vive a un indirizzo fisso, quindi si chiama sempre `docs/index.html`. Per una versione nuova: copia la versione attuale in `versioni/calendar_vX.html` (storico), poi modifica `docs/index.html`. La storia completa è anche in git. La conversazione delle versioni 1-5 non è nel repository.

## Cos'è

Un solo file HTML, in italiano, senza librerie. Senza rete, a meno che l'utente non attivi la sincronizzazione online (v6), che scarica Firebase da gstatic.com. I dati restano nel browser (`localStorage`). Serve a segnare presenze, smart working, ferie, permessi e malattia giorno per giorno, per uno o più datori di lavoro, e a vedere saldi, maturazioni ed export.

## Dove sono i dati

- Chiave `presenze_tracker_v3` in `localStorage`. Alla prima apertura il file legge anche `presenze_tracker_v2` e `presenze_tracker_v1` e li migra, lasciandoli intatti.
- Ogni browser e ogni percorso del file hanno la propria copia dei dati. Per spostarli: menu Dati, "Salva backup completo (JSON)", poi "Ripristina da file JSON…" nell'altro browser.
- Formato: `jobs[]` con nome, inizio e fine del rapporto, impostazioni (`cfg`), giorni (`days`), quote per anno (`years`) e snapshot della maturazione (`snaps`). `activeJob` può valere `__all__` per la vista somma, che è in sola lettura. `settings` globali contiene solo il tema.
- Un giorno è `{ presence: {status, hours}|null, absence: {status, hours}|null, note }`. La presenza è `work` o `smart`; l'assenza è `ferie`, `permesso` (ROL), `exfest` (permesso ex festività), `malattia`, `chiusura` o `festivo`. Presenza e assenza possono convivere (per esempio lavoro 6 h e permesso 2 h).
- Esempi dei file veri sono in `esempi/` (dati inventati).
- **Sincronizzazione (v6):** `presenze_sync_config` (configurazione Firebase incollata dall'utente; in alternativa la costante `FIREBASE_CONFIG` nel file) e `presenze_sync_v1` (`enabled`, `uid`, `email`, `rev` e impronta `hash` dell'ultimo allineamento, `at`). Online: un documento Firestore `users/{uid}` con `data` (JSON di `{version, jobs}`), `rev`, `by` (browser e sistema), `app`, `updatedAt`. Regole in `firebase/firestore.rules`.

## Regole decise

- **Giorni lavorativi:** configurabili per datore (di default lun-ven). Ferie, permessi, malattia e chiusure contano solo nei giorni lavorativi e non nei festivi. Festività nazionali, Pasqua e Pasquetta sono calcolate; il santo patrono è per datore.
- **Rapporto di lavoro:** inizio e fine (o "in corso, senza fine prevista"). I giorni fuori dal rapporto non si segnano, non contano e non risultano "da compilare". Il primo rapporto parte il 12/10/2026 (scelto dall'utente, modificabile).
- **Ore:** ferie contate a ore divise per le ore della giornata (4 h su 8 = 0,5 giorni). Permessi ROL ed ex festività in ore, due saldi separati. Quote e riporti per anno.
- **Maturazione a ore lavorate:** regola indipendente per ferie, ROL ed ex festività, tutte nella forma "X ore ogni N ore lavorate". Conta solo presenza (lavoro e smart) fino a oggi. Il calcolo è lineare, quindi può differire dall'arrotondamento mensile del cedolino. I valori vanno presi da CCNL o cedolino: non c'è nessun default.
- **Chiusura aziendale:** tipo di giorno, non assenza. Per datore può scalare da ferie, ROL, ex festività o niente. Negli export non compare mai come assenza.
- **Smart working:** limite settimanale "soft" (giorni a settimana, anche mezzi) con due scadenze l'anno per datore (default 31/5 e 31/12). I giorni possibili di un periodo sono la somma, per settimana, del minimo tra il limite e i giorni lavorativi non interamente in assenza. Avvisa, non blocca.
- **Export PDF (v5):** menu Dati, "Esporta <mese> in PDF" e "Esporta l'anno in PDF", per il mese e l'anno mostrati. Il PDF è scritto direttamente dal file (PDF 1.4, nessuna libreria, nessuna rete) e si scarica con un clic, senza dialogo di stampa. È sempre in chiaro. Font: Helvetica standard con codifica WinAnsi: le lettere accentate italiane, gli apostrofi tipografici e il simbolo dell'euro escono giusti, mentre emoji e alfabeti diversi diventano "?".
  - **Mese (A4 verticale):** calendario con stati, ore, festività, note brevi e segnali (da compilare, oggi, non conteggiato, oltre il limite di smart working), legenda, riepilogo del mese, saldi dell'anno e l'elenco completo delle note. Se le note non ci stanno, il PDF continua su altre pagine.
  - **Anno (A4 orizzontale):** cartellino 12 x 31 con un codice per stato (L, SW, F, R, EF, M, CH, FS) e le ore quando non sono quelle standard, i totali di ogni mese e dell'anno, la legenda, i saldi (con un saldo di smart working per periodo), il riepilogo con la maturazione e le note su due colonne.
  - Funziona anche nella vista somma: dati sommati e residui per datore. Nomi dei file: `presenze-2026-11[-datore].pdf`, `presenze-2026[-datore]-anno.pdf`, con `-tutti-i-datori` nella vista somma.
- **Sincronizzazione online (v6):** facoltativa. Firebase compat 10.14.1, caricato solo se la sincronizzazione è attiva o si preme "Accedi con Google" (popup; il redirect non è usato perché su github.io non è affidabile). `localStorage` resta la copia principale; `persist()` chiama `syncChanged()` che salva online dopo 0,9 s di calma, in una transazione che controlla `rev`. Vanno online solo `version` e `jobs`: tema, datore mostrato e ultimo backup restano locali. Se il cloud è cambiato e anche il dispositivo ha modifiche non sincronizzate, si chiede: Unisci (base online, vince il dispositivo sulle stesse date; si può annullare), Usa i dati online, Usa questo dispositivo. Un dispositivo vuoto prende i dati online senza chiedere. Accesso disattivato da `file://`.
- **Stampa:** la voce "Stampa la pagina" resta; la stampa è sempre in chiaro e con i colori di sfondo, anche con tema scuro del sito o del sistema.
- **Export:** CSV anno completo, solo giorni compilati, storico di tutti i datori; JSON per datore, uno per ogni datore, backup completo. CSV con BOM UTF-8, virgola decimale, protezione dalle formule.

## Cosa non è verificato

- Il rendering con i font di Windows (Bahnschrift per titoli e numeri): i test e le immagini sono stati fatti con un Chromium su Linux.
- Firefox e Safari: non provati. La stampa è stata provata solo in Chromium.
- PDF della v5: generati in Chromium e controllati con i test (struttura, testi, colori) e guardandoli renderizzati con Poppler su Linux. Non aperti in Adobe Reader, nel visore di Windows o su un telefono; il download su iPhone non è provato.
- L'uso reale con i dati dell'utente: i test usano dati inventati.
- **Sincronizzazione v6 con Firebase vero:** testata solo con un Firebase finto che imita l'API compat (`test/test6-sync.mjs`, 55 controlli). Accesso con Google, regole di Firestore, latenza e comportamento offline reali vanno provati a mano dopo aver creato il progetto. Su iPhone in modalità app (schermata Home) il popup di accesso Google non è provato.

## Stato della v6 (19/11/2026)

Fatte tutte e due le proposte della sezione 10 della chat: indirizzo fisso (GitHub Pages da `docs/`) e sincronizzazione con Firebase. Restano all'utente: attivare Pages, creare il progetto Firebase e incollare la configurazione (passi nel `README.md`). Quando l'utente passa la configurazione, la si può scrivere in `FIREBASE_CONFIG` in `docs/index.html` per non doverla incollare su ogni dispositivo.

## Idee non fatte

- Unione a livello di singolo campo (oggi l'unione è per giorno: sulla stessa data vince il dispositivo).
- Funzionamento offline completo come app (service worker): oggi offline funziona se la pagina è già aperta o nella cache del browser.
- Arrotondamento mensile della maturazione come nei cedolini.
- Più di un festivo locale per datore.

## Come ripartire con un altro Claude

1. Collega questo repository alla sessione (contiene file, test e questo documento).
2. Chiedi le modifiche in italiano.
3. Chiedi di eseguire i test di `test/` prima di consegnare (328 sul registro, 55 sulla sincronizzazione).
