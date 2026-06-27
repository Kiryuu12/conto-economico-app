'use strict';

// ---------------------------------------------------------------------------
// Italian Chart of Accounts — 3-digit section descriptions
// ---------------------------------------------------------------------------
// Note: labels are best-effort section headers. Accounts whose prefix is not
// listed still render correctly (they're grouped under their own prefix with no
// label) — the totals never depend on this map.
const ITALIAN_COA_MAP = {
  // --- Attività (patrimoniale) ---
  '100': 'Crediti verso clienti',
  '110': 'Immobilizzazioni materiali',
  '120': 'Disponibilità liquide / banche',
  '200': 'Rimanenze',
  '210': 'Crediti diversi',
  '220': 'Attività finanziarie',
  '300': 'Disponibilità liquide',
  '310': 'Ratei e risconti attivi',
  '311': 'Risconti attivi',
  '390': 'Conti transitori / fornitori',
  // --- Passività e patrimonio netto ---
  '400': 'Patrimonio netto',
  '410': 'Riserve / utili',
  '440': 'Debiti tributari (IVA, imposte)',
  '450': 'Debiti verso dipendenti',
  '460': 'Debiti previdenziali',
  '470': 'Acconti da clienti',
  '480': 'Debiti vari',
  '490': 'Ratei e risconti passivi',
  '500': 'Debiti verso fornitori',
  '510': 'Debiti finanziari',
  // --- Ricavi ---
  '600': 'Ricavi delle vendite e delle prestazioni',
  '610': 'Variazione rimanenze prodotti',
  '620': 'Proventi da partecipazioni',
  '630': 'Altri proventi finanziari',
  '640': 'Altri ricavi e proventi',
  '650': 'Ricavi diversi',
  // --- Costi ---
  '660': 'Costi per materie prime e di consumo',
  '670': 'Ammortamenti e svalutazioni',
  '680': 'Costi per materie prime, sussidiarie e di consumo',
  '690': 'Costi per servizi',
  '700': 'Costi per godimento beni di terzi',
  '710': 'Costi del personale',
  '720': 'Ammortamenti e svalutazioni',
  '730': 'Accantonamenti per rischi',
  '740': 'Oneri diversi di gestione',
  '760': 'Oneri diversi di gestione',
  '770': 'Interessi e oneri finanziari',
  '840': 'Proventi finanziari',
  '850': 'Interessi e oneri finanziari',
  '900': 'Imposte, sanzioni e oneri tributari',
};

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let rawData = [];
let budgetValues = {}; // descrizione conto -> importo budget (in memoria per sessione)
let allPeriods = [];
let currentPeriodo = null;

// ---------------------------------------------------------------------------
// Column aliases — ordered from most specific to least specific
// ---------------------------------------------------------------------------
const COLUMN_ALIASES = {
  soggetto_codice:      ['soggetto contabile - codice', 'codice soggetto', 'soggetto - codice', 'soggetto codice', 'cod. soggetto'],
  soggetto_descrizione: ['soggetto contabile - descrizione', 'ragione sociale', 'soggetto - descrizione', 'denominazione', 'soggetto descrizione', 'azienda'],
  codice_fiscale:       ['codice fiscale', 'partita iva', 'p.iva', 'piva', 'cf/piva'],
  periodo:              ['periodo contabile', 'periodo', 'anno', 'esercizio', 'year'],
  numero_movimento:     ['numero movimento', 'n. movimento', 'n movimento', 'nr movimento', 'num movimento', 'n. mov.', 'n mov'],
  data_registrazione:   ['data registrazione', 'data reg.', 'data reg', 'data di registrazione', 'data'],
  tipo:                 ['tipo', 'tipologia', 'type', 'categoria', 'natura'],
  conto:                ['conto', 'codice conto', 'numero conto', 'cod. conto', 'cod conto', 'account'],
  descrizione_conto:    ['descrizione conto', 'desc. conto', 'descrizione del conto', 'nome conto', 'desc conto'],
  importo_dare:         ['importo dare', 'dare', 'debit', 'debito', 'importo_dare'],
  importo_avere:        ['importo avere', 'avere', 'credit', 'credito', 'importo_avere'],
  nominativo:           ['nominativo privato - descrizione', 'nominativo privato', 'nominativo'],
  causale:              ['causale contabile', 'causale', 'descrizione movimento'],
  registro_iva:         ['registro iva', 'reg. iva', 'reg iva', 'registro'],
  protocollo_iva:       ['protocollo iva', 'protocollo', 'n. prot.', 'n prot', 'prot.'],
  data_documento:       ['data documento', 'data doc.', 'data doc', 'data del documento'],
  numero_documento:     ['numero documento', 'n. documento', 'n documento', 'nr documento', 'num documento', 'n. doc.', 'n doc'],
  imponibile:           ['imponibile', 'base imponibile', 'imp.'],
  imposta:              ['imposta', 'iva', 'importo iva'],
  anagrafica:           ['anagrafica - descrizione', 'anagrafica', 'cliente', 'fornitore', 'cliente/fornitore', 'denominazione anagrafica'],
};

// ---------------------------------------------------------------------------
// normalizeHeader — lowercase + collapse whitespace + remove accents
// ---------------------------------------------------------------------------
function normalizeHeader(str) {
  return String(str)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accent marks
    .replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// buildColumnMap — two-pass: exact then partial (header contains alias only)
// ---------------------------------------------------------------------------
function buildColumnMap(headers) {
  const normalized = headers.map(normalizeHeader);
  const map = {};

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    map[field] = null;

    // Pass 1: exact match
    for (let i = 0; i < normalized.length; i++) {
      const nh = normalized[i];
      if (aliases.some(a => normalizeHeader(a) === nh)) {
        map[field] = i;
        break;
      }
    }

    // Pass 2: header contains alias (NOT alias contains header — that caused false positives)
    if (map[field] === null) {
      for (const alias of aliases) {
        const na = normalizeHeader(alias);
        if (na.length < 4) continue; // skip tiny aliases that would over-match
        for (let i = 0; i < normalized.length; i++) {
          if (normalized[i].includes(na)) {
            map[field] = i;
            break;
          }
        }
        if (map[field] !== null) break;
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// findHeaderRowIndex — scans first 10 rows for the one with most matched cols
// ---------------------------------------------------------------------------
function findHeaderRowIndex(sheetData) {
  let bestRow = 0;
  let bestScore = 0;
  const limit = Math.min(10, sheetData.length);
  for (let i = 0; i < limit; i++) {
    const row = sheetData[i];
    if (!Array.isArray(row) || row.every(c => !c)) continue;
    const score = Object.values(buildColumnMap(row)).filter(v => v !== null).length;
    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }
  return bestRow;
}

// ---------------------------------------------------------------------------
// normalizeTipo — handles singular/plural, accents, case
//   "Ricavo" / "ricavi" / "RICAVI" → "Ricavi"
//   "Costo"  / "costi"  / "COSTI"  → "Costi"
//   "Attivita" / "Attività" / "Attivo" → "Attività"
//   "Passivita" / "Passività" / "Passivo" → "Passività"
// ---------------------------------------------------------------------------
function normalizeTipo(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  if (s.startsWith('ricav')) return 'Ricavi';
  if (s.startsWith('cost') || s.startsWith('spes')) return 'Costi';
  if (s.startsWith('attiv')) return 'Attività';
  if (s.startsWith('passiv')) return 'Passività';
  return ''; // unknown — row will be skipped
}

// ---------------------------------------------------------------------------
// parseNumber — JS number or Italian/English formatted string
// ---------------------------------------------------------------------------
function parseNumber(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  let s = String(val).trim().replace(/[€$\s]/g, '');
  if (!s) return 0;

  const hasComma = s.includes(',');
  const hasDot   = s.includes('.');

  if (hasComma && hasDot) {
    // Both present: the LAST separator is the decimal one.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      // Italian: 1.234,56  -> dot = thousands, comma = decimal
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // English: 1,234.56  -> comma = thousands, dot = decimal
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Only comma: treat as decimal separator (1234,56 -> 1234.56)
    s = s.replace(/\./g, '').replace(',', '.');
  }
  // else: only dot or plain digits -> leave as-is (already valid JS number)

  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ---------------------------------------------------------------------------
// parseDate — accepts Excel serial, Date object, or string; returns Date|null
// ---------------------------------------------------------------------------
function parseDate(val) {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) return isNaN(val) ? null : val;
  if (typeof val === 'number') {
    // Excel serial date (days since 1899-12-30)
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return isNaN(d) ? null : d;
  }
  const s = String(val).trim();
  // dd/mm/yyyy or dd-mm-yyyy
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yy] = m;
    if (yy.length === 2) yy = '20' + yy;
    const d = new Date(+yy, +mm - 1, +dd);
    return isNaN(d) ? null : d;
  }
  // yyyy-mm-dd (ISO)
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

// formatDate — Date -> dd/mm/yyyy
function formatDate(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}
function showStatus(html, type /* 'ok' | 'warn' | 'error' */) {
  const el = document.getElementById('statusMessage');
  el.className = 'status-' + type;
  el.innerHTML = html;
  el.classList.remove('style-hidden');
}

function hideStatus() {
  const el = document.getElementById('statusMessage');
  el.classList.add('style-hidden');
  el.className = 'style-hidden';
}

// ---------------------------------------------------------------------------
// normalizeRows — detect header row, map columns, parse all data rows
// ---------------------------------------------------------------------------
function normalizeRows(sheetData) {
  rawData = [];
  budgetValues = {};

  const headerRowIdx = findHeaderRowIndex(sheetData);
  const headers = sheetData[headerRowIdx];
  const colMap = buildColumnMap(headers);

  // Report detection results
  const found = Object.entries(colMap)
    .filter(([, v]) => v !== null)
    .map(([k]) => k);
  const missing = Object.entries(colMap)
    .filter(([, v]) => v === null)
    .map(([k]) => k);

  const critical = ['tipo', 'importo_dare', 'importo_avere'];
  const criticalMissing = critical.filter(f => colMap[f] === null);

  if (criticalMissing.length > 0) {
    showStatus(
      `<strong>Colonne non rilevate:</strong> <code>${criticalMissing.join(', ')}</code><br>
       Colonne trovate nel file: <code>${headers.filter(Boolean).join(', ')}</code><br>
       <small>Riga intestazione rilevata: riga ${headerRowIdx + 1}</small>`,
      'error'
    );
    return;
  }

  if (missing.length > 0) {
    showStatus(
      `<strong>Alcune colonne opzionali non trovate:</strong> <code>${missing.join(', ')}</code> — i dati disponibili verranno comunque visualizzati.`,
      'warn'
    );
  } else {
    hideStatus();
  }

  if (colMap.conto === null) {
    document.getElementById('warningNumeroConto').classList.remove('style-hidden');
  } else {
    document.getElementById('warningNumeroConto').classList.add('style-hidden');
  }

  const get = (row, field) => (colMap[field] !== null ? row[colMap[field]] : '');

  for (let i = headerRowIdx + 1; i < sheetData.length; i++) {
    const row = sheetData[i];
    const tipo = normalizeTipo(get(row, 'tipo'));
    if (!tipo) continue;

    const dare  = parseNumber(get(row, 'importo_dare'));
    const avere = parseNumber(get(row, 'importo_avere'));
    const conto = String(get(row, 'conto') || '').trim();
    if (dare === 0 && avere === 0 && !conto) continue;

    rawData.push({
      soggetto_codice:      String(get(row, 'soggetto_codice')      || '').trim(),
      soggetto_descrizione: String(get(row, 'soggetto_descrizione') || '').trim(),
      codice_fiscale:       String(get(row, 'codice_fiscale')       || '').trim(),
      periodo:              String(get(row, 'periodo')               || '').trim(),
      numero_movimento:     String(get(row, 'numero_movimento')      || '').trim(),
      data_registrazione:   parseDate(get(row, 'data_registrazione')),
      tipo,
      conto,
      descrizione_conto:    String(get(row, 'descrizione_conto')    || '').trim(),
      importo_dare:  dare,
      importo_avere: avere,
      nominativo:        String(get(row, 'nominativo')       || '').trim(),
      causale:           String(get(row, 'causale')          || '').trim(),
      registro_iva:      String(get(row, 'registro_iva')     || '').trim(),
      protocollo_iva:    String(get(row, 'protocollo_iva')   || '').trim().replace(/\.0$/, ''),
      data_documento:    parseDate(get(row, 'data_documento')),
      numero_documento:  String(get(row, 'numero_documento') || '').trim(),
      imponibile:    parseNumber(get(row, 'imponibile')),
      imposta:       parseNumber(get(row, 'imposta')),
      anagrafica:        String(get(row, 'anagrafica')        || '').trim(),
    });
  }

  allPeriods = [...new Set(rawData.map(r => r.periodo).filter(Boolean))].sort();
}

// ---------------------------------------------------------------------------
// getDataForPeriodo
// ---------------------------------------------------------------------------
function getDataForPeriodo(periodo) {
  if (!periodo) return rawData;
  return rawData.filter(r => r.periodo == periodo);
}

// ---------------------------------------------------------------------------
// computeContoEconomico — replicates SQL queries 1–3
// ---------------------------------------------------------------------------
function computeContoEconomico(rows) {
  const ricaviMap = new Map();
  const costiMap  = new Map();

  for (const r of rows) {
    const target = r.tipo === 'Ricavi' ? ricaviMap : r.tipo === 'Costi' ? costiMap : null;
    if (!target) continue;
    const key = r.conto + '|' + r.descrizione_conto;
    const entry = target.get(key) || { conto: r.conto, descrizione_conto: r.descrizione_conto, dare: 0, avere: 0 };
    entry.dare  += r.importo_dare;
    entry.avere += r.importo_avere;
    target.set(key, entry);
  }

  const sortByConto = (entries) =>
    entries.sort((a, b) => a[1].conto.localeCompare(b[1].conto, undefined, { numeric: true }));

  const ricavi = new Map(
    sortByConto([...ricaviMap.entries()].map(([k, v]) => [k, { ...v, importo_netto: v.avere - v.dare }]))
  );
  const costi = new Map(
    sortByConto([...costiMap.entries()].map(([k, v]) => [k, { ...v, importo_netto: v.dare - v.avere }]))
  );

  const totaleRicavi = [...ricavi.values()].reduce((s, v) => s + v.importo_netto, 0);
  const totaleCosti  = [...costi.values()].reduce((s, v) => s + v.importo_netto, 0);
  const utile = totaleRicavi - totaleCosti;

  // Quadratura partita doppia: somma di TUTTI i Dare deve eguagliare tutti gli Avere
  let totDare = 0, totAvere = 0;
  for (const r of rows) { totDare += r.importo_dare; totAvere += r.importo_avere; }
  const sbilancio = totDare - totAvere;
  const quadra = Math.abs(sbilancio) < 0.01;

  return {
    ricavi, costi, totaleRicavi, totaleCosti, utile,
    isUtile: utile >= 0,
    totDare, totAvere, sbilancio, quadra,
  };
}

// ---------------------------------------------------------------------------
// groupByPrefix — group accounts by first 3 chars of account code
// ---------------------------------------------------------------------------
function groupByPrefix(accountsMap) {
  const groups = new Map();
  for (const entry of accountsMap.values()) {
    const prefix = String(entry.conto).slice(0, 3) || entry.conto;
    if (!groups.has(prefix)) {
      groups.set(prefix, { prefix, label: ITALIAN_COA_MAP[prefix] || '', accounts: [], subtotale: 0 });
    }
    const g = groups.get(prefix);
    g.accounts.push(entry);
    g.subtotale += entry.importo_netto;
  }
  return [...groups.values()].sort((a, b) =>
    a.prefix.localeCompare(b.prefix, undefined, { numeric: true })
  );
}

// ---------------------------------------------------------------------------
// formatCurrency — Italian format € 1.234,56
// ---------------------------------------------------------------------------
function formatCurrency(amount) {
  const abs = Math.abs(amount);
  const fmt = abs.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (amount < 0 ? '€ -' : '€ ') + fmt;
}

// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------
function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function createSectionRow(prefix, label) {
  const tr = document.createElement('tr');
  tr.className = 'sezione-principale';
  const td1 = document.createElement('td');
  td1.innerHTML = `<span class="conto-code">${escHtml(prefix)}</span>${label ? ' — ' + escHtml(label) : ''}`;
  const td2 = document.createElement('td');
  td2.className = 'text-right';
  tr.append(td1, td2);
  return tr;
}

function createDetailRow(conto, descrizione, importo) {
  const tr = document.createElement('tr');
  tr.className = 'voce-dettaglio voce-cliccabile';
  tr.title = 'Clicca per visualizzare la scheda contabile';
  const td1 = document.createElement('td');
  td1.innerHTML = `<span class="conto-code">${escHtml(conto)}</span> ${escHtml(descrizione)}`;
  const td2 = document.createElement('td');
  td2.className = 'text-right';
  td2.textContent = formatCurrency(importo);
  tr.append(td1, td2);
  if (conto) {
    tr.addEventListener('click', () => openSchedaContabile(conto));
  }
  return tr;
}

function createSubtotaleRow(prefix, subtotale) {
  const tr = document.createElement('tr');
  tr.className = 'subtotale-sezione';
  const td1 = document.createElement('td');
  td1.textContent = `Totale conto ${prefix}`;
  const td2 = document.createElement('td');
  td2.className = 'text-right';
  td2.textContent = formatCurrency(subtotale);
  tr.append(td1, td2);
  return tr;
}

// ---------------------------------------------------------------------------
// renderAccountSection
// ---------------------------------------------------------------------------
function renderAccountSection(tbodyEl, groupedData) {
  tbodyEl.innerHTML = '';
  if (groupedData.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 2;
    td.style.cssText = 'text-align:center;color:#999;padding:20px';
    td.textContent = 'Nessun dato per il periodo selezionato';
    tr.appendChild(td);
    tbodyEl.appendChild(tr);
    return;
  }
  for (const group of groupedData) {
    tbodyEl.appendChild(createSectionRow(group.prefix, group.label));
    for (const acc of group.accounts) {
      tbodyEl.appendChild(createDetailRow(acc.conto, acc.descrizione_conto, acc.importo_netto));
    }
    tbodyEl.appendChild(createSubtotaleRow(group.prefix, group.subtotale));
  }
}

// ---------------------------------------------------------------------------
// populateDocHeader
// ---------------------------------------------------------------------------
function populateDocHeader(periodo, data) {
  const first = data[0] || {};
  document.getElementById('docNomeSoggetto').textContent = first.soggetto_descrizione || '';
  document.getElementById('docCodiceFiscale').textContent = first.codice_fiscale ? 'C.F./P.IVA: ' + first.codice_fiscale : '';
  document.getElementById('docCodSoggetto').textContent  = first.soggetto_codice   ? 'Codice soggetto: ' + first.soggetto_codice : '';
  document.getElementById('docPeriodo').textContent      = periodo ? `dal 01/01/${periodo} al 31/12/${periodo}` : '';
  document.getElementById('docHeaderInfo').classList.remove('style-hidden');
}

// ---------------------------------------------------------------------------
// populatePareggioSection
// ---------------------------------------------------------------------------
function populatePareggioSection(totaleCosti, totaleRicavi, utile, isUtile) {
  const pareggioAmount = isUtile ? totaleRicavi : totaleCosti;

  const rigaUtilePerdita = document.getElementById('rigaUtilePerdita');
  rigaUtilePerdita.innerHTML = '';

  const td1 = document.createElement('td');
  const td2 = document.createElement('td'); td2.className = 'text-right';
  const td3 = document.createElement('td');
  const td4 = document.createElement('td'); td4.className = 'text-right';

  if (isUtile) {
    td1.innerHTML = "<strong>UTILE D'ESERCIZIO</strong>";
    td2.innerHTML = `<strong>${formatCurrency(utile)}</strong>`;
  } else {
    td3.innerHTML = "<strong>PERDITA D'ESERCIZIO</strong>";
    td4.innerHTML = `<strong>${formatCurrency(Math.abs(utile))}</strong>`;
  }

  rigaUtilePerdita.append(td1, td2, td3, td4);

  document.getElementById('pareggioCostiValue').innerHTML  = `<strong>${formatCurrency(pareggioAmount)}</strong>`;
  document.getElementById('pareggioRicaviValue').innerHTML = `<strong>${formatCurrency(pareggioAmount)}</strong>`;
}

// ---------------------------------------------------------------------------
// renderAll
// ---------------------------------------------------------------------------
function renderAll(periodo) {
  const rows = getDataForPeriodo(periodo);
  const { ricavi, costi, totaleRicavi, totaleCosti, utile, isUtile,
          totDare, totAvere, sbilancio, quadra } = computeContoEconomico(rows);

  renderAccountSection(document.getElementById('costiContainer'),  groupByPrefix(costi));
  renderAccountSection(document.getElementById('ricaviContainer'), groupByPrefix(ricavi));

  document.getElementById('totalCostiValue').innerHTML  = `<strong>${formatCurrency(totaleCosti)}</strong>`;
  document.getElementById('totalRicaviValue').innerHTML = `<strong>${formatCurrency(totaleRicavi)}</strong>`;

  populatePareggioSection(totaleCosti, totaleRicavi, utile, isUtile);
  populateDocHeader(periodo, rows);

  // Rende cliccabili i totali di sezione e mostra il pulsante "Tutte le fatture"
  setupFattureShortcuts(rows);

  // Verifica quadratura partita doppia
  if (quadra) {
    showStatus(
      `<strong>✓ Quadratura verificata.</strong> Totale Dare = Totale Avere = ${formatCurrency(totDare)}. ` +
      `${rows.length} movimenti elaborati.`,
      'ok'
    );
  } else {
    showStatus(
      `<strong>⚠️ Sbilancio rilevato.</strong> Totale Dare ${formatCurrency(totDare)} ` +
      `≠ Totale Avere ${formatCurrency(totAvere)} (differenza ${formatCurrency(sbilancio)}).<br>` +
      `<small>I dati potrebbero essere incompleti o il file troncato. ` +
      `Riesporta la situazione contabile in formato <code>.xlsx</code> dal gestionale.</small>`,
      'warn'
    );
  }
}

// ---------------------------------------------------------------------------
// setupPeriodoSelector
// ---------------------------------------------------------------------------
function setupPeriodoSelector() {
  const container = document.getElementById('periodoSelectorContainer');
  const select    = document.getElementById('periodoSelect');

  select.innerHTML = '';
  // Remove old listener by replacing element clone
  const freshSelect = select.cloneNode(false);
  select.parentNode.replaceChild(freshSelect, select);

  if (allPeriods.length <= 1) {
    container.classList.add('style-hidden');
    return;
  }

  for (const p of allPeriods) {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    freshSelect.appendChild(opt);
  }
  freshSelect.value = allPeriods[allPeriods.length - 1];
  container.classList.remove('style-hidden');

  freshSelect.addEventListener('change', function () {
    currentPeriodo = this.value;
    renderAll(currentPeriodo);
  });
}

// ---------------------------------------------------------------------------
// handleFileLoad
// ---------------------------------------------------------------------------
function handleFileLoad(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const workbook  = XLSX.read(e.target.result, { type: 'array' });
      const sheet     = workbook.Sheets[workbook.SheetNames[0]];
      const sheetData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      if (sheetData.length < 2) {
        showStatus('Il file sembra vuoto o non contiene dati sufficienti.', 'error');
        return;
      }

      normalizeRows(sheetData);

      if (rawData.length === 0) {
        // normalizeRows already showed a status message
        return;
      }

      currentPeriodo = allPeriods.length > 0 ? allPeriods[allPeriods.length - 1] : null;

      setupPeriodoSelector();
      renderAll(currentPeriodo);

      document.getElementById('tablesSection').classList.remove('style-hidden');
      document.getElementById('btnReset').classList.remove('style-hidden');
      // renderAll() ora gestisce il messaggio di stato (quadratura).

    } catch (err) {
      console.error(err);
      showStatus(`<strong>Errore nella lettura del file:</strong> ${escHtml(err.message)}`, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

// ---------------------------------------------------------------------------
// handleReset
// ---------------------------------------------------------------------------
function handleReset() {
  rawData = [];
  allPeriods = [];
  currentPeriodo = null;
  budgetValues = {};

  document.getElementById('costiContainer').innerHTML  = '';
  document.getElementById('ricaviContainer').innerHTML = '';
  document.getElementById('totalCostiValue').innerHTML  = '<strong>€ 0,00</strong>';
  document.getElementById('totalRicaviValue').innerHTML = '<strong>€ 0,00</strong>';
  document.getElementById('rigaUtilePerdita').innerHTML = '';
  document.getElementById('pareggioCostiValue').innerHTML  = '<strong>€ 0,00</strong>';
  document.getElementById('pareggioRicaviValue').innerHTML = '<strong>€ 0,00</strong>';

  ['tablesSection', 'periodoSelectorContainer', 'docHeaderInfo',
   'btnReset', 'warningNumeroConto'].forEach(id => {
    document.getElementById(id).classList.add('style-hidden');
  });

  hideStatus();
  document.getElementById('excelFile').value = '';
}

// ---------------------------------------------------------------------------
// SCHEDA CONTABILE — ledger view for a single account
// Replicates the DK SET "Scheda contabile" layout using available Excel data.
// ---------------------------------------------------------------------------
function openSchedaContabile(conto) {
  const rows = getDataForPeriodo(currentPeriodo)
    .filter(r => r.conto === conto)
    .slice()
    .sort((a, b) => {
      const da = a.data_registrazione ? a.data_registrazione.getTime() : 0;
      const db = b.data_registrazione ? b.data_registrazione.getTime() : 0;
      if (da !== db) return da - db;
      return (parseInt(a.numero_movimento, 10) || 0) - (parseInt(b.numero_movimento, 10) || 0);
    });

  if (rows.length === 0) return;

  const hasDocumenti = rows.some(r => r.registro_iva || r.numero_documento);
  const schedaHtml = buildSchedaContabileHtml(conto, rows);

  if (hasDocumenti) {
    // Due viste disponibili: mostra i tab "Elenco fatture" / "Scheda contabile"
    const fattureHtml = buildElencoFattureHtml(conto, rows);
    const tabs = `
      <div class="scheda-tabs no-print">
        <button class="scheda-tab attivo" data-tab="fatture">📄 Elenco fatture</button>
        <button class="scheda-tab" data-tab="scheda">📒 Scheda contabile</button>
      </div>
      <div class="scheda-tab-panel" data-panel="fatture">${fattureHtml}</div>
      <div class="scheda-tab-panel style-hidden" data-panel="scheda">${schedaHtml}</div>`;
    renderSchedaModal(tabs, /*hasTabs=*/true);
  } else {
    renderSchedaModal(schedaHtml);
  }
}

// ---------------------------------------------------------------------------
// SCHEDA CONTABILE — builds the ledger HTML (running balance)
// ---------------------------------------------------------------------------
function buildSchedaContabileHtml(conto, rows) {
  const first = rows[0];
  const tipo = first.tipo;
  const descrizioneConto = first.descrizione_conto;
  const isCostoAttivo = (tipo === 'Costi' || tipo === 'Attività'); // saldo = Dare - Avere

  // Build movement rows with running balance
  let saldo = 0;
  let totDare = 0, totAvere = 0;
  const bodyRows = rows.map(r => {
    saldo += isCostoAttivo ? (r.importo_dare - r.importo_avere)
                           : (r.importo_avere - r.importo_dare);
    totDare += r.importo_dare;
    totAvere += r.importo_avere;
    return `
      <tr>
        <td>${escHtml(formatDate(r.data_registrazione))}</td>
        <td class="text-center">${escHtml(r.numero_movimento)}</td>
        <td>${escHtml(r.descrizione_conto)}</td>
        <td class="text-right">${r.importo_dare ? formatCurrency(r.importo_dare) : ''}</td>
        <td class="text-right">${r.importo_avere ? formatCurrency(r.importo_avere) : ''}</td>
        <td class="text-right">${formatCurrency(saldo)}</td>
      </tr>`;
  }).join('');

  const periodoLabel = currentPeriodo
    ? `dal 01/01/${currentPeriodo} al 31/12/${currentPeriodo}`
    : '';

  return `
    <div class="scheda-doc" id="schedaDoc">
          <div class="scheda-head">
            <p class="scheda-soggetto">${escHtml(first.soggetto_codice)} ${escHtml(first.soggetto_descrizione)}</p>
            <h2>SCHEDA CONTABILE</h2>
            <p class="scheda-meta">${escHtml(periodoLabel)}</p>
            <p class="scheda-meta scheda-conto-line">
              <strong>Conto:</strong> ${escHtml(conto)} — ${escHtml(descrizioneConto)}
              &nbsp;&nbsp; <strong>Tipo:</strong> ${escHtml(tipo)}
            </p>
          </div>
          <table class="scheda-table">
            <thead>
              <tr>
                <th>Data reg.</th>
                <th class="text-center">N. mov.</th>
                <th>Descrizione movimento</th>
                <th class="text-right">Dare</th>
                <th class="text-right">Avere</th>
                <th class="text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              <tr class="scheda-progr">
                <td colspan="3">Progressivi al 31/12/${currentPeriodo ? currentPeriodo - 1 : ''}</td>
                <td class="text-right">${formatCurrency(0)}</td>
                <td class="text-right">${formatCurrency(0)}</td>
                <td class="text-right">${formatCurrency(0)}</td>
              </tr>
              ${bodyRows}
              <tr class="scheda-progr scheda-totale">
                <td colspan="3"><strong>Progressivi al 31/12/${currentPeriodo || ''}</strong></td>
                <td class="text-right"><strong>${formatCurrency(totDare)}</strong></td>
                <td class="text-right"><strong>${formatCurrency(totAvere)}</strong></td>
                <td class="text-right"><strong>${formatCurrency(saldo)}</strong></td>
              </tr>
            </tbody>
          </table>
          <p class="scheda-footer">${rows.length} movimenti · Saldo finale ${formatCurrency(saldo)}</p>
        </div>`;
}

// ---------------------------------------------------------------------------
// Aggrega imponibile e imposta per numero movimento sull'intero periodo.
// Serve perché su una fattura l'imponibile/imposta stanno sulle righe di
// costo/ricavo, non sulla riga del conto mastro cliente/fornitore.
// ---------------------------------------------------------------------------
function buildImponibileImpostaPerMovimento() {
  const map = new Map(); // numero_movimento -> { imponibile, imposta }
  for (const r of getDataForPeriodo(currentPeriodo)) {
    const key = r.numero_movimento;
    if (!key) continue;
    if (!map.has(key)) map.set(key, { imponibile: 0, imposta: 0 });
    const agg = map.get(key);
    agg.imponibile += r.imponibile;
    agg.imposta    += r.imposta;
  }
  return map;
}

// ---------------------------------------------------------------------------
// ELENCO FATTURE — invoice list for an account that has document data
// ---------------------------------------------------------------------------
function buildElencoFattureHtml(conto, rows, opts) {
  opts = opts || {};
  const aggregato = !!opts.aggregato;       // più conti insieme
  const titolo = opts.titolo || 'ELENCO FATTURE';
  const first = rows[0];
  const tipo = first.tipo;
  const descrizioneConto = first.descrizione_conto;

  // Imponibile/imposta aggregati per movimento (presi anche dalle righe di costo/ricavo)
  const impMap = buildImponibileImpostaPerMovimento();

  // Ordinamento: per protocollo (per registro) oppure per data documento
  const sorted = rows.slice().sort((a, b) => {
    if (opts.ordinaPerProtocollo) {
      // Prima per registro (A1, V1...), poi per numero protocollo crescente
      const ra = a.registro_iva || '';
      const rb = b.registro_iva || '';
      if (ra !== rb) return ra.localeCompare(rb);
      return (parseInt(a.protocollo_iva, 10) || 0) - (parseInt(b.protocollo_iva, 10) || 0);
    }
    const da = (a.data_documento || a.data_registrazione || new Date(0)).getTime();
    const db = (b.data_documento || b.data_registrazione || new Date(0)).getTime();
    if (da !== db) return da - db;
    return (parseInt(a.protocollo_iva, 10) || 0) - (parseInt(b.protocollo_iva, 10) || 0);
  });

  let totImponibile = 0, totImposta = 0, totDoc = 0;
  const bodyRows = sorted.map(r => {
    // Imponibile/imposta: dalla riga stessa, oppure aggregati dal movimento
    const agg = impMap.get(r.numero_movimento) || { imponibile: 0, imposta: 0 };
    const imponibile = r.imponibile || agg.imponibile;
    const imposta    = r.imposta    || agg.imposta;
    // Importo del documento: imponibile+imposta se presenti, altrimenti il movimento
    const importoMov = r.importo_dare || r.importo_avere;
    const totaleDoc = (imponibile || imposta) ? (imponibile + imposta) : importoMov;
    totImponibile += imponibile;
    totImposta += imposta;
    totDoc += totaleDoc;
    return `
      <tr>
        <td class="text-center">${escHtml(r.registro_iva)}</td>
        <td class="text-center">${escHtml(r.protocollo_iva)}</td>
        <td>${escHtml(formatDate(r.data_documento) || formatDate(r.data_registrazione))}</td>
        <td>${escHtml(r.numero_documento)}</td>
        ${aggregato ? `<td class="conto-code">${escHtml(r.conto)}</td>` : ''}
        <td>${escHtml(r.anagrafica || r.nominativo)}</td>
        <td class="text-right">${imponibile ? formatCurrency(imponibile) : ''}</td>
        <td class="text-right">${imposta ? formatCurrency(imposta) : ''}</td>
        <td class="text-right">${formatCurrency(totaleDoc)}</td>
      </tr>`;
  }).join('');

  const periodoLabel = currentPeriodo
    ? `dal 01/01/${currentPeriodo} al 31/12/${currentPeriodo}`
    : '';

  const contoLine = aggregato
    ? `<strong>${escHtml(opts.sottotitolo || '')}</strong>`
    : `<strong>Conto:</strong> ${escHtml(conto)} — ${escHtml(descrizioneConto)} &nbsp;&nbsp; <strong>Tipo:</strong> ${escHtml(tipo)}`;

  const colspanTot = aggregato ? 6 : 5;

  return `
    <div class="scheda-doc" id="schedaDoc">
      <div class="scheda-head">
        <p class="scheda-soggetto">${escHtml(first.soggetto_codice)} ${escHtml(first.soggetto_descrizione)}</p>
        <h2>${escHtml(titolo)}</h2>
        <p class="scheda-meta">${escHtml(periodoLabel)}</p>
        <p class="scheda-meta scheda-conto-line">${contoLine}</p>
      </div>
      <table class="scheda-table">
        <thead>
          <tr>
            <th class="text-center">Reg.</th>
            <th class="text-center">Prot.</th>
            <th>Data doc.</th>
            <th>N. documento</th>
            ${aggregato ? '<th>Conto</th>' : ''}
            <th>Cliente / Anagrafica</th>
            <th class="text-right">Imponibile</th>
            <th class="text-right">Imposta</th>
            <th class="text-right">Totale</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
          <tr class="scheda-progr scheda-totale">
            <td colspan="${colspanTot}"><strong>TOTALE ${sorted.length} documenti</strong></td>
            <td class="text-right"><strong>${formatCurrency(totImponibile)}</strong></td>
            <td class="text-right"><strong>${formatCurrency(totImposta)}</strong></td>
            <td class="text-right"><strong>${formatCurrency(totDoc)}</strong></td>
          </tr>
        </tbody>
      </table>
      <p class="scheda-footer">${sorted.length} fatture / documenti</p>
    </div>`;
}

// ---------------------------------------------------------------------------
// setupFattureShortcuts — totali cliccabili + pulsante "Tutte le fatture"
// ---------------------------------------------------------------------------
function setupFattureShortcuts(rows) {
  const haveFatture = rows.some(r => r.registro_iva || r.numero_documento);

  // Riga TOTALE COSTI / RICAVI cliccabile (la cella è dentro un <tr>)
  const totCostiCell  = document.getElementById('totalCostiValue');
  const totRicaviCell = document.getElementById('totalRicaviValue');

  const makeClickable = (cell, filtro, label) => {
    if (!cell) return;
    const labelCell = cell.previousElementSibling;
    const cells = [labelCell, cell].filter(Boolean);
    if (haveFatture) {
      cells.forEach(c => {
        c.classList.add('totale-cliccabile-cell');
        c.title = `Clicca per vedere tutte le fatture ${label}`;
        c.onclick = () => openElencoFattureSezione(filtro);
      });
    } else {
      cells.forEach(c => {
        c.classList.remove('totale-cliccabile-cell');
        c.title = '';
        c.onclick = null;
      });
    }
  };
  makeClickable(totCostiCell,  'Costi',  'di costo');
  makeClickable(totRicaviCell, 'Ricavi', 'di ricavo');

  // Barra pulsanti sopra la sezione tabelle
  let bar = document.getElementById('fattureBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'fattureBar';
    bar.className = 'fatture-bar no-print';
    const section = document.getElementById('tablesSection');
    section.parentNode.insertBefore(bar, section);
  }
  bar.innerHTML = '';

  // Pulsante "Costi/Ricavi per mese" — sempre disponibile
  const btnPivot = document.createElement('button');
  btnPivot.className = 'btn-fatture btn-pivot';
  btnPivot.textContent = '📊 Costi/Ricavi per mese';
  btnPivot.addEventListener('click', openPivotMensile);
  bar.appendChild(btnPivot);

  // Pulsante "Budget vs Consuntivo" — sempre disponibile
  const btnBudget = document.createElement('button');
  btnBudget.className = 'btn-fatture btn-budget';
  btnBudget.textContent = '🎯 Budget vs Consuntivo';
  btnBudget.addEventListener('click', openBudgetConsuntivo);
  bar.appendChild(btnBudget);

  // Pulsante "Tutte le fatture" — solo se ci sono documenti
  if (haveFatture) {
    const btn = document.createElement('button');
    btn.className = 'btn-fatture';
    btn.textContent = '📄 Tutte le fatture';
    btn.addEventListener('click', () => openElencoFattureSezione(null));
    bar.appendChild(btn);
  }

  // Pulsante "Simulazione Imposte (Forfettario)" — sempre disponibile
  const btnSimImposte = document.createElement('button');
  btnSimImposte.className = 'btn-fatture btn-sim-imposte';
  btnSimImposte.textContent = '🧾 Simulazione Imposte (Forfettario)';
  btnSimImposte.addEventListener('click', openSimulazioneImposte);
  bar.appendChild(btnSimImposte);

  bar.classList.remove('style-hidden');
}

// ---------------------------------------------------------------------------
// Apre l'elenco fatture aggregato per una sezione (Ricavi / Costi) o tutto
// ---------------------------------------------------------------------------
function openElencoFattureSezione(filtroTipo /* 'Ricavi' | 'Costi' | null */) {
  // Conti mastro clienti e fornitori (elenco completo fatture)
  const CONTI_MASTRO = ['100101003', '3901010'];

  let rows = getDataForPeriodo(currentPeriodo)
    .filter(r => r.registro_iva || r.numero_documento);

  let ordinaPerProtocollo = false;
  if (filtroTipo) {
    rows = rows.filter(r => r.tipo === filtroTipo);
  } else {
    // Elenco completo: solo conti mastro clienti/fornitori, ordinato per protocollo
    rows = rows.filter(r => CONTI_MASTRO.includes(r.conto));
    ordinaPerProtocollo = true;
  }

  if (rows.length === 0) {
    renderSchedaModal(`<div class="scheda-doc"><div class="scheda-head">
      <h2>ELENCO FATTURE</h2></div>
      <p style="text-align:center;color:#999;padding:30px">Nessuna fattura disponibile per questa selezione.</p>
      </div>`);
    return;
  }
  const titolo = filtroTipo === 'Ricavi' ? 'ELENCO FATTURE — RICAVI'
               : filtroTipo === 'Costi'  ? 'ELENCO FATTURE — COSTI'
               : 'ELENCO COMPLETO FATTURE — CLIENTI E FORNITORI';
  const sottotitolo = filtroTipo
    ? `Tutte le fatture di tipo ${filtroTipo}`
    : 'Conti mastro clienti (100101003) e fornitori (3901010) — ordinate per protocollo';
  renderSchedaModal(buildElencoFattureHtml(null, rows, {
    aggregato: true, titolo, sottotitolo, ordinaPerProtocollo,
  }));
}

// ---------------------------------------------------------------------------
// PIVOT MENSILE — Costi e Ricavi per mese (come Pivot A)
// netto per riga = Avere - Dare  → ricavi positivi, costi negativi
// ---------------------------------------------------------------------------
const MESI_LABEL = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];

function openPivotMensile() {
  const rows = getDataForPeriodo(currentPeriodo)
    .filter(r => r.tipo === 'Ricavi' || r.tipo === 'Costi');
  if (rows.length === 0) {
    renderSchedaModal(`<div class="scheda-doc"><div class="scheda-head">
      <h2>COSTI E RICAVI PER MESE</h2></div>
      <p style="text-align:center;color:#999;padding:30px">Nessun dato di Conto Economico per il periodo selezionato.</p>
      </div>`);
    return;
  }
  renderSchedaModal(buildPivotMensileHtml(rows));
}

function buildPivotMensileHtml(rows) {
  const first = rows[0];

  // Aggrega: tipo -> descrizione conto -> [12 mesi]
  function aggregaTipo(tipo) {
    const map = new Map(); // descrizione -> array 12 mesi
    for (const r of rows) {
      if (r.tipo !== tipo) continue;
      const mese = r.data_registrazione ? r.data_registrazione.getMonth() : null;
      if (mese === null) continue;
      const key = r.descrizione_conto || r.conto;
      if (!map.has(key)) map.set(key, new Array(12).fill(0));
      map.get(key)[mese] += (r.importo_avere - r.importo_dare); // netto
    }
    // ordina per descrizione
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }

  const ricavi = aggregaTipo('Ricavi');
  const costi  = aggregaTipo('Costi');

  const totMese = new Array(12).fill(0);

  // Costruisce le righe HTML di una sezione e accumula i totali mensili
  function sezioneRows(entries) {
    return entries.map(([desc, mesi]) => {
      let totRiga = 0;
      const celle = mesi.map((v, i) => {
        totMese[i] += v;
        totRiga += v;
        return `<td class="text-right ${v < 0 ? 'val-neg' : ''}">${v ? formatCurrency(v) : ''}</td>`;
      }).join('');
      return `
        <tr>
          <td>${escHtml(desc)}</td>
          ${celle}
          <td class="text-right ${totRiga < 0 ? 'val-neg' : ''}"><strong>${formatCurrency(totRiga)}</strong></td>
        </tr>`;
    }).join('');
  }

  const ricaviHtml = sezioneRows(ricavi);
  const costiHtml  = sezioneRows(costi);

  // Riga totale complessivo per mese (= risultato del mese)
  let totAnno = 0;
  const totCelle = totMese.map(v => {
    totAnno += v;
    return `<td class="text-right ${v < 0 ? 'val-neg' : ''}"><strong>${formatCurrency(v)}</strong></td>`;
  }).join('');

  const headMesi = MESI_LABEL.map(m => `<th class="text-right">${m}</th>`).join('');

  const periodoLabel = currentPeriodo
    ? `dal 01/01/${currentPeriodo} al 31/12/${currentPeriodo}`
    : '';

  return `
    <div class="scheda-doc" id="schedaDoc">
      <div class="scheda-head">
        <p class="scheda-soggetto">${escHtml(first.soggetto_codice)} ${escHtml(first.soggetto_descrizione)}</p>
        <h2>COSTI E RICAVI PER MESE</h2>
        <p class="scheda-meta">${escHtml(periodoLabel)}</p>
        <p class="scheda-meta">Ricavi positivi · Costi negativi · Importo netto (Avere − Dare)</p>
      </div>
      <div class="pivot-scroll">
        <table class="scheda-table pivot-table">
          <thead>
            <tr>
              <th>Descrizione conto</th>
              ${headMesi}
              <th class="text-right">Totale</th>
            </tr>
          </thead>
          <tbody>
            <tr class="pivot-sezione"><td colspan="14">RICAVI</td></tr>
            ${ricaviHtml}
            <tr class="pivot-sezione"><td colspan="14">COSTI</td></tr>
            ${costiHtml}
            <tr class="scheda-progr scheda-totale">
              <td><strong>Totale complessivo</strong></td>
              ${totCelle}
              <td class="text-right ${totAnno < 0 ? 'val-neg' : ''}"><strong>${formatCurrency(totAnno)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="scheda-footer">Risultato d'esercizio: ${formatCurrency(totAnno)} ${totAnno >= 0 ? '(utile)' : '(perdita)'}</p>
    </div>`;
}

// ---------------------------------------------------------------------------
// BUDGET vs CONSUNTIVO (come Pivot B)
// COGE = consuntivo netto (Avere - Dare) · DIFFERENZA = Budget - COGE
// Budget inserito a mano, tenuto in memoria per la sessione.
// ---------------------------------------------------------------------------
function openBudgetConsuntivo() {
  const rows = getDataForPeriodo(currentPeriodo)
    .filter(r => r.tipo === 'Ricavi' || r.tipo === 'Costi');
  if (rows.length === 0) {
    renderSchedaModal(`<div class="scheda-doc"><div class="scheda-head">
      <h2>BUDGET vs CONSUNTIVO</h2></div>
      <p style="text-align:center;color:#999;padding:30px">Nessun dato di Conto Economico per il periodo selezionato.</p>
      </div>`);
    return;
  }
  renderSchedaModal(buildBudgetHtml(rows));
  setupBudgetInputs();
}

function buildBudgetHtml(rows) {
  const first = rows[0];

  // COGE per conto (netto Avere - Dare), separato per tipo
  function aggrega(tipo) {
    const map = new Map();
    for (const r of rows) {
      if (r.tipo !== tipo) continue;
      const key = r.descrizione_conto || r.conto;
      map.set(key, (map.get(key) || 0) + (r.importo_avere - r.importo_dare));
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }

  const ricavi = aggrega('Ricavi');
  const costi  = aggrega('Costi');

  function riga(tipo, desc, coge) {
    const budget = budgetValues[desc] || 0;
    const diff = budget - coge;
    return `
      <tr data-conto="${escHtml(desc)}">
        <td>${escHtml(tipo)}</td>
        <td>${escHtml(desc)}</td>
        <td class="text-right">
          <input type="text" class="budget-input" data-conto="${escHtml(desc)}"
                 value="${budget ? formatNumberPlain(budget) : ''}" placeholder="0,00">
        </td>
        <td class="text-right ${coge < 0 ? 'val-neg' : ''}">${formatCurrency(coge)}</td>
        <td class="text-right diff-cell ${diff < 0 ? 'val-neg' : ''}">${formatCurrency(diff)}</td>
      </tr>`;
  }

  const ricaviHtml = ricavi.map(([d, c]) => riga('Ricavi', d, c)).join('');
  const costiHtml  = costi.map(([d, c]) => riga('Costi', d, c)).join('');

  // Totali iniziali
  const totCoge = [...ricavi, ...costi].reduce((s, [, c]) => s + c, 0);
  const totBudget = [...ricavi, ...costi].reduce((s, [d]) => s + (budgetValues[d] || 0), 0);
  const totDiff = totBudget - totCoge;

  const periodoLabel = currentPeriodo
    ? `dal 01/01/${currentPeriodo} al 31/12/${currentPeriodo}`
    : '';

  return `
    <div class="scheda-doc" id="schedaDoc">
      <div class="scheda-head">
        <p class="scheda-soggetto">${escHtml(first.soggetto_codice)} ${escHtml(first.soggetto_descrizione)}</p>
        <h2>BUDGET vs CONSUNTIVO</h2>
        <p class="scheda-meta">${escHtml(periodoLabel)}</p>
        <p class="scheda-meta">Inserisci il budget · COGE = consuntivo · Differenza = Budget − COGE</p>
      </div>
      <table class="scheda-table budget-table">
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Descrizione conto</th>
            <th class="text-right">Budget</th>
            <th class="text-right">COGE (consuntivo)</th>
            <th class="text-right">Differenza</th>
          </tr>
        </thead>
        <tbody>
          <tr class="pivot-sezione"><td colspan="5">RICAVI</td></tr>
          ${ricaviHtml}
          <tr class="pivot-sezione"><td colspan="5">COSTI</td></tr>
          ${costiHtml}
          <tr class="scheda-progr scheda-totale" id="budgetTotalRow">
            <td colspan="2"><strong>Totale complessivo</strong></td>
            <td class="text-right"><strong id="totBudgetCell">${formatCurrency(totBudget)}</strong></td>
            <td class="text-right ${totCoge < 0 ? 'val-neg' : ''}"><strong>${formatCurrency(totCoge)}</strong></td>
            <td class="text-right ${totDiff < 0 ? 'val-neg' : ''}"><strong id="totDiffCell">${formatCurrency(totDiff)}</strong></td>
          </tr>
        </tbody>
      </table>
      <p class="scheda-footer">I valori di budget restano memorizzati finché il file è caricato.</p>
    </div>`;
}

// Aggancia gli input del budget: ricalcolo live di differenza e totali
function setupBudgetInputs() {
  const overlay = document.getElementById('schedaOverlay');
  if (!overlay) return;
  const inputs = overlay.querySelectorAll('.budget-input');

  const recalc = () => {
    let totBudget = 0, totCoge = 0;
    overlay.querySelectorAll('tbody tr[data-conto]').forEach(tr => {
      const desc = tr.getAttribute('data-conto');
      const budget = budgetValues[desc] || 0;
      // COGE dalla cella (4ª colonna) — la rileggo dal testo non è affidabile,
      // quindi la ricalcolo qui sotto separatamente
    });
    // Ricalcolo COGE dai dati (più sicuro che leggere il DOM)
    const rows = getDataForPeriodo(currentPeriodo).filter(r => r.tipo === 'Ricavi' || r.tipo === 'Costi');
    const cogeMap = {};
    for (const r of rows) {
      const k = r.descrizione_conto || r.conto;
      cogeMap[k] = (cogeMap[k] || 0) + (r.importo_avere - r.importo_dare);
    }
    overlay.querySelectorAll('tbody tr[data-conto]').forEach(tr => {
      const desc = tr.getAttribute('data-conto');
      const coge = cogeMap[desc] || 0;
      const budget = budgetValues[desc] || 0;
      const diff = budget - coge;
      const diffCell = tr.querySelector('.diff-cell');
      if (diffCell) {
        diffCell.textContent = formatCurrency(diff);
        diffCell.classList.toggle('val-neg', diff < 0);
      }
      totBudget += budget;
      totCoge += coge;
    });
    const totDiff = totBudget - totCoge;
    const tb = document.getElementById('totBudgetCell');
    const td = document.getElementById('totDiffCell');
    if (tb) tb.textContent = formatCurrency(totBudget);
    if (td) { td.textContent = formatCurrency(totDiff); td.parentElement.classList.toggle('val-neg', totDiff < 0); }
  };

  inputs.forEach(inp => {
    inp.addEventListener('input', () => {
      const desc = inp.getAttribute('data-conto');
      const val = parseNumber(inp.value);
      if (val) budgetValues[desc] = val;
      else delete budgetValues[desc];
      recalc();
    });
  });
}

// formatNumberPlain — numero senza simbolo €, formato italiano (per gli input)
function formatNumberPlain(n) {
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderSchedaModal(innerHtml, hasTabs) {
  const html = `
    <div class="scheda-overlay" id="schedaOverlay">
      <div class="scheda-modal">
        <div class="scheda-toolbar no-print">
          <button class="btn-close-scheda" id="btnCloseScheda">✕ Chiudi</button>
        </div>
        ${innerHtml}
      </div>
    </div>`;

  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container.firstElementChild);

  const overlay = document.getElementById('schedaOverlay');
  document.getElementById('btnCloseScheda').addEventListener('click', closeSchedaContabile);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSchedaContabile(); });
  document.addEventListener('keydown', schedaEscHandler);
  document.body.style.overflow = 'hidden';
  document.body.classList.add('scheda-aperta');

  if (hasTabs) {
    const tabBtns = overlay.querySelectorAll('.scheda-tab');
    const panels = overlay.querySelectorAll('.scheda-tab-panel');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-tab');
        tabBtns.forEach(b => b.classList.toggle('attivo', b === btn));
        panels.forEach(p => p.classList.toggle('style-hidden',
          p.getAttribute('data-panel') !== target));
      });
    });
  }
}

function schedaEscHandler(e) {
  if (e.key === 'Escape') closeSchedaContabile();
}

function closeSchedaContabile() {
  const overlay = document.getElementById('schedaOverlay');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', schedaEscHandler);
  document.body.style.overflow = '';
  document.body.classList.remove('scheda-aperta');
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------
function openSimulazioneImposte() {
  const rows = getDataForPeriodo(currentPeriodo);

  // Calcola totaleRicavi come avere − dare (coerente con computeContoEconomico)
  const ricaviMap = new Map();
  for (const r of rows.filter(r => r.tipo === 'Ricavi')) {
    const key = r.conto + '|' + r.descrizione_conto;
    const entry = ricaviMap.get(key) || { dare: 0, avere: 0 };
    entry.dare  += r.importo_dare;
    entry.avere += r.importo_avere;
    ricaviMap.set(key, entry);
  }
  const totaleRicavi = [...ricaviMap.values()].reduce((s, v) => s + (v.avere - v.dare), 0);

  // Ricavi mensili (array 12 mesi, indice 0=Gen)
  const ricaviMensili = new Array(12).fill(0);
  for (const r of rows.filter(r => r.tipo === 'Ricavi')) {
    const mese = r.data_registrazione ? r.data_registrazione.getMonth() : null;
    if (mese === null) continue;
    ricaviMensili[mese] += (r.importo_avere - r.importo_dare);
  }

  const html = `
    <div class="scheda-doc">
      <div class="scheda-head">
        <h2>🧾 Simulazione Imposte &mdash; Regime Forfettario</h2>
      </div>

      <div style="margin-top:20px;display:flex;flex-direction:column;gap:16px;max-width:480px;">

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;">
          <span style="color:#64748b;font-size:0.9rem;">Ricavi totali del periodo</span>
          <span style="font-weight:700;font-size:1.1rem;color:#1e293b;">${formatNumberPlain(totaleRicavi)} &euro;</span>
        </div>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;">
          <label style="display:block;color:#64748b;font-size:0.9rem;margin-bottom:10px;">Coefficiente di redditività</label>
          <div style="display:flex;align-items:center;gap:8px;">
            <input type="number" id="simCoeffB" class="budget-input"
              min="1" max="100" step="0.1" placeholder="es. 67"
              style="width:100px;font-size:1rem;padding:8px 12px;">
            <span style="color:#64748b;font-size:1rem;">%</span>
          </div>
        </div>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;">
          <p style="color:#64748b;font-size:0.9rem;margin:0 0 12px 0;">Sei in regime forfettario da:</p>
          <div style="display:flex;gap:24px;">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.95rem;color:#1e293b;">
              <input type="radio" name="simAnniRegime" value="lt5" style="accent-color:#2563eb;width:16px;height:16px;">
              Meno di 5 anni
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.95rem;color:#1e293b;">
              <input type="radio" name="simAnniRegime" value="gte5" style="accent-color:#2563eb;width:16px;height:16px;">
              5 anni o più
            </label>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:14px;">
          <button id="btnCalcolaImposte" style="
            padding:10px 28px;background:#2563eb;color:#fff;border:none;
            border-radius:8px;font-size:0.95rem;cursor:pointer;font-family:inherit;
            font-weight:600;letter-spacing:0.01em;">
            Calcola
          </button>
          <span id="simErrore" style="color:#e74c3c;font-size:0.85rem;display:none;">
            Compila tutti i campi prima di procedere.
          </span>
        </div>

      </div>

      <div id="simTabs" style="display:none;margin-top:32px;">
        <div class="scheda-tabs" style="padding:0;">
          <button class="scheda-tab attivo" data-tab="annuale">Simulazione Annuale</button>
          <button class="scheda-tab" data-tab="mensile">Simulazione Mensile</button>
        </div>
        <div class="scheda-tab-panel" data-panel="annuale" style="padding-top:20px;">
          <div id="simRisultati" style="max-width:480px;"></div>
        </div>
        <div class="scheda-tab-panel style-hidden" data-panel="mensile" style="padding-top:20px;">
          <div id="simRisultatiMensili" class="pivot-scroll"></div>
        </div>
      </div>

      <p style="margin-top:24px;font-size:0.78rem;color:#94a3b8;">
        ⚠️ Simulazione indicativa. Verificare con il proprio commercialista.
      </p>
    </div>`;

  renderSchedaModal(html, true);

  document.getElementById('btnCalcolaImposte').addEventListener('click', () => {
    const rawB = parseFloat(document.getElementById('simCoeffB').value);
    const regime = document.querySelector('input[name="simAnniRegime"]:checked')?.value;
    const errore = document.getElementById('simErrore');

    if (isNaN(rawB) || rawB <= 0 || !regime) {
      errore.style.display = 'inline';
      return;
    }
    errore.style.display = 'none';

    const B = rawB / 100;
    const C = totaleRicavi * B;
    const aliquota = regime === 'lt5' ? 0.05 : 0.15;
    const E = C * aliquota;
    const labelAliquota = regime === 'lt5' ? '5% (primo quinquennio)' : '15% (ordinaria)';
    const pctLabel = regime === 'lt5' ? '5%' : '15%';

    // Mostra i tab
    document.getElementById('simTabs').style.display = 'block';

    // --- TAB ANNUALE ---
    document.getElementById('simRisultati').innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;justify-content:space-between;padding:10px 16px;border-radius:8px;background:#f8fafc;">
          <span style="color:#64748b;font-size:0.9rem;">Ricavi totali</span>
          <span style="color:#1e293b;">${formatNumberPlain(totaleRicavi)} &euro;</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:10px 16px;border-radius:8px;">
          <span style="color:#64748b;font-size:0.9rem;">Coefficiente di redditività</span>
          <span style="color:#1e293b;">${rawB.toFixed(1)}%</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:10px 16px;border-radius:8px;background:#f8fafc;">
          <span style="color:#64748b;font-size:0.9rem;">Imponibile fiscale</span>
          <span style="color:#1e293b;">${formatNumberPlain(C)} &euro;</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:10px 16px;border-radius:8px;">
          <span style="color:#64748b;font-size:0.9rem;">Aliquota applicata</span>
          <span style="color:#1e293b;">${labelAliquota}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:14px 16px;border-radius:10px;background:#eff6ff;border:1.5px solid #bfdbfe;margin-top:4px;">
          <span style="color:#1d4ed8;font-weight:700;font-size:1rem;">Imposta dovuta</span>
          <span style="color:#1d4ed8;font-weight:700;font-size:1.15rem;">${formatNumberPlain(E)} &euro;</span>
        </div>
      </div>`;

    // --- TAB MENSILE ---
    const imponibileMensili = ricaviMensili.map(v => v * B);
    const accMensili = imponibileMensili.map(v => v * aliquota);
    let running = 0;
    const totAccMensili = accMensili.map(v => { running += v; return running; });

    const thMesi = MESI_LABEL.map(m => `<th class="text-right">${m}</th>`).join('');

    const cellsRicavi = ricaviMensili.map(v =>
      `<td class="text-right">${v ? formatNumberPlain(v) : ''}</td>`).join('');
    const totRicavi = ricaviMensili.reduce((s, v) => s + v, 0);

    const cellsImponibile = imponibileMensili.map(v =>
      `<td class="text-right" style="color:#475569;">${v ? formatNumberPlain(v) : ''}</td>`).join('');
    const totImponibile = imponibileMensili.reduce((s, v) => s + v, 0);

    const cellsAcc = accMensili.map(v =>
      `<td class="text-right" style="color:#b45309;">${v ? formatNumberPlain(v) : ''}</td>`).join('');
    const totAcc = accMensili.reduce((s, v) => s + v, 0);

    const cellsTotAcc = totAccMensili.map(v =>
      `<td class="text-right" style="font-weight:700;color:#15803d;">${formatNumberPlain(v)}</td>`).join('');

    document.getElementById('simRisultatiMensili').innerHTML = `
      <table class="pivot-table" style="min-width:900px;">
        <thead>
          <tr>
            <th style="text-align:left;min-width:180px;"></th>
            ${thMesi}
            <th class="text-right">Totale</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="font-weight:600;color:#1e293b;padding:9px 12px;">Ricavi</td>
            ${cellsRicavi}
            <td class="text-right" style="font-weight:600;">${formatNumberPlain(totRicavi)}</td>
          </tr>

          <tr style="background:#f8fafc;">
            <td style="padding:9px 12px;color:#475569;">
              Imponibile
              <span style="margin-left:6px;font-size:0.78rem;color:#94a3b8;">× ${rawB.toFixed(1)}%</span>
            </td>
            ${cellsImponibile}
            <td class="text-right" style="color:#475569;">${formatNumberPlain(totImponibile)}</td>
          </tr>

          <tr style="background:#fefce8;border-top:2px solid #fde68a;">
            <td style="padding:9px 12px;color:#92400e;">
              <span style="font-weight:600;">Da accantonare</span>
              <span style="margin-left:8px;font-size:0.8rem;background:#fde68a;color:#92400e;border-radius:4px;padding:1px 6px;">${pctLabel}</span>
            </td>
            ${cellsAcc}
            <td class="text-right" style="font-weight:600;color:#b45309;">${formatNumberPlain(totAcc)}</td>
          </tr>

          <tr>
            <td style="padding:9px 12px;color:#94a3b8;font-size:0.88rem;">Riduzione per vers.</td>
            ${MESI_LABEL.map(() => `<td class="text-right" style="color:#cbd5e1;">&ndash;</td>`).join('')}
            <td class="text-right" style="color:#cbd5e1;">&ndash;</td>
          </tr>

          <tr style="background:#f0fdf4;border-top:2px solid #bbf7d0;border-bottom:2px solid #bbf7d0;">
            <td style="padding:10px 12px;font-weight:700;color:#15803d;border-left:4px solid #22c55e;">
              Totale Accantonato
            </td>
            ${cellsTotAcc}
            <td class="text-right" style="font-weight:700;color:#15803d;">${formatNumberPlain(totAccMensili[11])}</td>
          </tr>

          <tr style="background:#f8fafc;border-top:2px solid #e2e8f0;">
            <td colspan="${14}" style="padding:8px 12px;font-weight:600;color:#64748b;font-size:0.85rem;letter-spacing:0.05em;text-transform:uppercase;">Da versare</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;color:#64748b;font-size:0.9rem;">Saldo Anno Precedente</td>
            ${MESI_LABEL.map(() => `<td class="text-right" style="color:#cbd5e1;">&ndash;</td>`).join('')}
            <td class="text-right" style="color:#cbd5e1;">&ndash;</td>
          </tr>
          <tr style="background:#f8fafc;">
            <td style="padding:8px 12px;color:#64748b;font-size:0.9rem;">Acconto Anno Corrente</td>
            ${MESI_LABEL.map(() => `<td class="text-right" style="color:#cbd5e1;">&ndash;</td>`).join('')}
            <td class="text-right" style="color:#cbd5e1;">&ndash;</td>
          </tr>

          <tr style="border-top:2px solid #e2e8f0;">
            <td style="padding:10px 12px;font-weight:700;color:#1e293b;">TT Da Versare</td>
            ${MESI_LABEL.map(() => `<td class="text-right" style="color:#94a3b8;">0</td>`).join('')}
            <td class="text-right" style="color:#94a3b8;">0</td>
          </tr>
        </tbody>
      </table>`;
  });
}

// ---------------------------------------------------------------------------
function init() {
  document.getElementById('excelFile').addEventListener('change', handleFileLoad);
  document.getElementById('btnReset').addEventListener('click', handleReset);
}

document.addEventListener('DOMContentLoaded', init);
