// Calcola i contrasti WCAG dei colori di stato (testo >= 4,5; bordi e strisce >= 3), tema chiaro e scuro.
// Uso: node contrasti.mjs /percorso/calendar_v5.html
import fs from 'fs';
const css = fs.readFileSync(process.argv[2] || 'calendar_v5.html','utf8');
const block = (re) => { const m = css.match(re); return m[1]; };
const parse = txt => Object.fromEntries([...txt.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]));
const light = parse(block(/:root \{\s*color-scheme: light;([\s\S]*?)\n    \}/));
const dark = parse(block(/:root\[data-theme="dark"\] \{([\s\S]*?)\n    \}/));
const lum = h => { const c=[1,3,5].map(i=>parseInt(h.substr(i,2),16)/255).map(v=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)); return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; };
const cr = (a,b) => { const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };
let bad = 0;
const chk = (name, a, b, min) => { const r = cr(a,b); const ok = r >= min; if(!ok) bad++; console.log((ok?'  ok  ':'  FAIL')+' '+name.padEnd(46)+r.toFixed(2)+' (>= '+min+')'); };
for (const [tn, t] of [['LIGHT', light], ['DARK', dark]]) {
  console.log('--', tn);
  chk('ink on panel', t.ink, t.panel, 4.5);
  chk('ink on bg', t.ink, t.bg, 4.5);
  chk('muted on panel', t.muted, t.panel, 4.5);
  chk('muted on bg', t.muted, t.bg, 4.5);
  chk('muted on panel-2', t.muted, t['panel-2'], 4.5);
  chk('warn on panel', t.warn, t.panel, 4.5);
  chk('danger on panel', t.danger, t.panel, 4.5);
  chk('primary-ink on primary', t['primary-ink'], t.primary, 4.5);
  chk('toast-ink on toast-bg', t['toast-ink'], t['toast-bg'], 4.5);
  chk('focus ring vs panel (UI 3:1)', t.focus, t.panel, 3);
  chk('rule-strong vs panel (UI 3:1)', t['rule-strong'], t.panel, 3);
  chk('warn-line vs panel (UI 3:1)', t['warn-line'], t.panel, 3);
  for (const k of ['work','smart','ferie','permesso','exfest','malattia','chiusura','festivo']) {
    chk(`${k}: label (fg on tint)`, t['fg-'+k], t['bg-'+k], 4.5);
    chk(`${k}: stripe vs panel (UI 3:1)`, t['c-'+k], t.panel, 3);
  }
}
console.log(bad ? `\n${bad} coppie sotto soglia` : '\nTutte le coppie sopra soglia');
