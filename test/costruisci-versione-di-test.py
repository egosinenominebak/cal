# Crea /tmp/pw/t5.html: copia di calendar_v5.html con un piccolo gancio (window.__presenze)
# che i test usano per leggere dati e statistiche. Il file consegnato non contiene il gancio.
# Uso: python3 costruisci-versione-di-test.py /percorso/calendar_v5.html
import sys, os
src = sys.argv[1]
s = open(src, encoding='utf-8').read()
tail = "  })();\n  </script>"
assert s.count(tail) == 1, "fine dello script non trovata"
hook = ("    window.__presenze = { get store() { return store; }, get job() { return job(); }, periodStats, allStats, balanceOf, historyOf, "
        "holidays, infoOfKey, normalizeAny, withJob, smartStatus, smartPeriodFor, weekSmart, pdfWidth, pdfEnc, pdfFit, pdfWrap };\n")
os.makedirs('/tmp/pw', exist_ok=True)
open('/tmp/pw/t5.html', 'w', encoding='utf-8').write(s.replace(tail, hook + tail))
print('creato /tmp/pw/t5.html')
