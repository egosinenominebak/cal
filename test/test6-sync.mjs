// Test della sincronizzazione online (v6) con un Firebase finto.
// Il finto SDK espone solo quello che il file usa (auth compat, firestore compat:
// onSnapshot, get, runTransaction, serverTimestamp). Il "server" è in Node ed è
// condiviso tra due dispositivi simulati (due contesti del browser).
// Uso: python3 costruisci-versione-di-test.py docs/index.html && node test6-sync.mjs
import { chromium } from 'playwright';
import fs from 'fs';

const HTML = fs.readFileSync('/tmp/pw/t5.html', 'utf8');
const ORIGIN = 'https://cal.test/';
const CONF = { apiKey: 'AIzaFinta', authDomain: 'prova.firebaseapp.com', projectId: 'prova-presenze', appId: '1:2:web:3' };
const SNIPPET = `// Import the functions you need from the SDKs you need
const firebaseConfig = {
  apiKey: "AIzaFinta",
  authDomain: "prova.firebaseapp.com",
  projectId: "prova-presenze",
  storageBucket: "prova-presenze.appspot.com",
  messagingSenderId: "123",
  appId: "1:2:web:3"
};`;

let pass = 0, fail = 0;
const ok = (c, msg, extra = '') => { if (c) { pass++; console.log('  ok  ', msg); } else { fail++; console.log('  FAIL', msg, extra); } };
const eq = (msg, got, want) => ok(JSON.stringify(got) === JSON.stringify(want), msg, `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(100); } return false; }

const FAKE_SDK = `
if (!window.firebase) (() => {
  const listeners = [];
  window.__fbPush = d => listeners.slice().forEach(f => f(d));
  const mkSnap = d => ({ exists: !!d, data: () => d ? { ...d, updatedAt: { toDate: () => new Date(d.updatedAtMs) } } : undefined, metadata: { hasPendingWrites: false } });
  let user = null; try { user = JSON.parse(localStorage.getItem('__fakeUser') || 'null'); } catch (e) {}
  const cbs = [];
  const fire = () => cbs.forEach(c => c(user));
  const auth = {
    onAuthStateChanged(cb) { cbs.push(cb); setTimeout(() => cb(user), 0); },
    async signInWithPopup() { user = await window.__fbLogin(); localStorage.setItem('__fakeUser', JSON.stringify(user)); fire(); return { user }; },
    async signOut() { user = null; localStorage.removeItem('__fakeUser'); fire(); }
  };
  const docRef = () => ({
    onSnapshot(okf) { const f = d => okf(mkSnap(d)); listeners.push(f); window.__fsGet().then(f); return () => listeners.splice(listeners.indexOf(f), 1); },
    async get() { if (window.__offline) throw Object.assign(new Error('off'), { code: 'unavailable' }); return mkSnap(await window.__fsGet()); }
  });
  const db = {
    collection: () => ({ doc: docRef }),
    async runTransaction(fn) {
      if (window.__offline) throw Object.assign(new Error('offline'), { code: 'unavailable' });
      const d = await window.__fsGet(); let w = null;
      await fn({ get: async () => mkSnap(d), set: (ref, v) => { w = v; } });
      if (w && !(await window.__fsCas(d ? d.rev : 0, w))) throw Object.assign(new Error('aborted'), { code: 'aborted' });
    }
  };
  const firestore = () => db; firestore.FieldValue = { serverTimestamp: () => '__ts' };
  const authFn = () => auth; authFn.GoogleAuthProvider = function () { this.setCustomParameters = () => {}; };
  window.firebase = { apps: [], initializeApp(c) { window.__fbConfig = c; this.apps.push(1); return {}; }, app() { return {}; }, auth: authFn, firestore };
})();`;

const server = { doc: null, writes: 0 };
const pages = new Set();
const browser = await chromium.launch();

async function device(name, { seed, conf = true, online = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'it-IT', timezoneId: 'Europe/Rome' });
  const errors = [], sdkLoads = [];
  await ctx.exposeFunction('__fsGet', () => server.doc);
  await ctx.exposeFunction('__fsCas', (rev, w) => {
    if ((server.doc ? server.doc.rev : 0) !== rev) return false;
    server.doc = { ...w, updatedAtMs: Date.now() }; server.writes++;
    for (const p of pages) p.evaluate(d => window.__fbPush && window.__fbPush(d), server.doc).catch(() => {});
    return true;
  });
  await ctx.exposeFunction('__fbLogin', () => ({ uid: 'utente-1', email: 'prova@example.com' }));
  await ctx.route('https://www.gstatic.com/**', r => { sdkLoads.push(r.request().url()); r.fulfill({ contentType: 'text/javascript', body: FAKE_SDK }); });
  await ctx.route(ORIGIN + '**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: HTML }));
  await ctx.addInitScript(([seed, conf]) => {
    if (localStorage.getItem('__seed')) return;
    if (seed) localStorage.setItem('presenze_tracker_v3', JSON.stringify(seed));
    if (conf) localStorage.setItem('presenze_sync_config', JSON.stringify(conf));
    localStorage.setItem('__seed', '1');
  }, [seed || null, conf ? CONF : null]);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/offline|aborted/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(ORIGIN);
  await page.waitForSelector('#daysGrid .day[data-key]');
  if (!online) await page.evaluate(() => { window.__offline = true; });
  pages.add(page);
  return { name, ctx, page, errors, sdkLoads };
}
const dbOf = page => page.evaluate(() => JSON.parse(localStorage.getItem('presenze_tracker_v3')));
const dayKeys = async page => { const s = await dbOf(page); if (!s) return []; return s.jobs.flatMap(j => Object.keys(j.days)).sort(); };
const syncSt = page => page.evaluate(() => JSON.parse(localStorage.getItem('presenze_sync_v1') || 'null'));
const saveState = page => page.textContent('#saveState');
const cloudKeys = () => server.doc ? JSON.parse(server.doc.data).jobs.flatMap(j => Object.keys(j.days)).sort() : [];
async function signIn(page) {
  await page.click('#syncLink');
  await page.getByRole('button', { name: 'Accedi con Google' }).click();
}
const mkCfg = () => ({ stdHours: 8, workdays: [true, true, true, true, true, false, false], smartWeekly: 0, smartDeadlines: ['05-31', '12-31'], patron: { month: 0, day: 1, name: '' }, closureDeduct: 'none',
  accrual: { ferie: { mode: 'fixed', per: 0, every: 173, unit: 'h' }, permessi: { mode: 'fixed', per: 0, every: 173, unit: 'h' }, exfest: { mode: 'fixed', per: 0, every: 173, unit: 'h' } } });
const seedA = { version: 3, jobs: [{ id: 'jA', name: 'Rossi Impianti', start: '2026-10-12', end: null, cfg: mkCfg(), days: {
  '2026-11-02': { presence: { status: 'work', hours: 8 }, absence: null, note: '' },
  '2026-11-03': { presence: null, absence: { status: 'malattia', hours: 8 }, note: 'febbre' } }, years: {}, snaps: {} }],
  activeJob: 'jA', lastJob: 'jA', settings: { theme: 'dark' }, meta: { lastBackup: null } };

console.log('# Senza configurazione: niente rete, configurazione da incollare');
{
  const d = await device('vuoto', { conf: false });
  const { page } = d;
  eq('riga di stato come prima', await saveState(page), 'Salvato automaticamente in questo browser');
  await page.click('#dataMenu > button'); await page.click('#dataMenu [data-act="sync"]');
  ok(await page.locator('#syncDlg').isVisible(), 'menu Dati apre "Sincronizzazione online"');
  ok(await page.locator('#syncCfgText').isVisible(), 'senza configurazione mostra il campo da incollare');
  await page.fill('#syncCfgText', 'ciao');
  await page.getByRole('button', { name: 'Salva configurazione' }).click();
  ok((await page.textContent('#syncErr')).includes('apiKey'), 'configurazione non valida: errore chiaro');
  await page.fill('#syncCfgText', SNIPPET);
  await page.getByRole('button', { name: 'Salva configurazione' }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('presenze_sync_config')));
  const sorted = o => Object.fromEntries(Object.entries(o).sort());
  eq('il blocco JavaScript della console Firebase viene letto', sorted(saved), sorted({ ...CONF, storageBucket: 'prova-presenze.appspot.com', messagingSenderId: '123' }));
  ok((await page.textContent('#syncInfo')).includes('prova-presenze'), 'dopo il salvataggio mostra il progetto');
  ok(await page.getByRole('button', { name: 'Accedi con Google' }).isVisible(), '...e il pulsante "Accedi con Google"');
  eq('nessuno script di Firebase scaricato finché non si accede', d.sdkLoads.length, 0);
  ok(d.errors.length === 0, 'nessun errore', d.errors.join('|'));
  pages.delete(page); await d.ctx.close();
}

console.log('# File aperto dal disco: accesso disattivato');
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(c => localStorage.setItem('presenze_sync_config', JSON.stringify(c)), CONF);
  await page.goto('file:///tmp/pw/t5.html');
  await page.click('#syncLink');
  ok(await page.getByRole('button', { name: 'Accedi con Google' }).isDisabled(), 'pulsante disattivato con file://');
  ok((await page.textContent('#syncInfo')).includes('indirizzo online'), 'spiega perché');
  await ctx.close();
}

console.log('# Primo dispositivo: carica i suoi dati online');
const A = await device('A', { seed: seedA });
{
  const { page } = A;
  await signIn(page);
  ok(await until(() => server.doc && server.doc.rev === 1), 'documento online creato (rev 1)');
  eq('online gli stessi giorni', cloudKeys(), ['2026-11-02', '2026-11-03']);
  ok(!JSON.parse(server.doc.data).settings && !JSON.parse(server.doc.data).meta, 'tema e data del backup non vanno online');
  ok(/Chrome su /.test(server.doc.by), 'salva il nome del dispositivo', server.doc.by);
  ok(await until(async () => (await saveState(page)).includes('sincronizzato online (prova@example.com)')), 'riga di stato: sincronizzato con l’account');
  ok((await page.textContent('#syncInfo')).includes('Collegata'), 'dialogo: collegata');
  await page.getByRole('button', { name: 'Chiudi' }).click();
  eq('3 script caricati da gstatic... (app, auth, firestore)', A.sdkLoads.length, 3);
}

console.log('# Secondo dispositivo, vuoto: scarica i dati');
const B = await device('B');
{
  const { page } = B;
  await signIn(page);
  ok(await until(async () => (await dayKeys(page)).length === 2), 'B riceve i 2 giorni di A');
  eq('B: tema suo (non quello di A)', (await dbOf(page)).settings.theme, 'auto');
  eq('B: datore di A', (await dbOf(page)).jobs.map(j => j.name), ['Rossi Impianti']);
  ok((await page.textContent('#toasts')).includes('Dati aggiornati dalla copia online'), 'B: avviso');
  eq('nessuna scrittura in più', server.doc.rev, 1);
  await page.keyboard.press('Escape');
}

console.log('# Modifica su A, arriva su B');
{
  await A.page.locator('.day[data-key="2026-11-04"]').click();
  ok(await until(() => server.doc.rev === 2), 'A salva online (rev 2)');
  ok(await until(async () => (await dayKeys(B.page)).includes('2026-11-04')), 'B vede il 4 novembre');
  ok(await B.page.locator('.day[data-key="2026-11-04"]').evaluate(e => e.className.includes('st-work') || e.textContent.includes('Lavoro')), 'B: la cella è aggiornata a schermo');
  const r = server.doc.rev;
  await A.page.click('#themeBtn');
  await wait(1500);
  eq('cambiare tema non scrive online', server.doc.rev, r);
  // più clic veloci: un solo salvataggio a fine raffica
  const w0 = server.writes;
  for (const k of ['2026-11-05', '2026-11-06', '2026-11-09']) await A.page.locator(`.day[data-key="${k}"]`).click();
  ok(await until(async () => (await dayKeys(B.page)).includes('2026-11-09')), 'raffica di 3 clic arriva su B');
  ok(server.writes - w0 <= 2, `raffica: ${server.writes - w0} scritture (non una per clic)`);
}

console.log('# Offline e conflitto: Unisci');
{
  await A.page.evaluate(() => { window.__offline = true; window.dispatchEvent(new Event('offline')); });
  await A.page.locator('.day[data-key="2026-11-10"]').click();
  ok(await until(async () => (await saveState(A.page)).includes('offline')), 'A offline: lo dice nella riga di stato');
  await B.page.locator('.day[data-key="2026-11-11"]').click();
  ok(await until(() => cloudKeys().includes('2026-11-11')), 'B intanto salva online l’11');
  ok(await until(() => A.page.locator('#choiceDlg').isVisible()), 'A: chiede quali dati tenere');
  ok((await A.page.textContent('#cText')).includes('Chrome su'), 'il dialogo dice da dove viene la versione online');
  await A.page.evaluate(() => { window.__offline = false; });
  await A.page.getByRole('button', { name: 'Unisci' }).click();
  ok(await until(() => cloudKeys().includes('2026-11-10') && cloudKeys().includes('2026-11-11')), 'online: 10 e 11 novembre');
  ok(await until(async () => { const k = await dayKeys(A.page); return k.includes('2026-11-10') && k.includes('2026-11-11'); }), 'A: tutti e due');
  ok(await until(async () => (await dayKeys(B.page)).includes('2026-11-10')), 'B: riceve il 10');
  ok(await until(async () => (await saveState(A.page)).includes('sincronizzato')), 'A di nuovo sincronizzato');
  ok(await A.page.locator('#undoBtn').isEnabled(), 'l’unione si può annullare');
}

console.log('# Conflitto sulla stessa data: "Usa i dati online"');
{
  await A.page.evaluate(() => { window.__offline = true; });
  await A.page.locator('.day[data-key="2026-11-12"]').click();                         // A: lavoro
  await B.page.locator('.day[data-key="2026-11-12"]').click();
  await B.page.locator('.day[data-key="2026-11-12"]').click();                         // B: smart
  ok(await until(() => { const d = JSON.parse(server.doc.data).jobs[0].days['2026-11-12']; return d && d.presence.status === 'smart'; }), 'online: smart (da B)');
  ok(await until(() => A.page.locator('#choiceDlg').isVisible()), 'A: dialogo');
  await A.page.evaluate(() => { window.__offline = false; });
  await A.page.getByRole('button', { name: 'Usa i dati online' }).click();
  ok(await until(async () => (await dbOf(A.page)).jobs[0].days['2026-11-12'].presence.status === 'smart'), 'A ora ha smart il 12');
}

console.log('# Riapertura: resta collegato, senza dialoghi');
{
  const rev = server.doc.rev;
  await A.page.reload();
  await A.page.waitForSelector('#daysGrid .day[data-key]');
  ok(await until(async () => (await saveState(A.page)).includes('sincronizzato')), 'A ricaricato: sincronizzato da solo');
  ok(!(await A.page.locator('#choiceDlg').isVisible()), 'nessun dialogo');
  eq('nessuna scrittura alla riapertura', server.doc.rev, rev);
}

console.log('# Esci');
{
  await A.page.click('#syncLink');
  await A.page.getByRole('button', { name: 'Esci' }).click();
  await A.page.locator('#choiceDlg').getByRole('button', { name: 'Esci' }).click();
  ok(await until(async () => (await saveState(A.page)) === 'Salvato automaticamente in questo browser'), 'dopo l’uscita: solo locale');
  const rev = server.doc.rev;
  await A.page.keyboard.press('Escape');
  await A.page.locator('.day[data-key="2026-11-13"]').click();
  await wait(1500);
  eq('le modifiche non vanno più online', server.doc.rev, rev);
  ok((await dayKeys(A.page)).includes('2026-11-13'), '...ma restano in locale');
  eq('stato salvato: disattivata', (await syncSt(A.page)).enabled, false);
}

console.log('# Primo collegamento con dati diversi su tutti e due i lati');
{
  const C = await device('C', { seed: { ...seedA, jobs: [{ ...seedA.jobs[0], id: 'jC', name: 'Bianchi Software', days: { '2026-11-16': { presence: { status: 'work', hours: 8 }, absence: null, note: '' } } }] } });
  await signIn(C.page);
  ok(await until(() => C.page.locator('#choiceDlg').isVisible()), 'C: chiede invece di sovrascrivere');
  const rev = server.doc.rev;
  await C.page.getByRole('button', { name: 'Unisci' }).click();
  ok(await until(() => server.doc.rev === rev + 1), 'C salva l’unione');
  eq('online due datori', JSON.parse(server.doc.data).jobs.map(j => j.name).sort(), ['Bianchi Software', 'Rossi Impianti']);
  ok(await until(async () => (await dbOf(B.page)).jobs.length === 2), 'B riceve il secondo datore');
  ok(C.errors.length === 0, 'C: nessun errore', C.errors.join('|'));
  await C.ctx.close(); pages.delete(C.page);
}

ok(A.errors.length === 0, 'A: nessun errore', A.errors.join('|'));
ok(B.errors.length === 0, 'B: nessun errore', B.errors.join('|'));
await browser.close();
console.log(`\nRisultato: ${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
