# Registro presenze & ferie

Un registro in italiano, in un solo file HTML, per segnare giorno per giorno lavoro, smart working, ferie, permessi (ROL ed ex festività), malattia e chiusure, per uno o più datori di lavoro, con saldi, maturazioni ed export (CSV, JSON, PDF).

**Versione attuale: 6.** È `docs/index.html`. Rispetto alla v5 aggiunge:

- **indirizzo fisso** con GitHub Pages: le versioni nuove si pubblicano allo stesso link, quindi i dati restano e non serve più ripristinare un backup a ogni versione;
- **sincronizzazione online facoltativa** con Firebase (piano gratuito Spark): accedi con Google e gli stessi dati compaiono su PC e telefono, salvati in automatico;
- icona e manifest per **aggiungerlo alla schermata Home** del telefono come un'app.

Senza sincronizzazione il registro funziona esattamente come la v5: dati solo nel browser, nessuna connessione.

## Struttura

| Percorso | Cosa contiene |
|---|---|
| `docs/` | Il sito pubblicato: `index.html` (la v6), icone e manifest. |
| `firebase/firestore.rules` | Regole di sicurezza da incollare in Firestore. |
| `versioni/` | Lo storico: `calendar_v1.html` … `calendar_v5.html`. Non pubblicate, per non mischiarne i dati con la v6. |
| `esempi/` | CSV, JSON e PDF di esempio con dati inventati. |
| `test/` | Test automatici nel browser (`LEGGIMI.md`). |
| `HANDOFF.md` | Passaggio di consegne: regole decise, formato dei dati, cosa non è verificato. |

## 1. Pubblicare il sito (GitHub Pages, una volta sola)

1. Porta il lavoro sul ramo `main` (unisci il ramo della v6).
2. Nel repository: **Settings → Pages**.
3. In **Build and deployment**, Source: **Deploy from a branch**. Branch: **main**, cartella **/docs**. **Save**.
4. Dopo un paio di minuti il registro è su `https://<tuo-utente>.github.io/cal/`.

Il repository può essere pubblico: il file non contiene dati. Chi apre il link vede un calendario vuoto.

**Spostare i dati la prima volta:** l'indirizzo nuovo ha una memoria vuota. Nella versione che usi adesso: menu Dati, "Salva backup completo (JSON)". Poi apri il link nuovo, menu Dati, "Ripristina da file JSON…", **Sostituisci**. Da qui in poi le versioni nuove arrivano allo stesso link, con i dati già dentro.

## 2. Sincronizzazione tra dispositivi (Firebase, facoltativa, circa 10 minuti)

Gratis con il piano Spark: non chiede la carta di credito; se superassi i limiti (50.000 letture e 20.000 scritture al giorno) il servizio si ferma fino al giorno dopo, senza addebiti.

1. Vai su [console.firebase.google.com](https://console.firebase.google.com) con il tuo account Google e **crea un progetto** (per esempio `registro-presenze`). Google Analytics non serve: puoi disattivarlo.
2. **Authentication** → Inizia → **Metodo di accesso** → **Google** → Attiva, scegli l'email di supporto → Salva.
3. **Authentication** → **Impostazioni** → **Domini autorizzati** → Aggiungi dominio: `<tuo-utente>.github.io`.
4. **Firestore Database** → Crea database → posizione in Europa (per esempio `eur3`) → modalità **produzione**. Poi la scheda **Regole**: sostituisci tutto con il contenuto di `firebase/firestore.rules` e premi **Pubblica**.
5. **Impostazioni progetto** (ingranaggio) → **Le tue app** → icona web `</>` → un nome qualsiasi, senza Firebase Hosting → Registra. Copia il blocco `const firebaseConfig = { … }`.
6. Apri il registro dal link di GitHub Pages → "Sincronizzazione online" (sotto il titolo, o menu Dati) → incolla il blocco → **Salva configurazione** → **Accedi con Google**.
7. Sugli altri dispositivi: stesso link, stesso passo 6, stesso account Google.

La configurazione non è segreta (la protezione la fanno le regole del passo 4). Se vuoi non incollarla su ogni dispositivo, si può scrivere una volta nel file (`FIREBASE_CONFIG` in `docs/index.html`).

**Solo il tuo account, se vuoi:** con le regole fornite chiunque acceda dal tuo link con il proprio Google si crea un documento suo, separato e illeggibile per gli altri. Per chiudere il progetto ai soli account che decidi tu, aggiungi alla riga `allow create, update` e `allow read` la condizione `&& request.auth.token.email in ['tuo.indirizzo@gmail.com']`.

### Come funziona

- La copia principale resta nel browser: senza rete il registro funziona e sincronizza quando la rete torna.
- Ogni modifica va online circa un secondo dopo l'ultima (una raffica di clic diventa un solo salvataggio) e compare sugli altri dispositivi aperti.
- Tema, datore mostrato e data dell'ultimo backup restano di ciascun dispositivo.
- Se due dispositivi hanno cambiato i dati senza vedersi (per esempio uno era offline), il registro non sovrascrive niente: chiede se **unire** (dove la stessa data è diversa vince il dispositivo che chiede), **usare i dati online** o **usare questo dispositivo**.
- L'accesso funziona solo dall'indirizzo `https://`, non da un file aperto dal disco.
- I dati (malattia compresa) stanno su Firestore di Google, leggibili solo dal tuo account. Il backup JSON resta nel menu Dati.

## Versioni

| Versione | File | Novità |
|---|---|---|
| 1 | `versioni/calendar_v1.html` | Il file di partenza. |
| 2 | `versioni/calendar_v2.html` | Riscrittura: festivi, quote per anno, intervalli, annulla, export. |
| 3 | `versioni/calendar_v3.html` | Più datori, presenza e assenza nello stesso giorno, chiusura aziendale, maturazione a ore, vista somma. |
| 4 | `versioni/calendar_v4.html` | ROL ed ex festività separati, smart working settimanale, patrono per datore, stampa in chiaro. |
| 5 | `versioni/calendar_v5.html` | Export PDF del mese e dell'anno. |
| 6 | `docs/index.html` | Indirizzo fisso, sincronizzazione online facoltativa, icona per la schermata Home. |
