import { chromium } from 'playwright';
import fs from 'fs';
const FILE = 'file:///tmp/pw/t5.html';
let pass = 0, fail = 0;
const ok = (c, msg, extra = '') => { if (c) { pass++; console.log('  ok  ', msg); } else { fail++; console.log('  FAIL', msg, extra); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const eq = (msg, got, want) => ok(same(got, want), msg, `\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);

const browser = await chromium.launch();
const mkCfg = (o = {}) => ({ stdHours: 8, workdays: [true, true, true, true, true, false, false], smartWeekly: 0, smartDeadlines: ['05-31', '12-31'], patron: { month: 0, day: 1, name: '' }, closureDeduct: 'none',
  accrual: { ferie: { mode: 'fixed', per: 0, every: 173, unit: 'h' }, permessi: { mode: 'fixed', per: 0, every: 173, unit: 'h' }, exfest: { mode: 'fixed', per: 0, every: 173, unit: 'h' } }, ...o });
const mkJob = (id, name, o = {}) => ({ id, name, start: null, end: null, cfg: mkCfg(o.cfg), days: o.days || {}, years: o.years || {}, snaps: {} , ...(o.start !== undefined ? { start: o.start } : {}), ...(o.end !== undefined ? { end: o.end } : {}) });
const mkDb = (jobs, activeJob) => ({ version: 3, jobs, activeJob: activeJob || jobs[0].id, lastJob: jobs[0].id, settings: { theme: 'auto' }, meta: { lastBackup: null } });
const P = (st, h) => ({ status: st, hours: h });

async function fresh({ time = '2026-11-18T10:00:00', seed, viewport = { width: 1280, height: 1000 }, rawSeed } = {}) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, locale: 'it-IT', timezoneId: 'Europe/Rome' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.clock.install({ time: new Date(time) });
  if (seed || rawSeed) {
    await page.addInitScript(`if(!localStorage.getItem('__seed')){ ${seed ? `localStorage.setItem('presenze_tracker_v3', ${JSON.stringify(JSON.stringify(seed))});` : ''} ${rawSeed ? Object.entries(rawSeed).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('') : ''} localStorage.setItem('__seed','1'); }`);
  }
  await page.goto(FILE);
  await page.waitForSelector('#daysGrid .day[data-key]');
  return { ctx, page, errors };
}
const dbOf = page => page.evaluate(() => JSON.parse(localStorage.getItem('presenze_tracker_v3') || JSON.stringify(window.__presenze.store)));
const days = page => page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('presenze_tracker_v3') || JSON.stringify(window.__presenze.store));
  const j = s.jobs.find(j => j.id === (s.activeJob === '__all__' ? s.lastJob : s.activeJob));
  const out = {};
  for (const [k, e] of Object.entries(j.days)) { const pr = e.absence || e.presence; out[k] = { status: pr.status, hours: pr.hours, note: e.note, presence: e.presence, absence: e.absence }; }
  return out;
});
const cell = (page, k) => page.locator(`.day[data-key="${k}"]`);
const toastText = page => page.textContent('#toasts');
const menu = async (page, id, act) => { await page.click(`#${id} > button`); return page.click(`[data-act="${act}"]`); };

console.log('# Caricamento, rapporto di default e giorni fuori rapporto');
{
  const { ctx, page, errors } = await fresh();
  ok(errors.length === 0, 'nessun errore al primo caricamento', errors.join('|'));
  eq('titolo', (await page.textContent('#monthTitle')).toLowerCase(), 'novembre 2026');
  const opt = await page.evaluate(() => [...document.querySelectorAll('#jobSel option')].map(o => o.textContent));
  eq('datore di default con inizio 12/10/2026 (e niente voce "somma" con un solo datore)', opt, ['Datore di lavoro (dal 12/10/2026, in corso)']);
  const hol = await page.evaluate(() => { const h = window.__presenze.holidays; return { 2026: [...h(2026).entries()].map(([k, v]) => k + ' ' + v), 2027: [...h(2027).entries()].map(([k, v]) => k + ' ' + v) }; });
  ok(hol[2026].includes('04-05 Pasqua') && hol[2026].includes('04-06 Lunedì dell’Angelo') && hol[2026].length === 12, 'festività 2026 (12, con Pasqua 5/4)');
  ok(hol[2027].includes('03-28 Pasqua') && hol[2027].includes('03-29 Lunedì dell’Angelo'), 'Pasqua 2027 = 28 marzo');
  for (let i = 0; i < 1; i++) await page.click('#prevBtn');       // ottobre
  eq('ottobre: 11 giorni fuori rapporto (1-11)', await page.locator('.day.out').count(), 11);
  ok(!(await cell(page, '2026-10-12').getAttribute('class')).includes('out'), '12 ottobre è il primo giorno del rapporto');
  ok(await page.locator('#jobNote').isVisible() && (await page.textContent('#jobNote')).includes('Prima del 12/10/2026'), 'avviso sui giorni precedenti');
  await cell(page, '2026-10-06').click();
  ok((await toastText(page)).includes('inizia il 12/10/2026'), 'clic fuori rapporto: messaggio chiaro');
  eq('...e nessun dato scritto', Object.keys(await days(page)).length, 0);
  eq('cartellino 2026: 284 giorni fuori rapporto', await page.locator('.ym-d.out').count(), 284);
  eq('"da compilare" solo dopo l\'assunzione (15 giorni), mai prima', await page.locator('.day.gap').count(), 15);
  eq('...e nessuno nei giorni 1-11', await page.locator('.day.out.gap').count(), 0);
  await menu(page, 'fillMenu', 'fill-work');
  const d = await days(page);
  eq('compila ottobre: 15 giorni lavorativi dal 12 in poi', Object.keys(d).length, 15);
  ok(!d['2026-10-09'] && d['2026-10-12'], 'niente prima del 12 ottobre');
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}

console.log('# Cambio mese dal 31');
{
  const { ctx, page, errors } = await fresh({ time: '2027-01-31T10:00:00' });
  await page.click('#nextBtn');
  eq('31 gen + mese = febbraio', (await page.textContent('#monthTitle')).toLowerCase(), 'febbraio 2027');
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}

console.log('# Ciclo a 8 stati, timbri e giorni non lavorativi');
{
  const { ctx, page, errors } = await fresh();
  const seq = [];
  for (let i = 0; i < 9; i++) {
    await cell(page, '2026-11-03').click();
    const e = (await days(page))['2026-11-03'];
    seq.push(e ? `${e.presence ? e.presence.status + e.presence.hours : '-'}/${e.absence ? e.absence.status + e.absence.hours : '-'}` : 'vuoto');
  }
  eq('sequenza del ciclo', seq, ['work8/-', 'smart8/-', '-/ferie8', 'work6/permesso2', 'work6/exfest2', '-/malattia8', '-/chiusura8', '-/festivo0', 'vuoto']);
  await cell(page, '2026-11-07').click(); await cell(page, '2026-11-07').click();
  eq('sabato: Lavoro poi Smart', (await days(page))['2026-11-07'].presence.status, 'smart');
  await cell(page, '2026-11-07').click();
  ok(!(await days(page))['2026-11-07'], 'sabato: terzo clic svuota');

  await page.keyboard.press('3');
  eq('tasto 3 = Ferie', await page.getAttribute('.stamp[data-brush="ferie"]', 'aria-pressed'), 'true');
  await page.keyboard.press('5');
  eq('tasto 5 = Permesso ex festività', await page.getAttribute('.stamp[data-brush="exfest"]', 'aria-pressed'), 'true');
  await page.keyboard.press('7');
  eq('tasto 7 = Chiusura aziendale', await page.getAttribute('.stamp[data-brush="chiusura"]', 'aria-pressed'), 'true');
  await page.keyboard.press('8');
  eq('tasto 8 = Festivo', await page.getAttribute('.stamp[data-brush="festivo"]', 'aria-pressed'), 'true');
  await page.keyboard.press('3');
  await cell(page, '2026-11-07').click();
  ok(!(await days(page))['2026-11-07'] && (await toastText(page)).includes('non è un giorno lavorativo'), 'ferie di sabato rifiutate con spiegazione');
  await cell(page, '2026-11-09').click();
  eq('ferie di lunedì', (await days(page))['2026-11-09'].absence.status, 'ferie');
  await cell(page, '2026-11-09').click();
  ok(!(await days(page))['2026-11-09'], 'secondo clic toglie');

  // giorno con presenza + assenza
  await page.keyboard.press('1'); await cell(page, '2026-11-12').click();
  await page.keyboard.press('4'); await cell(page, '2026-11-12').click();
  let e = (await days(page))['2026-11-12'];
  ok(e.presence.hours === 6 && e.absence.status === 'permesso' && e.absence.hours === 2, 'Lavoro 8h + Permesso → Lavoro 6h + Permesso 2h');
  ok((await cell(page, '2026-11-12').getAttribute('class')).includes('mixed'), 'cella con due stati');
  const txt = await cell(page, '2026-11-12').innerText();
  ok(txt.includes('Lavoro 6h') && txt.includes('ROL 2h'), 'la cella mostra entrambe le parti', txt.replace(/\n/g, ' | '));
  await cell(page, '2026-11-12').click();
  e = (await days(page))['2026-11-12'];
  ok(e.presence.hours === 8 && !e.absence, 'togliendo il permesso tornano le 8 ore di lavoro');
  await page.keyboard.press('3'); await cell(page, '2026-11-12').click();
  e = (await days(page))['2026-11-12'];
  ok(!e.presence && e.absence.status === 'ferie' && e.absence.hours === 8, 'Ferie su un giorno di lavoro pieno lo sostituisce');

  await page.click('#nextBtn');
  const cls = await cell(page, '2026-12-08').getAttribute('class');
  ok(cls.includes('st-festivo') && (await cell(page, '2026-12-08').innerText()).includes('Immacolata'), '8 dicembre festivo automatico');
  await cell(page, '2026-12-08').click();
  ok(!(await days(page))['2026-12-08'], 'ferie su festivo non applicate');
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}

console.log('# Trascinamento, Maiusc+clic, statistiche, annulla');
{
  const { ctx, page, errors } = await fresh();
  await page.keyboard.press('3');
  const box = async k => { const b = await cell(page, k).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const a = await box('2026-11-09'), b = await box('2026-11-13');
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
  let d = await days(page);
  eq('trascinamento: 5 giorni di ferie', Object.keys(d).filter(k => d[k].absence && d[k].absence.status === 'ferie').sort(), ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
  await cell(page, '2026-11-16').click();
  await page.keyboard.down('Shift'); await cell(page, '2026-11-22').click(); await page.keyboard.up('Shift');
  d = await days(page);
  eq('Maiusc+clic 16→22: 10 giorni di ferie in tutto (weekend saltato)', Object.keys(d).length, 10);
  const st = await page.evaluate(() => window.__presenze.periodStats(2026, null));
  ok(st.ferieDone === 8 && st.feriePlanned === 2, 'ferie godute 8, pianificate 2', JSON.stringify([st.ferieDone, st.feriePlanned]));
  ok(/16\s*gg residui/.test(await page.textContent('#balances')), 'residuo 26 - 10 = 16');
  await page.keyboard.press('Control+z');
  eq('Ctrl+Z annulla l\'intero intervallo (4 giorni)', Object.keys(await days(page)).length, 6);
  await page.keyboard.press('Control+Shift+z');
  eq('Ctrl+Maiusc+Z ripete', Object.keys(await days(page)).length, 10);
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}

console.log('# Dettagli del giorno: presenza e assenza insieme');
{
  const { ctx, page, errors } = await fresh();
  await cell(page, '2026-11-10').click({ button: 'right' });
  ok(await page.locator('#dayDlg').evaluate(d => d.open), 'tasto destro apre i dettagli');
  ok((await page.textContent('#dTitle')).includes('Martedì 10 novembre 2026') && (await page.textContent('#dSub')).includes('Datore di lavoro: Datore di lavoro'), 'titolo e datore');
  await page.selectOption('#dAbs', 'permesso');
  eq('permesso: ore 2', await page.inputValue('#dAbsH'), '2');
  eq('...e lavoro 6 in automatico', [await page.inputValue('#dPres'), await page.inputValue('#dPresH')], ['work', '6']);
  await page.selectOption('#dAbs', 'ferie');
  eq('ferie: ore 8 e presenza tolta (giornata piena)', [await page.inputValue('#dAbsH'), await page.inputValue('#dPres')], ['8', '']);
  await page.fill('#dAbsH', '4');
  eq('ferie 4h → lavoro 4h in automatico', [await page.inputValue('#dPres'), await page.inputValue('#dPresH')], ['work', '4']);
  await page.fill('#dNote', 'Mezza giornata "speciale"');
  await page.click('#dayForm button[type=submit]');
  let e = (await days(page))['2026-11-10'];
  ok(e.presence.hours === 4 && e.absence.status === 'ferie' && e.absence.hours === 4 && e.note.includes('speciale'), 'salvato: Lavoro 4h + Ferie 4h');
  const st = await page.evaluate(() => window.__presenze.periodStats(2026, null));
  ok(st.days.work === 0.5 && st.days.ferie === 0.5 && st.worked === 4, 'statistiche: 0,5 lavoro + 0,5 ferie, 4 ore lavorate', JSON.stringify([st.days.work, st.days.ferie, st.worked]));
  ok((await cell(page, '2026-11-10').getAttribute('title')).includes('"speciale"'), 'nota con virgolette nel title');
  ok((await cell(page, '2026-11-10').getAttribute('aria-label')).includes('Lavoro, 4 ore e Ferie, 4 ore'), 'aria-label con entrambe le parti', await cell(page, '2026-11-10').getAttribute('aria-label'));

  await cell(page, '2026-11-11').click({ button: 'right' });
  await page.selectOption('#dAbs', 'festivo');
  ok((await page.inputValue('#dPres')) === '' && await page.locator('#dAbsH').isDisabled(), 'festivo: niente presenza, ore bloccate');
  await page.selectOption('#dPres', 'work');
  eq('scegliere una presenza toglie il festivo', await page.inputValue('#dAbs'), '');
  await page.selectOption('#dPres', '');
  await page.click('#dayForm button[type=submit]');
  ok(await page.locator('#dErr').isVisible(), 'nessuno stato scelto: errore');
  await page.selectOption('#dPres', 'work');
  await page.fill('#dPresH', '30');
  await page.click('#dayForm button[type=submit]');
  ok((await page.textContent('#dErr')).includes('tra 0 e 24'), 'ore fuori scala: errore');
  await page.fill('#dPresH', '8');
  await page.selectOption('#dAbs', 'ferie'); await page.fill('#dAbsH', '20');
  await page.click('#dayForm button[type=submit]');
  ok((await page.textContent('#dErr')).includes('24 ore'), 'somma oltre 24 ore: errore');
  await page.keyboard.press('Escape');

  await page.click('#nextBtn');
  await cell(page, '2026-12-14').click({ button: 'right' });
  await page.selectOption('#dAbs', 'ferie');
  await page.fill('#dUntil', '2026-12-31');
  await page.click('#dayForm button[type=submit]');
  const dec = Object.keys(await days(page)).filter(k => k.startsWith('2026-12'));
  eq('intervallo 14→31 dic: 13 giorni (salta weekend, Natale, S. Stefano)', dec.length, 13);
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}

console.log('# Chiusura aziendale e come scala dai saldi');
{
  const { ctx, page, errors } = await fresh();
  await page.click('#nextBtn');                                        // dicembre
  await page.keyboard.press('7');
  await cell(page, '2026-12-24').click();
  let e = (await days(page))['2026-12-24'];
  ok(e.absence.status === 'chiusura' && e.absence.hours === 8 && !e.presence, 'chiusura aziendale applicata');
  ok((await cell(page, '2026-12-24').getAttribute('class')).includes('st-chiusura'), 'colore dedicato');
  let st = await page.evaluate(() => window.__presenze.periodStats(2026, null));
  ok(st.days.chiusura === 1 && st.feriePlanned === 0 && st.permPlanned === 0, 'predefinito: la chiusura non scala nulla', JSON.stringify(st));
  ok((await page.textContent('#monthStats')).includes('Chiusura aziendale'), 'riga "Chiusura aziendale" nel riepilogo');
  const setClosure = async v => { await page.click('#settingsBtn'); await page.selectOption('#sClosure', v); await page.click('#setForm button[type=submit]'); };
  await setClosure('ferie');
  st = await page.evaluate(() => window.__presenze.periodStats(2026, null));
  ok(st.feriePlanned === 1 && st.closureFerie === 1, 'scala dalle ferie: 1 giorno pianificato', JSON.stringify([st.feriePlanned, st.closureFerie]));
  ok((await page.textContent('#balances')).includes('Include 1 gg di chiusura aziendale'), 'nota nei saldi');
  ok(/25\s*gg residui/.test(await page.textContent('#balances')), 'residuo ferie 26 - 1 = 25');
  await setClosure('rol');
  st = await page.evaluate(() => window.__presenze.periodStats(2026, null));
  ok(st.permPlanned === 8 && st.feriePlanned === 0, 'scala dai permessi/ROL: 8 ore', JSON.stringify([st.permPlanned, st.feriePlanned]));
  ok(/24\s*h residui/.test(await page.textContent('#balances')), 'residuo ROL 32 - 8 = 24');
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}

console.log('# Maturazione dei permessi con le ore svolte');
{
  const { ctx, page, errors } = await fresh();
  const acc0 = (await page.textContent('#accrual')).replace(/\s+/g, ' ');
  ok(await page.locator('#accrual').isVisible() && acc0.includes('Ore lavorate a oggi') && acc0.includes('Imposta la maturazione'), 'riquadro sempre visibile, con il pulsante per impostare la maturazione', acc0);
  await page.click('[data-act="setup-accrual"]');
  eq('si apre sulle impostazioni con "a ore" già scelto', await page.inputValue('#sPerMode'), 'worked');
  eq('...e il cursore sul campo giusto', await page.evaluate(() => document.activeElement.id), 'sPerPer');
  await page.click('#setForm button[type=submit]');
  ok(await page.locator('#sErr').isVisible(), 'maturazione a ore senza valori: errore');
  ok(/permessi/.test(await page.textContent('#sErr')), 'messaggio chiaro');
  await page.fill('#sPerPer', '8'); await page.fill('#sPerEvery', '173');
  await page.click('#setForm button[type=submit]');
  ok(!(await page.locator('#setDlg').evaluate(d => d.open)), 'impostazioni salvate');
  ok(await page.locator('#accrual').isVisible(), 'riquadro Maturazione visibile');
  await menu(page, 'fillMenu', 'fill-work');                          // novembre: 21 giorni, 13 fino a oggi (18/11) = 104 ore
  let t = (await page.textContent('#accrual')).replace(/\s+/g, ' ');
  ok(/Ore lavorate a oggi\s*104 h/.test(t) && /Permessi ROL maturati\s*4,81 h/.test(t), '104 ore lavorate → 4,81 h maturate (8 ogni 173)', t);
  ok(/4,81\s*h residui/.test(await page.textContent('#balances')), 'saldo = maturato');
  ok(await page.locator('#qPerm').isDisabled(), 'monte fisso bloccato in modalità "a ore"');
  await page.click('[data-act="update-accrual"]');
  ok((await toastText(page)).includes('Permessi ROL maturati: 4,81 h su 104 h lavorate'), 'toast con il maturato', await toastText(page));
  let db = await dbOf(page);
  ok(Math.abs(db.jobs[0].snaps['2026'].permessi - 104 * 8 / 173) < 1e-9, 'snapshot salvato');
  await page.click('#prevBtn');                                       // ottobre: +120 ore
  await menu(page, 'fillMenu', 'fill-work');
  await page.click('#nextBtn');
  await page.click('[data-act="update-accrual"]');
  ok((await toastText(page)).includes('(+5,55 h dal 18/11/2026)'), 'secondo aggiornamento mostra la differenza', await toastText(page));
  ok(/10,36\s*h residui/.test(await page.textContent('#balances')), '224 ore → 10,36 h');
  await page.keyboard.press('Control+z');                             // annulla l'aggiornamento
  db = await dbOf(page);
  ok(Math.abs(db.jobs[0].snaps['2026'].permessi - 104 * 8 / 173) < 1e-9, 'aggiornamento annullabile');
  // ferie a ore
  await page.click('#settingsBtn');
  await page.selectOption('#sFerMode', 'worked'); await page.fill('#sFerPer', '8'); await page.fill('#sFerEvery', '173');
  await page.click('#setForm button[type=submit]');
  ok(/Ferie maturate\s*1,29 gg \(10,36 h\)/.test(await page.textContent('#accrual')), 'ferie maturate: 224 ore × 8/173 = 10,36 h = 1,29 gg', await page.textContent('#accrual'));
  eq('con entrambe attive il pulsante è generico', (await page.textContent('[data-act="update-accrual"]')).trim(), 'Aggiorna maturazione');
  await page.click('#settingsBtn'); await page.selectOption('#sFerMode', 'fixed'); await page.click('#setForm button[type=submit]');
  eq('solo permessi ROL: il pulsante lo dice', (await page.textContent('[data-act="update-accrual"]')).trim(), 'Aggiorna permessi ROL maturati');
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}

console.log('# Più datori di lavoro, storico e vista somma');
{
  const { ctx, page, errors } = await fresh();
  await cell(page, '2026-11-09').click(); await page.keyboard.press('3');   // (ciclo) lavoro il 9; poi timbro ferie
  await cell(page, '2026-11-09').click();                                    // ferie il 9
  await page.keyboard.press('1'); await cell(page, '2026-11-10').click();   // lavoro il 10
  await page.click('#jobsBtn');
  eq('rapporti: un blocco con il nome', await page.inputValue('#jobsList .jobbox >> nth=0 >> [data-f="name"]'), 'Datore di lavoro');
  eq('...e inizio 2026-10-12', await page.inputValue('#jobsList .jobbox >> nth=0 >> [data-f="start"]'), '2026-10-12');
  ok(await page.locator('#jobsList .jobbox >> nth=0 >> [data-f="ongoing"]').isChecked() && await page.locator('#jobsList .jobbox >> nth=0 >> [data-f="end"]').isDisabled(), 'rapporto senza fine: casella "In corso" spuntata e data bloccata');
  await page.uncheck('#jobsList .jobbox >> nth=0 >> [data-f="ongoing"]');
  await page.click('#jobsForm button[type=submit]');
  ok((await page.textContent('#jErr')).includes('indica la data di fine'), 'senza "in corso" e senza data: errore');
  await page.fill('#jobsList .jobbox >> nth=0 >> [data-f="end"]', '2026-11-30');
  await page.click('#jobAdd');
  eq('nuovo rapporto parte il giorno dopo la fine del precedente', await page.inputValue('#jobsList .jobbox >> nth=1 >> [data-f="start"]'), '2026-12-01');
  await page.fill('#jobsList .jobbox >> nth=1 >> [data-f="name"]', 'Beta Srl');
  await page.fill('#jobsList .jobbox >> nth=0 >> [data-f="end"]', '2026-12-01');           // inizio dopo fine? no: fine 1/12, inizio 2° = 1/12 → valido
  await page.fill('#jobsList .jobbox >> nth=0 >> [data-f="start"]', '2026-12-05');
  await page.click('#jobsForm button[type=submit]');
  ok((await page.textContent('#jErr')).includes('prima dell’inizio'), 'fine prima dell\'inizio: errore');
  await page.fill('#jobsList .jobbox >> nth=0 >> [data-f="start"]', '2026-10-12');
  await page.fill('#jobsList .jobbox >> nth=0 >> [data-f="end"]', '2026-11-30');
  eq('il nuovo rapporto nasce "in corso"', await page.locator('#jobsList .jobbox >> nth=1 >> [data-f="ongoing"]').isChecked(), true);
  await page.click('#jobsForm button[type=submit]');
  ok(!(await page.locator('#jobsDlg').evaluate(d => d.open)), 'rapporti salvati');
  const opt = await page.evaluate(() => [...document.querySelectorAll('#jobSel option')].map(o => o.textContent));
  eq('menu datori', opt, ['Datore di lavoro (dal 12/10/2026 al 30/11/2026)', 'Beta Srl (dal 01/12/2026, in corso)', 'Tutti i datori di lavoro (somma)']);

  await page.selectOption('#jobSel', await page.evaluate(() => window.__presenze.store.jobs[1].id));
  eq('passando a Beta il calendario salta a dicembre', (await page.textContent('#monthTitle')).toLowerCase(), 'dicembre 2026');
  eq('...e i giorni di Beta sono vuoti', Object.keys(await days(page)).length, 0);
  await page.keyboard.press('1'); await cell(page, '2026-12-02').click();
  await page.keyboard.press('2'); await cell(page, '2026-12-03').click();
  await page.click('#prevBtn');
  eq('novembre per Beta: tutto fuori rapporto', await page.locator('.day.out').count(), 30);
  await cell(page, '2026-11-20').click();
  ok((await toastText(page)).includes('inizia il 01/12/2026'), 'messaggio per Beta');
  ok(!(await days(page))['2026-11-20'], 'niente scritto');

  await page.selectOption('#jobSel', '__all__');
  ok(await page.locator('#viewNote').isVisible() && await page.locator('#trayWrap').isHidden(), 'vista somma: nota e timbri nascosti');
  ok(await page.locator('#histSec').isVisible(), 'storico complessivo visibile');
  const sums = await page.evaluate(() => { const s = window.__presenze.allStats(2026, null); return { work: s.days.work, smart: s.days.smart, ferie: s.days.ferie, worked: s.worked }; });
  eq('somma 2026 (lavoro, smart, ferie, ore)', sums, { work: 2, smart: 1, ferie: 1, worked: 24 });
  const ms = (await page.textContent('#monthStats')).replace(/\s+/g, ' ');
  ok(ms.includes('Ferie 1 gg') && ms.includes('Lavoro 1 gg'), 'riepilogo del mese somma (novembre: 1 lavoro, 1 ferie)', ms);
  ok(/51\s*gg residui/.test(await page.textContent('#balances')), 'saldi sommati: 26 + 26 - 1 = 51 gg');
  const hist = (await page.textContent('#histStats')).replace(/\s+/g, ' ');
  ok(hist.includes('Datore di lavoro') && hist.includes('Beta Srl') && /Totale8100/.test(hist.replace(/\s+/g, '')), 'tabella storico: totale 8 ore lavorate fino a oggi e 1 giorno di ferie', hist);
  await cell(page, '2026-11-10').click();
  ok((await toastText(page)).includes('sola lettura'), 'clic in vista somma: sola lettura');
  eq('...nessun dato cambiato', (await dbOf(page)).jobs.reduce((s, j) => s + Object.keys(j.days).length, 0), 4);
  ok((await cell(page, '2026-11-10').getAttribute('title')).includes('Datore di lavoro: Lavoro, 8 ore'), 'tooltip con il dettaglio per datore');
  eq('menu: "compila mese" disattivato nella vista somma', await page.locator('#fillMenu > button').isDisabled(), true);
  await menu(page, 'dataMenu', 'export-history').catch(() => {});

  // elimina Beta (ha dati) e annulla
  await page.selectOption('#jobSel', await page.evaluate(() => window.__presenze.store.jobs[0].id));
  await page.click('#jobsBtn');
  await page.click('#jobsList .jobbox >> nth=1 >> [data-del]');
  await page.click('#jobsForm button[type=submit]');
  await page.waitForSelector('#choiceDlg[open]');
  ok((await page.textContent('#cText')).includes('Beta Srl (2 giorni)'), 'conferma con il numero di giorni');
  await page.click('#cBtns button:has-text("Elimina")');
  await page.waitForTimeout(150);
  eq('Beta eliminato', (await dbOf(page)).jobs.length, 1);
  eq('...e senza più la voce "somma"', await page.locator('#jobSel option').count(), 1);
  await page.keyboard.press('Control+z');
  eq('annullabile', (await dbOf(page)).jobs.length, 2);
  // riportare il primo rapporto a "in corso": la fine sparisce
  await page.click('#jobsBtn');
  await page.check('#jobsList .jobbox >> nth=0 >> [data-f="ongoing"]');
  await page.click('#jobsForm button[type=submit]');
  eq('fine rimossa', (await dbOf(page)).jobs[0].end, null);
  eq('etichetta "in corso"', await page.locator('#jobSel option >> nth=0').textContent(), 'Datore di lavoro (dal 12/10/2026, in corso)');
  // spostare l'inizio lascia dati fuori periodo
  await page.click('#jobsBtn');
  await page.fill('#jobsList .jobbox >> nth=0 >> [data-f="start"]', '2026-11-10');
  await page.click('#jobsForm button[type=submit]');
  ok((await toastText(page)).includes('1 giorni registrati ora cadono fuori periodo'), 'avviso sui giorni usciti dal periodo', await toastText(page));
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}

console.log('# Giorni che si sovrappongono tra datori');
{
  const seed = mkDb([
    mkJob('a', 'Alfa', { days: { '2026-11-09': { presence: P('work', 4), absence: null, note: 'da Alfa' } } }),
    mkJob('b', 'Beta', { days: { '2026-11-09': { presence: P('work', 4), absence: null, note: '' }, '2026-11-10': { presence: null, absence: P('ferie', 8), note: '' } } })
  ]);
  const { ctx, page, errors } = await fresh({ seed });
  await page.selectOption('#jobSel', '__all__');
  const t = await cell(page, '2026-11-09').getAttribute('title');
  ok(t.includes('Alfa: Lavoro, 4 ore (da Alfa)') && t.includes('Beta: Lavoro, 4 ore'), 'tooltip elenca i due datori', t);
  ok((await cell(page, '2026-11-09').getAttribute('aria-label')).includes('Lavoro, 8 ore'), 'ore sommate: 4 + 4 = 8', await cell(page, '2026-11-09').getAttribute('aria-label'));
  ok((await cell(page, '2026-11-10').getAttribute('class')).includes('st-ferie'), 'giorno di un solo datore mostrato normalmente');
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}

console.log('# JSON: uno per datore, e ripristino');
{
  const seed = mkDb([
    mkJob('a', 'Alfa Srl', { start: '2025-01-01', end: '2026-06-30', days: { '2026-02-02': { presence: P('work', 8), absence: null, note: 'x' } } }),
    mkJob('b', 'Beta', { start: '2026-07-01', days: { '2026-07-06': { presence: P('smart', 8), absence: null, note: '' } } })
  ]);
  const { ctx, page, errors } = await fresh({ seed });
  await page.selectOption('#jobSel', 'a');
  await page.click('#dataMenu > button');
  const [d1] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="export-json-job"]')]);
  eq('nome file del singolo datore', d1.suggestedFilename(), 'presenze-alfa-srl-2026-11-18.json');
  const f1 = '/tmp/pw/alfa.json'; await d1.saveAs(f1);
  const j1 = JSON.parse(fs.readFileSync(f1, 'utf8'));
  ok(j1.kind === 'job' && j1.version === 3 && j1.job.id === 'a' && j1.job.name === 'Alfa Srl' && !j1.jobs, 'contiene solo quel datore');
  // un file per ogni datore
  const got = [];
  page.on('download', d => got.push(d));
  await page.click('#dataMenu > button'); await page.click('[data-act="export-json-each"]');
  await page.waitForTimeout(1500);
  eq('due download, uno per datore', got.map(d => d.suggestedFilename()).sort(), ['presenze-alfa-srl-2026-11-18.json', 'presenze-beta-2026-11-18.json']);
  await got[1].saveAs('/tmp/pw/beta.json');
  const [d3] = await Promise.all([page.waitForEvent('download'), (async () => { await page.click('#dataMenu > button'); await page.click('[data-act="export-json"]'); })()]);
  await d3.saveAs('/tmp/pw/all.json');
  const all = JSON.parse(fs.readFileSync('/tmp/pw/all.json', 'utf8'));
  ok(all.kind === 'all' && all.jobs.length === 2 && all.version === 3 && all.meta.lastBackup, 'backup completo con tutti i datori');
  await ctx.close();

  // ripristino in una finestra vuota
  const r = await fresh();
  const imp = async (files, choice) => {
    await r.page.setInputFiles('#importFile', files);
    await r.page.waitForSelector('#choiceDlg[open]');
    await r.page.click(`#cBtns button:has-text("${choice}")`);
    await r.page.waitForTimeout(150);
  };
  await imp('/tmp/pw/alfa.json', 'Unisci');
  let db = await dbOf(r.page);
  eq('il file di un datore diventa un nuovo rapporto', db.jobs.map(j => j.name).sort(), ['Alfa Srl', 'Datore di lavoro']);
  await imp('/tmp/pw/alfa.json', 'Unisci');
  eq('riportarlo di nuovo non lo duplica', (await dbOf(r.page)).jobs.length, 2);
  await imp(['/tmp/pw/alfa.json', '/tmp/pw/beta.json'], 'Sostituisci');
  eq('due file insieme: Alfa sostituito, Beta aggiunto', (await dbOf(r.page)).jobs.map(j => j.name).sort(), ['Alfa Srl', 'Beta', 'Datore di lavoro']);
  await r.page.keyboard.press('Control+z');
  eq('ripristino annullabile', (await dbOf(r.page)).jobs.length, 2);
  fs.writeFileSync('/tmp/pw/legacy.json', JSON.stringify({ days: { '2026-11-04': { status: 'ferie', hours: 8, note: 'vecchio' } } }));
  await r.page.selectOption('#jobSel', await r.page.evaluate(() => window.__presenze.store.jobs.find(j => j.name === 'Datore di lavoro').id));
  await imp('/tmp/pw/legacy.json', 'Unisci');
  let dd = await days(r.page);
  ok(dd['2026-11-04'] && dd['2026-11-04'].absence.status === 'ferie', 'file della versione 2: unito al datore selezionato');
  await imp('/tmp/pw/all.json', 'Sostituisci');
  eq('backup completo, sostituisci: ripartono i soli datori del file', (await dbOf(r.page)).jobs.map(j => j.name), ['Alfa Srl', 'Beta']);
  fs.writeFileSync('/tmp/pw/bad.json', '{"foo":1}');
  await r.page.setInputFiles('#importFile', '/tmp/pw/bad.json');
  await r.page.waitForSelector('.toast');
  ok((await toastText(r.page)).includes('Nessun file valido'), 'file non valido rifiutato');
  fs.writeFileSync('/tmp/pw/xss.json', JSON.stringify({ kind: 'job', job: { id: 'x', name: '<img src=x onerror="window.__xss=1">', days: { '2026-11-04': { presence: { status: 'work', hours: 8 }, note: '"><img src=x onerror="window.__xss=2">' }, 'bad': { presence: { status: 'work' } }, '2026-11-05': { presence: { status: 'hack', hours: 1 } } } } }));
  await imp('/tmp/pw/xss.json', 'Unisci');
  ok(await r.page.evaluate(() => window.__xss === undefined), 'nessun codice eseguito da nomi o note malevoli');
  const xj = (await dbOf(r.page)).jobs.find(j => j.id === 'x');
  ok(xj && Object.keys(xj.days).length === 1, 'voci non valide scartate (1 su 3)');
  ok(r.errors.length === 0, 'nessun errore', r.errors.join('|'));
  await r.ctx.close();
}

console.log('# Migrazione dalle versioni precedenti');
{
  const v2 = { version: 2, days: { '2026-02-02': { status: 'ferie', hours: 8, note: '' }, '2026-11-03': { status: 'work', hours: 8, note: '' }, '2026-11-10': { status: 'permesso', hours: 2, note: 'medico' } },
    years: { '2026': { ferie: 22, permessi: 40, carryFerie: 1, carryPermessi: 0 } }, settings: { theme: 'dark', stdHours: 7.5, workdays: [true, true, true, true, true, true, false], patron: { month: 12, day: 7, name: 'S. Ambrogio' }, smartCap: 4 }, meta: { lastBackup: null } };
  const { ctx, page, errors } = await fresh({ rawSeed: { presenze_tracker_v2: JSON.stringify(v2) } });
  const db = await dbOf(page);
  eq('un solo rapporto', db.jobs.length, 1);
  eq('con giorni precedenti al 12/10 non metto limiti all\'inizio', db.jobs[0].start, null);
  const dd = await days(page);
  ok(dd['2026-11-10'].absence.status === 'permesso' && dd['2026-11-10'].absence.hours === 2 && !dd['2026-11-10'].presence, 'permesso v2 → sola assenza');
  ok(dd['2026-11-03'].presence.status === 'work' && !dd['2026-11-03'].absence, 'lavoro v2 → sola presenza');
  eq('quote per anno conservate', db.jobs[0].years['2026'], { ferie: 22, permessi: 40, exfest: 0, carryFerie: 1, carryPermessi: 0, carryExfest: 0 });
  eq('impostazioni portate nel datore', [db.jobs[0].cfg.stdHours, db.jobs[0].cfg.workdays[5]], [7.5, true]);
  eq('tema globale, santo patrono portato nel datore', [db.settings.theme, db.jobs[0].cfg.patron.name], ['dark', 'S. Ambrogio']);
  ok((await toastText(page)).includes('versione precedente'), 'avviso');
  ok(await page.evaluate(() => localStorage.getItem('presenze_tracker_v2') !== null), 'chiave v2 lasciata intatta');
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}
{
  const v2 = { version: 2, days: { '2026-11-03': { status: 'work', hours: 8, note: '' } }, years: {}, settings: { theme: 'auto', stdHours: 8, workdays: [true, true, true, true, true, false, false], patron: { month: 0, day: 1, name: '' }, smartCap: 0 }, meta: {} };
  const { ctx, page } = await fresh({ rawSeed: { presenze_tracker_v2: JSON.stringify(v2) } });
  eq('dati tutti dopo il 12/10: inizio rapporto = 12/10/2026', (await dbOf(page)).jobs[0].start, '2026-10-12');
  await ctx.close();
}
{
  const v1 = { days: { '2026-02-02': { status: 'ferie', hours: 8, note: '' }, '2026-02-03': { status: 'ferie', hours: 8, note: '' }, '2025-08-11': { status: 'ferie', hours: 8, note: '' } }, quotas: { ferie: 22, permessi: 40 } };
  const { ctx, page, errors } = await fresh({ rawSeed: { presenze_tracker_v1: JSON.stringify(v1) } });
  const db = await dbOf(page);
  ok(db.jobs[0].years['2026'].ferie === 22 && db.jobs[0].years['2025'].ferie === 22 && db.jobs[0].years['2026'].permessi === 40, 'v1: quote copiate su ogni anno con dati');
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}
{
  const { ctx, page, errors } = await fresh({ rawSeed: { presenze_tracker_v3: '{rotto' } });
  ok((await toastText(page)).includes('danneggiati'), 'JSON corrotto: avviso');
  eq('calendario comunque renderizzato', await page.locator('.day[data-key]').count(), 30);
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}

console.log('# Impostazioni');
{
  const { ctx, page, errors } = await fresh();
  await page.click('#settingsBtn');
  await page.fill('#sPatDay', '7'); await page.selectOption('#sPatMonth', '12'); await page.fill('#sPatName', 'S. Ambrogio');
  await page.locator('#sDays input').nth(5).check();
  await page.click('#setForm button[type=submit]');
  await page.click('#nextBtn');
  ok((await cell(page, '2026-12-07').getAttribute('class')).includes('st-festivo'), 'patrono 7 dicembre festivo');
  await page.keyboard.press('3'); await cell(page, '2026-12-05').click();
  ok((await days(page))['2026-12-05'], 'ferie di sabato accettate se il sabato è lavorativo');
  await page.click('#settingsBtn');
  await page.fill('#sPatDay', '31'); await page.selectOption('#sPatMonth', '11');
  await page.click('#setForm button[type=submit]');
  ok(await page.locator('#sErr').isVisible(), '31 novembre rifiutato');
  await page.keyboard.press('Escape');
  // elimina solo questo datore
  await page.click('#settingsBtn');
  await page.click('#sWipe');
  await page.waitForSelector('#choiceDlg[open]');
  await page.click('#cBtns button:has-text("Svuota solo")');
  await page.waitForTimeout(150);
  eq('svuotato il datore (non l\'anagrafica)', [Object.keys(await days(page)).length, (await dbOf(page)).jobs.length], [0, 1]);
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}

console.log('# Export CSV: chiusura e festività non sono assenze');
{
  const seed = mkDb([mkJob('a', 'Alfa Srl', {
    years: { '2026': { ferie: 26, permessi: 32, exfest: 0, carryFerie: 2, carryPermessi: 0, carryExfest: 0 } },
    days: {
      '2026-11-09': { presence: null, absence: P('ferie', 8), note: '' },
      '2026-11-10': { presence: P('work', 4), absence: P('ferie', 4), note: 'mezza; con "virgolette"' },
      '2026-11-11': { presence: P('work', 6), absence: P('permesso', 2), note: '' },
      '2026-11-14': { presence: P('work', 5), absence: null, note: '=1+1' },
      '2026-11-21': { presence: null, absence: P('ferie', 8), note: 'sabato legacy' },
      '2026-12-23': { presence: null, absence: P('chiusura', 8), note: 'Natale aziendale' },
      '2026-12-24': { presence: null, absence: P('ferie', 8), note: '' }
    } })]);
  const { ctx, page, errors } = await fresh({ seed });
  await page.click('#dataMenu > button');
  ok((await page.textContent('#yearItem')).includes('Esporta anno 2026 completo'), 'voce di menu con anno');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="export-year"]')]);
  eq('nome file', dl.suggestedFilename(), 'presenze-2026-anno-completo.csv');
  const buf = fs.readFileSync(await dl.path());
  ok(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF, 'BOM UTF-8');
  const rows = buf.toString('utf8').replace(/^﻿/, '').split('\r\n');
  eq('intestazione', rows[0], 'Data;Giorno;Tipo giorno;Compilato;Presenza;Ore presenza;Assenza;Ore assenza;Giorni assenza;Conteggiata;Scalato da;Festività;Note');
  ok(rows.slice(1, 366).length === 365 && rows[365].startsWith('31/12/2026;') && rows[366] === '', '365 righe, poi riga vuota');
  const row = d => rows.find(r => r.startsWith(d + ';'));
  const R = (...f) => f.join(';');
  eq('festività su giorno feriale: tipo "Festivo", nessuna assenza', row('01/01/2026'), R('01/01/2026', 'giovedì', 'Festivo', '', '', '', '', '', '', '', '', '"Capodanno"', '""'));
  eq('chiusura aziendale: tipo giorno, nessuna assenza', row('23/12/2026'), R('23/12/2026', 'mercoledì', 'Chiusura aziendale', 'Sì', '', '', '', '', '', '', '', '""', '"Natale aziendale"'));
  eq('ferie intera giornata', row('09/11/2026'), R('09/11/2026', 'lunedì', 'Lavorativo', 'Sì', '', '', 'Ferie', '8', '1', 'Sì', '', '""', '""'));
  eq('lavoro 4h + ferie 4h', row('10/11/2026'), R('10/11/2026', 'martedì', 'Lavorativo', 'Sì', 'Lavoro', '4', 'Ferie', '4', '0,5', 'Sì', '', '""', '"mezza; con ""virgolette"""'));
  eq('lavoro 6h + permesso ROL 2h', row('11/11/2026'), R('11/11/2026', 'mercoledì', 'Lavorativo', 'Sì', 'Lavoro', '6', 'Permesso ROL', '2', '', 'Sì', '', '""', '""'));
  eq('lavoro di sabato con nota protetta', row('14/11/2026'), R('14/11/2026', 'sabato', 'Non lavorativo', '', 'Lavoro', '5', '', '', '', '', '', '""', `"'=1+1"`));
  eq('ferie di sabato: Conteggiata = No', row('21/11/2026'), R('21/11/2026', 'sabato', 'Non lavorativo', '', '', '', 'Ferie', '8', '', 'No', '', '""', '"sabato legacy"'));
  eq('giorno lavorativo vuoto', row('03/11/2026'), R('03/11/2026', 'martedì', 'Lavorativo', 'No', '', '', '', '', '', '', '', '""', '""'));
  eq('weekend vuoto', row('07/11/2026'), R('07/11/2026', 'sabato', 'Non lavorativo', '', '', '', '', '', '', '', '', '""', '""'));
  const sum = Object.fromEntries(rows.slice(367).filter(r => r.includes(';')).map(r => { const i = r.lastIndexOf(';'); return [r.slice(0, i).replace(/^"|"$/g, ''), r.slice(i + 1)]; }));
  eq('ferie usate 1 + 0,5 + 1', sum['Ferie (giorni)'], '2,5');
  eq('ferie già godute', sum['Ferie: già godute (giorni)'], '1,5');
  eq('ferie pianificate', sum['Ferie: pianificate (giorni)'], '1');
  eq('monte + riporto', sum['Ferie: monte più riporto (giorni)'], '28');
  eq('residuo ferie (la chiusura non scala)', sum['Ferie: residuo (giorni)'], '25,5');
  eq('ROL residuo', sum['Permessi ROL: residuo (ore)'], '30');
  eq('chiusura aziendale tra i giorni non lavorati', sum['Chiusura aziendale (giorni)'], '1');
  eq('festivi (7 su giorni feriali)', sum['Festivi (giorni)'], '7');
  ok(!('Permessi ex festività: residuo (ore)' in sum), 'senza ex festività non compare il blocco');
  ok(rows.indexOf('"Assenze (ferie, permessi, malattia)";') > -1 && rows.indexOf('"Giorni non lavorati che non sono assenze";') > rows.indexOf('"Assenze (ferie, permessi, malattia)";'), 'riepilogo diviso: assenze e giorni non lavorati');
  eq('ore lavorate', sum['Ore lavorate fino a oggi'], '15');
  eq('straordinario (le 5 ore del sabato)', sum['Di cui straordinario (ore)'], '5');
  ok(Object.keys(sum).some(k => k.startsWith('Riepilogo 2026, Alfa Srl')), 'riepilogo con il nome del datore');
  await page.click('#dataMenu > button');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="export-csv"]')]);
  const c2 = fs.readFileSync(await dl2.path(), 'utf8').replace(/^﻿/, '').split('\r\n');
  eq('intestazione dei soli compilati', c2[0], 'Data;Giorno;Tipo giorno;Presenza;Ore presenza;Assenza;Ore assenza;Note');
  eq('7 giorni compilati', c2.length - 2, 7);
  eq('una riga', c2[2], R('10/11/2026', 'martedì', 'Lavorativo', 'Lavoro', '4', 'Ferie', '4', '"mezza; con ""virgolette"""'));
  eq('la chiusura non ha colonne di assenza', c2.find(r => r.startsWith('23/12/2026')), R('23/12/2026', 'mercoledì', 'Chiusura aziendale', '', '', '', '', '"Natale aziendale"'));
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}
{
  // la chiusura che scala da una voce dei saldi: colonna "Scalato da"
  const seed = mkDb([mkJob('a', 'Alfa', { cfg: { closureDeduct: 'exfest' }, years: { '2026': { ferie: 26, permessi: 32, exfest: 16, carryFerie: 0, carryPermessi: 0, carryExfest: 0 } },
    days: { '2026-12-23': { presence: null, absence: P('chiusura', 8), note: '' } } })]);
  const { ctx, page } = await fresh({ seed });
  await page.click('#dataMenu > button');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="export-year"]')]);
  const rows = fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '').split('\r\n');
  eq('"Scalato da" per la chiusura', rows.find(r => r.startsWith('23/12/2026')).split(';')[10], 'Permessi ex festività');
  ok(rows.some(r => r.startsWith('"Permessi ex festività: residuo (ore)";8')), 'residuo ex festività 16 - 8 = 8', rows.filter(r => r.includes('ex festività')).join(' | '));
  ok(rows.some(r => r.startsWith('"Le chiusure aziendali scalano da permessi ex festività"')), 'nota nel riepilogo');
  await ctx.close();
}
{
  const seed = mkDb([
    mkJob('a', 'Alfa Srl', { start: '2025-03-01', end: '2026-06-30', days: { '2025-04-07': { presence: P('work', 8), absence: null, note: '' }, '2025-04-08': { presence: null, absence: P('ferie', 8), note: '' }, '2026-02-02': { presence: P('work', 8), absence: null, note: 'nota' }, '2026-02-03': { presence: null, absence: P('chiusura', 8), note: '' } } }),
    mkJob('b', 'Beta', { start: '2026-07-01', days: { '2026-07-06': { presence: P('work', 8), absence: null, note: '' }, '2026-07-07': { presence: P('smart', 8), absence: null, note: '' } } })
  ]);
  const { ctx, page, errors } = await fresh({ seed });
  await page.click('#dataMenu > button');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="export-history"]')]);
  eq('nome', dl.suggestedFilename(), 'presenze-storico-completo.csv');
  const rows = fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '').split('\r\n');
  eq('intestazione elenco', rows[0], 'Datore;Inizio rapporto;Fine rapporto;Data;Giorno;Tipo giorno;Presenza;Ore presenza;Assenza;Ore assenza;Note');
  eq('primo giorno', rows[1], '"Alfa Srl";01/03/2025;30/06/2026;07/04/2025;lunedì;Lavorativo;Lavoro;8;;;""');
  eq('la chiusura non è un\'assenza', rows.find(r => r.includes('03/02/2026')), '"Alfa Srl";01/03/2025;30/06/2026;03/02/2026;martedì;Chiusura aziendale;;;;;""');
  eq('giorno di Beta (fine rapporto vuota)', rows.find(r => r.includes('07/07/2026')), '"Beta";01/07/2026;;07/07/2026;martedì;Lavorativo;Smart Working;8;;;""');
  const i = rows.indexOf('Datore;Anno;Ore lavorate;Giorni di lavoro;Giorni di smart working;Giorni di ferie;Ore di permesso ROL;Ore di permesso ex festività;Giorni di malattia;Ore di straordinario;Giorni di chiusura aziendale (non assenza);Giorni festivi (non assenza)');
  ok(i > 0, 'blocco riepilogo per anno');
  const blk = rows.slice(i + 1).filter(Boolean);
  eq('Alfa 2025 (8 giorni festivi feriali)', blk[0], '"Alfa Srl";"2025";8;1;0;1;0;0;0;0;0;8');
  eq('Alfa 2026 (chiusura 1, festivi 5)', blk[1], '"Alfa Srl";"2026";8;1;0;0;0;0;0;0;1;5');
  eq('Alfa totale', blk[2], '"Alfa Srl";"Totale";16;2;0;1;0;0;0;0;1;13');
  eq('Beta 2026 (2 festivi feriali)', blk[3], '"Beta";"2026";16;1;1;0;0;0;0;0;0;2');
  eq('Totale generale', blk[blk.length - 1], '"Tutti i datori";"Totale";32;3;1;1;0;0;0;0;1;15');
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}

console.log('# Permessi ROL ed ex festività separati');
{
  const { ctx, page, errors } = await fresh();
  eq('di default l\'ex festività non compare nei saldi', (await page.textContent('#balances')).includes('ex festività'), false);
  await page.keyboard.press('5');
  await cell(page, '2026-11-09').click();
  let e = (await days(page))['2026-11-09'];
  ok(e.absence.status === 'exfest' && e.absence.hours === 2 && e.presence && e.presence.hours === 6, 'timbro ex festività: 2h di permesso + 6h di lavoro');
  ok((await cell(page, '2026-11-09').innerText()).includes('Ex fest. 2h'), 'la cella lo distingue dal ROL');
  await page.keyboard.press('4');
  await cell(page, '2026-11-10').click();
  const st = await page.evaluate(() => { const s = window.__presenze.periodStats(2026, null); return [s.permHours, s.exfHours]; });
  eq('statistiche separate: ROL 2 h, ex festività 2 h', st, [2, 2]);
  ok((await page.textContent('#balances')).includes('Permessi ex festività'), 'dopo l\'uso compare il saldo ex festività');
  ok(/-?2\s*h oltre il monte/.test(await page.textContent('#balances')), 'senza monte: segnala che sei oltre', await page.textContent('#balances'));
  await page.locator('details.quota summary').click();
  await page.fill('#qExf', '32'); await page.press('#qExf', 'Tab');
  await page.fill('#qCarryExf', '4'); await page.press('#qCarryExf', 'Tab');
  ok(/34\s*h residui/.test(await page.textContent('#balances')), 'monte 32 + riporto 4 - 2 = 34 h residui');
  ok(/30\s*h residui/.test(await page.textContent('#balances')), 'il ROL resta separato: 32 - 2 = 30');
  // dettagli: scelta dell'assenza
  await cell(page, '2026-11-12').click({ button: 'right' });
  await page.selectOption('#dAbs', 'exfest');
  eq('dettagli: ex festività 2 h e lavoro 6 h', [await page.inputValue('#dAbsH'), await page.inputValue('#dPres'), await page.inputValue('#dPresH')], ['2', 'work', '6']);
  await page.keyboard.press('Escape');
  // la chiusura che scala dall'ex festività
  await page.click('#settingsBtn'); await page.selectOption('#sClosure', 'exfest'); await page.click('#setForm button[type=submit]');
  await page.keyboard.press('7'); await cell(page, '2026-11-13').click();
  const st2 = await page.evaluate(() => { const s = window.__presenze.periodStats(2026, null); return [s.exfDone, s.closureExf, s.permDone]; });
  eq('chiusura scalata dall\'ex festività: +8 h solo lì', st2, [10, 8, 2]);
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}

console.log('# Maturazione a ore per ferie, ROL ed ex festività');
{
  const { ctx, page, errors } = await fresh();
  await menu(page, 'fillMenu', 'fill-work');                          // 13 giorni fino a oggi = 104 ore
  await page.click('#settingsBtn');
  await page.selectOption('#sFerMode', 'worked'); await page.fill('#sFerPer', '8'); await page.fill('#sFerEvery', '173');
  await page.selectOption('#sPerMode', 'worked'); await page.fill('#sPerPer', '4'); await page.fill('#sPerEvery', '173');
  await page.selectOption('#sExfMode', 'worked'); await page.fill('#sExfPer', '2'); await page.fill('#sExfEvery', '173');
  await page.click('#setForm button[type=submit]');
  const t = (await page.textContent('#accrual')).replace(/\s+/g, ' ');
  ok(/Ferie maturate\s*0,6 gg \(4,81 h\)/.test(t), 'ferie: 104 × 8/173 = 4,81 h = 0,6 gg', t);
  ok(/Permessi ROL maturati\s*2,4 h/.test(t), 'ROL: 104 × 4/173 = 2,4 h', t);
  ok(/Permessi ex festività maturati\s*1,2 h/.test(t), 'ex festività: 104 × 2/173 = 1,2 h', t);
  ok(/regole impostate/i.test(t) && t.includes('ferie: 8 h ogni 173 h') && t.includes('permessi ROL: 4 h ogni 173 h') && t.includes('permessi ex festività: 2 h ogni 173 h'), 'le tre regole sono elencate', t);
  eq('con tre regole il pulsante è generico', (await page.textContent('[data-act="update-accrual"]')).trim(), 'Aggiorna maturazione');
  await page.click('[data-act="update-accrual"]');
  const tt = await toastText(page);
  ok(tt.includes('Ferie maturate: 0,6 gg (4,81 h)') && tt.includes('Permessi ROL maturati: 2,4 h') && tt.includes('Permessi ex festività maturati: 1,2 h'), 'toast con i tre valori', tt);
  const sn = (await dbOf(page)).jobs[0].snaps['2026'];
  ok(Math.abs(sn.exfest - 104 * 2 / 173) < 1e-9 && Math.abs(sn.permessi - 104 * 4 / 173) < 1e-9, 'snapshot con i tre valori');
  const bal = (await page.textContent('#balances')).replace(/\s+/g, ' ');
  ok(/Permessi ex festività\s*1,2 h residui/.test(bal), 'saldo ex festività = maturato', bal);
  ok(/Ferie\s*0,6 gg residui/.test(bal) && bal.includes('Maturate 4,81 h'), 'saldo ferie dal maturato, con le ore', bal);
  ok(await page.locator('#qExf').isDisabled() && await page.locator('#qPerm').isDisabled() && await page.locator('#qFerie').isDisabled(), 'monti fissi bloccati in modalità "a ore"');
  // conversione delle ferie che prima maturavano in giorni
  const conv = await page.evaluate(() => { const o = window.__presenze.normalizeAny({ jobs: [{ id: 'x', name: 'X', cfg: { stdHours: 8, accrual: { ferie: { mode: 'worked', per: 2, every: 173 } } }, days: {} }] }); return o.db.jobs[0].cfg.accrual.ferie; });
  eq('ferie salvate in giorni → ore (2 gg × 8 h)', [conv.per, conv.unit], [16, 'h']);
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}

console.log('# Smart working: limite settimanale (soft) con due scadenze');
{
  const { ctx, page, errors } = await fresh();
  eq('senza limite non compare nei saldi', (await page.textContent('#balances')).includes('Smart working'), false);
  await page.click('#settingsBtn');
  await page.fill('#sSmartW', '2');
  eq('scadenze di default: 31/5 e 31/12', [await page.inputValue('#sD1Day'), await page.inputValue('#sD1Month'), await page.inputValue('#sD2Day'), await page.inputValue('#sD2Month')], ['31', '5', '31', '12']);
  await page.click('#setForm button[type=submit]');
  let bal = (await page.textContent('#balances')).replace(/\s+/g, ' ');
  ok(/Smart working\s*24 gg ancora possibili/.test(bal), '12 settimane dal 12/10 al 31/12 × 2 giorni = 24 possibili', bal);
  ok(bal.includes('Periodo dal 01/06/2026 al 31/12/2026'), 'periodo giugno-dicembre', bal);
  const per = await page.evaluate(() => [window.__presenze.smartPeriodFor(2026, 4), window.__presenze.smartPeriodFor(2026, 5), window.__presenze.smartPeriodFor(2027, 0)]);
  eq('periodi: gen-mag, giu-dic, e di nuovo gen-mag', per, [{ start: '2026-01-01', end: '2026-05-31' }, { start: '2026-06-01', end: '2026-12-31' }, { start: '2027-01-01', end: '2027-05-31' }]);
  await page.keyboard.press('2');
  for (const k of ['2026-11-09', '2026-11-10']) await cell(page, k).click();
  ok(!(await toastText(page)).includes('Attenzione'), 'due giorni: nessun avviso');
  await cell(page, '2026-11-11').click();
  ok((await toastText(page)).includes('Attenzione: nella settimana del 09/11/2026 hai 3 giorni di smart working, il limite è 2'), 'terzo giorno: avviso (solo avviso)', await toastText(page));
  eq('...ma il giorno è stato registrato', (await days(page))['2026-11-11'].presence.status, 'smart');
  eq('le tre celle sono segnate "oltre il limite"', await page.locator('.day.smartover').count(), 3);
  bal = (await page.textContent('#balances')).replace(/\s+/g, ' ');
  ok(/Smart working\s*21 gg ancora possibili/.test(bal) && bal.includes('1 settimana è oltre il limite'), '24 - 3 = 21, con la settimana segnalata', bal);
  await cell(page, '2026-11-11').click();                              // togli: torna sotto il limite
  eq('tolto un giorno il segno sparisce', await page.locator('.day.smartover').count(), 0);
  // una settimana intera di ferie non dà giorni di smart possibili
  await page.keyboard.press('3');
  const box = async k => { const b = await cell(page, k).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const a = await box('2026-11-23'), b = await box('2026-11-27');
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
  ok(/Smart working\s*20 gg ancora possibili/.test((await page.textContent('#balances')).replace(/\s+/g, ' ')), 'settimana tutta in ferie: 2 possibili in meno (24 - 2 usati - 2)', (await page.textContent('#balances')).replace(/\s+/g, ' '));
  // scadenze diverse
  await page.click('#settingsBtn');
  await page.fill('#sD1Day', '15'); await page.selectOption('#sD1Month', '3'); await page.fill('#sD2Day', '15'); await page.selectOption('#sD2Month', '9');
  await page.click('#setForm button[type=submit]');
  const per2 = await page.evaluate(() => window.__presenze.smartPeriodFor(2026, 10));
  eq('con scadenze 15/3 e 15/9 novembre cade in 16/9/2026 - 15/3/2027', per2, { start: '2026-09-16', end: '2027-03-15' });
  await page.click('#settingsBtn');
  await page.fill('#sD2Day', '15'); await page.selectOption('#sD2Month', '3');
  await page.click('#setForm button[type=submit]');
  ok(await page.locator('#sErr').isVisible() && (await page.textContent('#sErr')).includes('giorni diversi'), 'scadenze uguali rifiutate');
  await page.fill('#sSmartW', '2.3');
  await page.fill('#sD2Day', '31'); await page.selectOption('#sD2Month', '12');
  await page.click('#setForm button[type=submit]');
  ok((await page.textContent('#sErr')).includes('mezza giornata'), 'limite non multiplo di 0,5 rifiutato');
  await page.keyboard.press('Escape');
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}

console.log('# Santo patrono per datore di lavoro');
{
  const seed = mkDb([
    mkJob('a', 'Alfa', { start: '2026-01-01', end: '2026-10-31', cfg: { patron: { month: 12, day: 7, name: 'S. Ambrogio' } } }),
    mkJob('b', 'Beta', { start: '2026-11-01', cfg: { patron: { month: 12, day: 14, name: 'Patrono di Beta' } } })
  ], 'b');
  const { ctx, page, errors } = await fresh({ seed });
  await page.click('#nextBtn');
  ok((await cell(page, '2026-12-14').getAttribute('class')).includes('st-festivo') && (await cell(page, '2026-12-14').innerText()).includes('Patrono di Beta'), 'Beta: festivo il 14 dicembre');
  ok(!(await cell(page, '2026-12-07').getAttribute('class')).includes('st-festivo'), 'Beta: il 7 dicembre non è festivo');
  const hol = await page.evaluate(() => { const j = window.__presenze.store.jobs; return j.map(x => window.__presenze.withJob(x, () => [...window.__presenze.holidays(2026).keys()].filter(k => k.startsWith('12-')).join(','))); });
  eq('festività di dicembre per datore', hol.map(h => h.split(',').sort().join(',')), ['12-07,12-08,12-25,12-26', '12-08,12-14,12-25,12-26']);
  await page.click('#settingsBtn');
  eq('le impostazioni mostrano il suo patrono', [await page.inputValue('#sPatDay'), await page.inputValue('#sPatMonth'), await page.inputValue('#sPatName')], ['14', '12', 'Patrono di Beta']);
  await page.fill('#sPatName', 'Patrono B2');
  await page.click('#setForm button[type=submit]');
  const db = await dbOf(page);
  eq('cambiare uno non tocca l\'altro', [db.jobs[0].cfg.patron.name, db.jobs[1].cfg.patron.name], ['S. Ambrogio', 'Patrono B2']);
  // migrazione: il patrono unico di una versione precedente va su ogni datore
  const mig = await page.evaluate(() => { const o = window.__presenze.normalizeAny({ jobs: [{ id: 'q', name: 'Q', days: {} }, { id: 'r', name: 'R', cfg: { patron: { month: 6, day: 29, name: 'SS. Pietro e Paolo' } }, days: {} }], settings: { theme: 'auto', patron: { month: 12, day: 7, name: 'S. Ambrogio' } } }); return o.db.jobs.map(j => j.cfg.patron.name); });
  eq('migrazione da patrono globale', mig, ['S. Ambrogio', 'SS. Pietro e Paolo']);
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}

console.log('# PDF e stampa sempre in chiaro');
{
  const { ctx, page, errors } = await fresh();
  await page.click('#themeBtn'); await page.click('#themeBtn');        // auto → chiaro → scuro
  eq('tema scuro attivo a schermo', await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  const screenBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(screenBg !== 'rgb(255, 255, 255)', 'a schermo lo sfondo è scuro', screenBg);
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
  const pr = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, panel: getComputedStyle(document.documentElement).getPropertyValue('--panel').trim(), ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(), cs: getComputedStyle(document.documentElement).colorScheme, adj: getComputedStyle(document.body).printColorAdjust || getComputedStyle(document.body).webkitPrintColorAdjust }));
  eq('in stampa, anche con tema scuro e preferenza scura del sistema: sfondo bianco', pr.bg, 'rgb(255, 255, 255)');
  eq('...pannelli e testo del tema chiaro', [pr.panel, pr.ink, pr.cs], ['#f8f9f7', '#13202a', 'light']);
  eq('...colori di sfondo stampati', pr.adj, 'exact');
  const cellColors = await page.evaluate(() => { const el = document.querySelector('.day[data-key]'); return getComputedStyle(el).color; });
  ok(cellColors !== 'rgb(232, 238, 242)', 'il testo delle celle non è quello del tema scuro', cellColors);
  await page.emulateMedia({ media: 'screen' });
  // PDF vero: deve produrre un file non vuoto senza errori, in tema scuro
  const pdf = await page.pdf({ landscape: true, printBackground: true });
  ok(pdf.length > 5000, 'PDF generato in tema scuro', String(pdf.length));
  fs.writeFileSync('/tmp/pw/dark.pdf', pdf);
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}

console.log('# Export PDF del mese e dell\'anno');
{
  // Legge un PDF scaricato: controlla struttura (intestazione, xref, lunghezze degli stream) e ne estrae i testi
  const readPdf = buf => {
    const s = buf.toString('latin1'), why = [];
    if (!s.startsWith('%PDF-1.4\n')) why.push('intestazione');
    if (!s.endsWith('%%EOF\n')) why.push('fine file');
    const sx = +(/startxref\n(\d+)\n%%EOF\n$/.exec(s) || [0, -1])[1];
    if (!s.startsWith('xref\n', sx)) why.push('startxref');
    const xm = /^xref\n0 (\d+)\n/.exec(s.slice(sx)) || [ '', 0 ];
    const n = +xm[1];
    for (let i = 1; i < n; i++) {
      const ent = s.substr(sx + xm[0].length + i * 20, 20);
      if (!/^\d{10} 00000 n \n$/.test(ent)) { why.push('voce xref ' + i); break; }
      if (!s.startsWith(`${i} 0 obj\n`, +ent.slice(0, 10))) { why.push('offset oggetto ' + i); break; }
    }
    const re = /<< \/Length (\d+) >>\nstream\n/g;
    let m, streams = 0;
    while ((m = re.exec(s))) { streams++; if (!s.startsWith('\nendstream', m.index + m[0].length + +m[1])) why.push('lunghezza stream ' + streams); }
    const texts = [...s.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map(t => t[1].replace(/\\(.)/g, '$1'));
    const count = +(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(s) || [0, 0])[1];
    const box = (/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(s) || []).slice(1).join('x');
    return { s, why, texts, count, box, has: t => texts.some(x => x.includes(t)) };
  };
  const grab = async (page, act) => {
    await page.click('#dataMenu > button');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`[data-act="${act}"]`)]);
    return { name: dl.suggestedFilename(), pdf: readPdf(fs.readFileSync(await dl.path())) };
  };
  const longNote = 'Inizio della nota lunga. ' + 'parola '.repeat(60) + 'FINE-DELLA-NOTA';
  const seed = mkDb([mkJob('a', 'Società Più’s (Srl)', {
    start: '2026-10-12',
    cfg: { smartWeekly: 2, closureDeduct: 'ferie', patron: { month: 11, day: 20, name: 'San Test' }, accrual: { ferie: { mode: 'fixed', per: 0, every: 173, unit: 'h' }, permessi: { mode: 'worked', per: 8, every: 173, unit: 'h' }, exfest: { mode: 'fixed', per: 0, every: 173, unit: 'h' } } },
    years: { '2026': { ferie: 26, permessi: 32, exfest: 16, carryFerie: 2, carryPermessi: 0, carryExfest: 0 } },
    days: {
      '2026-11-02': { presence: P('work', 8), absence: null, note: 'nota (con parentesi) e \\ barra 😀' },
      '2026-11-03': { presence: P('work', 6), absence: P('permesso', 2), note: '' },
      '2026-11-04': { presence: null, absence: P('ferie', 4), note: longNote },
      '2026-11-05': { presence: P('smart', 8), absence: null, note: '' },
      '2026-11-06': { presence: P('smart', 8), absence: null, note: '' },
      '2026-11-09': { presence: P('smart', 8), absence: null, note: '' },
      '2026-11-12': { presence: P('smart', 8), absence: null, note: '' },
      '2026-11-13': { presence: P('smart', 8), absence: null, note: '' },
      '2026-11-10': { presence: null, absence: P('exfest', 8), note: '' },
      '2026-11-11': { presence: null, absence: P('chiusura', 8), note: '' },
      '2026-11-25': { presence: null, absence: P('ferie', 8), note: 'ponte' },
      '2026-10-13': { presence: P('work', 8), absence: null, note: 'primo giorno' }
    }
  }), mkJob('b', 'Beta Srl', { start: '2026-03-01', end: '2026-09-30', days: { '2026-11-03': { presence: P('work', 2), absence: null, note: 'extra Beta' }, '2026-04-07': { presence: P('work', 8), absence: null, note: 'aprile Beta' } } })]);
  const { ctx, page, errors } = await fresh({ seed });
  await page.click('#dataMenu > button');
  eq('voci del menu con mese e anno mostrati', [(await page.textContent('#pdfMonthItem')).trim(), (await page.textContent('#pdfYearItem')).trim(), (await page.textContent('[data-act="print"]')).trim()],
    ['Esporta novembre 2026 in PDF', 'Esporta l’anno 2026 in PDF', 'Stampa la pagina']);
  await page.keyboard.press('Escape');

  // PDF del mese
  const mo = await grab(page, 'export-pdf-month');
  eq('nome del file del mese', mo.name, 'presenze-2026-11-societa-piu-s-srl.pdf');
  eq('struttura del PDF del mese valida (xref, oggetti, stream)', mo.pdf.why, []);
  eq('A4 verticale', mo.pdf.box, '595.28x841.89');
  ok(mo.pdf.has('Novembre 2026') && mo.pdf.has('Presenze del mese'), 'titolo del mese');
  ok(mo.pdf.has('Societ\xE0 Pi\xF9\x92s (Srl), dal 12/10/2026, in corso'), 'nome del datore con accenti e apostrofo tipografico in WinAnsi', mo.pdf.texts.slice(0, 6).join(' | '));
  ok(mo.pdf.has('Lavoro 6 h') && mo.pdf.has('ROL 2 h'), 'giorno con lavoro e permesso: entrambe le parti');
  ok(mo.pdf.has('Ferie 4 h') && mo.pdf.has('Ex festivit\xE0 8 h') && mo.pdf.has('Chiusura 8 h'), 'ferie a ore, ex festività e chiusura nelle caselle');
  ok(mo.pdf.has('Ognissanti') && mo.pdf.has('San Test'), 'festività nazionale e festivo locale del datore');
  ok(mo.pdf.has('oltre il limite SW'), 'segnale di smart working oltre il limite settimanale (3 giorni nella settimana 9-15 con limite 2)');
  ok(mo.pdf.has('da compilare'), 'giorni lavorativi passati senza stato');
  ok(mo.pdf.has('oggi'), 'oggi segnato');
  ok(mo.pdf.has('Riepilogo di novembre') && mo.pdf.has('Saldi 2026'), 'riepilogo del mese e saldi');
  ok(mo.pdf.has('maturati'), 'maturazione ROL descritta nelle note dei saldi');
  ok(mo.pdf.has('Le chiusure aziendali scalano da ferie'), 'nota sulla chiusura che scala dalle ferie');
  ok(mo.pdf.has('Note di novembre') && mo.pdf.has('FINE-DELLA-NOTA') && mo.pdf.has('Inizio della nota lunga.'), 'elenco note con il testo completo, anche lungo');
  ok(mo.pdf.s.includes('nota \\(con parentesi\\) e \\\\ barra ?'), 'parentesi e barra protette, emoji sostituita da "?"');
  ok(!mo.pdf.has('extra Beta'), 'nel PDF di un datore non ci sono i dati degli altri');
  ok(mo.pdf.s.includes('0.988 0.937 0.816 rg'), 'colori del tema chiaro (sfondo ferie)');
  ok(mo.pdf.has('Pagina 1 di '), 'numero di pagina');
  const toast1 = await toastText(page);
  ok(/PDF di novembre 2026 scaricato: \d+ pagin/.test(toast1), 'messaggio dopo il download', toast1);

  // Tema scuro: stesso PDF in chiaro
  await page.click('#themeBtn'); await page.click('#themeBtn');
  eq('tema scuro a schermo', await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  const moDark = await grab(page, 'export-pdf-month');
  ok(moDark.pdf.s.includes('0.988 0.937 0.816 rg') && !moDark.pdf.s.includes('0.227 0.169 0.047 rg'), 'con il tema scuro il PDF resta in chiaro');

  // Mese prima dell'assunzione: giorni fuori rapporto
  await page.click('#prevBtn');
  const oct = await grab(page, 'export-pdf-month');
  eq('ottobre: nome del file', oct.name, 'presenze-2026-10-societa-piu-s-srl.pdf');
  ok(oct.pdf.has('fuori rapporto') && oct.pdf.has('primo giorno'), 'ottobre: giorni prima dell\'assunzione fuori rapporto, nota del 13');
  await page.click('#nextBtn');

  // PDF dell'anno
  const yr = await grab(page, 'export-pdf-year');
  eq('nome del file dell\'anno', yr.name, 'presenze-2026-societa-piu-s-srl-anno.pdf');
  eq('struttura del PDF dell\'anno valida', yr.pdf.why, []);
  eq('A4 orizzontale', yr.pdf.box, '841.89x595.28');
  ok(yr.pdf.has('Anno 2026') && yr.pdf.has('Cartellino dell\x92anno'), 'titolo dell\'anno');
  eq('i 12 mesi', ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'].filter(mn => yr.pdf.texts.includes(mn)).length, 12);
  ok(yr.pdf.texts.includes('L6') && yr.pdf.texts.includes('R2') && yr.pdf.texts.includes('F4') && yr.pdf.texts.includes('EF8') && yr.pdf.texts.includes('CH'), 'codici con le ore nel cartellino (L6 + R2, F4, EF8, CH)');
  ok(yr.pdf.has('Totale 2026') && yr.pdf.has('Smart working 01/06\x9631/12 (gg)'), 'totale dell\'anno e saldo dello smart working del periodo');
  ok(!yr.pdf.has('Smart working 01/01\x9631/05 (gg)'), 'nessun saldo di smart working per il periodo prima dell\'assunzione');
  ok(yr.pdf.has('Note 2026') && yr.pdf.has('ponte') && yr.pdf.has('primo giorno'), 'note dell\'anno');
  ok(yr.pdf.has('Ore lavorate fino a oggi') && yr.pdf.has('Permessi ROL maturati a ore'), 'riepilogo con maturazione');
  ok(/PDF dell’anno 2026 scaricato/.test(await toastText(page)), 'messaggio dopo il download dell\'anno');

  // Vista somma: dati di tutti i datori
  await page.selectOption('#jobSel', '__all__');
  const sm = await grab(page, 'export-pdf-month');
  eq('somma: nome del file del mese', sm.name, 'presenze-2026-11-tutti-i-datori.pdf');
  eq('somma: struttura valida', sm.pdf.why, []);
  ok(sm.pdf.has('Tutti i datori di lavoro, dati sommati'), 'somma: intestazione');
  ok(sm.pdf.has('Residui per datore') && sm.pdf.has('Beta Srl'), 'somma: residui per datore');
  const sy = await grab(page, 'export-pdf-year');
  eq('somma: nome del file dell\'anno', sy.name, 'presenze-2026-tutti-i-datori-anno.pdf');
  ok(sy.pdf.has('Beta Srl: aprile Beta') && sy.pdf.has('primo giorno'), 'somma: note con il nome del datore');
  eq('somma: struttura valida (anno)', sy.pdf.why, []);
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}
{
  // Molte note lunghe: più pagine, intestazione delle note mai da sola in fondo
  const dd = {};
  for (let d = 2; d <= 27; d++) { const k = `2026-11-${String(d).padStart(2, '0')}`; if (![7, 8, 14, 15, 21, 22].includes(d)) dd[k] = { presence: P('work', 8), absence: null, note: `Giorno ${d}: ` + 'testo della nota abbastanza lungo da andare a capo '.repeat(4) }; }
  const { ctx, page, errors } = await fresh({ seed: mkDb([mkJob('a', 'Alfa', { days: dd })]) });
  const grabPdf = async act => { await page.click('#dataMenu > button'); const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`[data-act="${act}"]`)]); return fs.readFileSync(await dl.path()).toString('latin1'); };
  const s = await grabPdf('export-pdf-month');
  const count = +(/\/Count (\d+)/.exec(s) || [0, 0])[1];
  ok(count >= 2 && s.includes('(Pagina 2 di ' + count + ')'), 'molte note: il PDF del mese va su più pagine', String(count));
  ok(s.includes('(Giorno 27:') && s.includes('(Giorno 2:'), 'tutte le note presenti');
  const y = await grabPdf('export-pdf-year');
  ok(/\/Count [2-9]/.test(y) && y.includes('(Giorno 27:'), 'anche il PDF dell\'anno');
  const h = await page.evaluate(() => { const p = window.__presenze; return { w: p.pdfWidth('Lavoro', 10, false), wb: p.pdfWidth('Lavoro', 10, true), enc: p.pdfEnc('Città – “x” € ✓'), fit: p.pdfFit('Festa della Repubblica', 8, true, 40), wrap: p.pdfWrap('uno due tre quattro cinque sei', 8, false, 40, 2) }; });
  ok(Math.abs(h.w - 30.57) < 0.01 && Math.abs(h.wb - 33.34) < 0.01, 'larghezze Helvetica dal file AFM', JSON.stringify([h.w, h.wb]));
  eq('codifica WinAnsi', [...h.enc].map(c => c.charCodeAt(0).toString(16)).join(' '), '43 69 74 74 e0 20 96 20 93 78 94 20 80 20 3f');
  ok(h.fit.endsWith('…') && h.fit.length < 22, 'testo accorciato con i puntini', h.fit);
  ok(h.wrap.length === 2 && h.wrap[1].endsWith('…'), 'a capo con limite di righe', JSON.stringify(h.wrap));
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}
{
  const { ctx, page, errors } = await fresh();
  ok((await page.textContent('footer .keys')).includes('Permesso ex festività') && (await page.textContent('footer .keys')).includes('1 – 8'), 'scorciatoie aggiornate: tasti da 1 a 8');
  const em = await (async () => { await page.click('#dataMenu > button'); const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="export-pdf-year"]')]); return fs.readFileSync(await dl.path()).toString('latin1'); })();
  ok(em.startsWith('%PDF-1.4') && em.includes('(Anno 2026)'), 'anno senza dati: PDF creato lo stesso');
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}

console.log('# Tastiera');
{
  const { ctx, page, errors } = await fresh();
  await cell(page, '2026-11-18').focus();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown');
  eq('frecce', await page.evaluate(() => document.activeElement.dataset.key), '2026-11-26');
  await page.keyboard.press('Enter');
  ok((await days(page))['2026-11-26'], 'Invio applica il timbro');
  await page.keyboard.press('e');
  ok(await page.locator('#dayDlg').evaluate(d => d.open), 'E apre i dettagli');
  await page.keyboard.press('Escape');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  eq('oltre fine mese cambia mese', (await page.textContent('#monthTitle')).toLowerCase(), 'dicembre 2026');
  await page.keyboard.press('PageUp');
  eq('PagSu', (await page.textContent('#monthTitle')).toLowerCase(), 'novembre 2026');
  await page.keyboard.press('Delete');
  ok(!(await days(page))['2026-11-24'], 'Canc svuota');
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}

console.log('# Touch');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'it-IT' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(FILE); await page.waitForSelector('.day[data-key]');
  await cell(page, '2026-11-12').tap();
  ok((await days(page))['2026-11-12'], 'tap applica il timbro');
  const b = await cell(page, '2026-11-13').boundingBox();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
  await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(150);
  ok(await page.locator('#dayDlg').evaluate(d => d.open), 'pressione prolungata apre i dettagli e li lascia aperti');
  ok(!(await days(page))['2026-11-13'], 'senza applicare il timbro');
  eq('nessuno scroll orizzontale a 390px', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  ok(errors.length === 0, 'nessun errore', errors.join('|'));
  await ctx.close();
}

console.log('\nRisultato:', pass, 'ok,', fail, 'falliti');
await browser.close();
process.exit(fail ? 1 : 0);
