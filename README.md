# Conto Economico App

App web (HTML/CSS/JS vanilla, nessuna build) per caricare l'export Excel di un gestionale contabile e visualizzare un Conto Economico riclassificato direttamente nel browser.

## Cosa fa

- Carica un file `.xls`/`.xlsx` con i movimenti contabili (colonne tipo Conto, Tipo, Importo Dare/Avere, ecc.)
- Riconosce automaticamente le colonne anche con intestazioni diverse (alias multipli, italiano/inglese)
- Riclassifica i movimenti in **Costi** e **Ricavi**, raggruppati per sezione del piano dei conti
- Calcola Utile/Perdita d'esercizio e verifica la **quadratura della partita doppia** (Totale Dare = Totale Avere)
- Vista "scheda contabile" per singolo conto con saldo progressivo
- Elenco fatture, pivot mensile Costi/Ricavi, confronto Budget vs Consuntivo, simulazione imposte per regime forfettario

Tutto il calcolo avviene lato client con [xlsx.js](https://github.com/SheetJS/sheetjs); nessun dato viene inviato a un server.

## Come usarlo

Basta aprire `index.html` in un browser (o servirlo con un qualsiasi static server) e caricare un file Excel con i movimenti contabili.

Per provare l'app senza dati reali, usa il file di esempio `esempio.xls` incluso nel repo.

## File

- `index.html` — struttura della pagina
- `style.css` — stile
- `script.js` — parsing del file Excel, riclassificazione, rendering
- `situazione_contabile.sql` — query SQL equivalenti, per chi ha i dati già in un database invece che in Excel
