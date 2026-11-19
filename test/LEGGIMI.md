# Test automatici nel browser

Se Playwright è già installato altrove (per esempio in `/opt/node-tools`), basta collegarlo: `mkdir -p /tmp/pw/node_modules && ln -s /opt/node-tools/node_modules/playwright* /tmp/pw/node_modules/`.

328 controlli sul registro (dalla v6 è `docs/index.html`; i test sono nati sulla v5 e passano identici), eseguiti con Playwright (Chromium senza finestra). Coprono: giorni con presenza e assenza, ciclo e timbri, trascinamento e Maiusc+clic, annulla e ripeti, dialogo dei dettagli, chiusura aziendale, ROL ed ex festività, maturazione a ore, smart working settimanale con scadenze, più datori di lavoro, vista somma, import ed export (CSV e JSON), migrazione dalle versioni 1 e 2, tastiera, tocco, stampa in chiaro.

Dalla v5 ci sono anche 55 controlli sull'export PDF del mese e dell'anno: struttura del file (intestazione, tabella xref, lunghezza degli stream), formato A4 verticale e orizzontale, nomi dei file, testi (stati, ore, festività, note complete, saldi, riepiloghi), accenti e caratteri speciali, colori sempre del tema chiaro, più pagine con molte note, vista somma, misure dei caratteri e a capo.

I test sono scritti per Linux (o WSL) e usano la cartella `/tmp/pw`.

```bash
mkdir -p /tmp/pw && cd /tmp/pw
npm init -y && npm i playwright && npx playwright install chromium
cp /percorso/di/questa/cartella/test5.mjs /tmp/pw/
python3 /percorso/di/questa/cartella/costruisci-versione-di-test.py /percorso/docs/index.html
node /tmp/pw/test5.mjs
cp /percorso/di/questa/cartella/test6-sync.mjs /tmp/pw/ && node /tmp/pw/test6-sync.mjs
```

Se Chromium dice che manca una libreria di sistema (nella VM di lavoro mancava `libXdamage.so.1`), installala con il gestore pacchetti, oppure scarica il .deb con `apt-get download` e imposta `LD_LIBRARY_PATH`.

## Sincronizzazione online (v6)

`test6-sync.mjs`: 55 controlli con un Firebase finto (servito al posto degli script di gstatic.com) e un "server" condiviso tra due o tre dispositivi simulati. Coprono: configurazione incollata (JSON o blocco JavaScript), nessuno script scaricato finché non si accede, accesso disattivato da `file://`, primo caricamento online, secondo dispositivo che scarica, modifiche che arrivano sull'altro, raffiche di clic, tema e datore mostrato che restano locali, offline, conflitti (Unisci, Usa i dati online), riapertura senza dialoghi, uscita, primo collegamento con dati diversi da entrambe le parti.

Firebase vero (accesso con Google, regole, rete reale) non è coperto: va provato a mano dopo aver creato il progetto.

Il test dei colori è a parte: `node contrasti.mjs /percorso/docs/index.html`.

Per guardare i PDF come immagini, con Poppler installato: `pdftoppm -r 80 -png file.pdf pagina`.
