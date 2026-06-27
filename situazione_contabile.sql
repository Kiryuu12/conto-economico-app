-- ============================================================
--  Azienda Demo SRL
--  Situazione Contabile 2025 — Query SQL
-- ============================================================
--  Tabella sorgente: movimenti_contabili
--  Struttura attesa:
--    soggetto_codice       VARCHAR   -- es. '00000001'
--    soggetto_descrizione  VARCHAR   -- es. 'Azienda Demo SRL'
--    codice_fiscale        VARCHAR
--    periodo               INTEGER   -- anno es. 2025
--    numero_movimento      INTEGER
--    data_registrazione    DATE
--    tipo                  VARCHAR   -- 'Ricavi' | 'Costi' | 'Attività' | 'Passività'
--    conto                 VARCHAR   -- codice conto es. '600101010'
--    descrizione_conto     VARCHAR
--    importo_dare          DECIMAL(15,2)
--    importo_avere         DECIMAL(15,2)
--    nominativo            VARCHAR   NULL
--    causale               VARCHAR   NULL
--    registro_iva          VARCHAR   NULL
--    protocollo_iva        INTEGER   NULL
--    data_documento        DATE      NULL
--    numero_documento      VARCHAR   NULL
--    imponibile            DECIMAL(15,2) NULL
--    imposta               DECIMAL(15,2) NULL
--    anagrafica            VARCHAR   NULL
-- ============================================================


-- ------------------------------------------------------------
-- 1. CONTO ECONOMICO — RICAVI
--    Logica: per i conti di tipo 'Ricavi' il netto è Avere - Dare
-- ------------------------------------------------------------
SELECT
    conto                                           AS codice_conto,
    descrizione_conto,
    SUM(importo_avere)                              AS totale_avere,
    SUM(importo_dare)                               AS totale_dare,
    SUM(importo_avere) - SUM(importo_dare)          AS importo_netto
FROM movimenti_contabili
WHERE tipo      = 'Ricavi'
  AND periodo   = 2025
GROUP BY conto, descrizione_conto
ORDER BY conto;


-- ------------------------------------------------------------
-- 2. CONTO ECONOMICO — COSTI
--    Logica: per i conti di tipo 'Costi' il netto è Dare - Avere
-- ------------------------------------------------------------
SELECT
    conto                                           AS codice_conto,
    descrizione_conto,
    SUM(importo_dare)                               AS totale_dare,
    SUM(importo_avere)                              AS totale_avere,
    SUM(importo_dare) - SUM(importo_avere)          AS importo_netto
FROM movimenti_contabili
WHERE tipo      = 'Costi'
  AND periodo   = 2025
GROUP BY conto, descrizione_conto
ORDER BY conto;


-- ------------------------------------------------------------
-- 3. TOTALI CONTO ECONOMICO (Ricavi, Costi, Utile)
-- ------------------------------------------------------------
SELECT
    tipo,
    SUM(importo_dare)                               AS totale_dare,
    SUM(importo_avere)                              AS totale_avere,
    CASE
        WHEN tipo = 'Ricavi' THEN SUM(importo_avere) - SUM(importo_dare)
        WHEN tipo = 'Costi'  THEN SUM(importo_dare)  - SUM(importo_avere)
    END                                             AS importo_netto
FROM movimenti_contabili
WHERE tipo    IN ('Ricavi', 'Costi')
  AND periodo = 2025
GROUP BY tipo

UNION ALL

-- Utile d'esercizio = Totale Ricavi - Totale Costi
SELECT
    'Utile d''esercizio'                            AS tipo,
    NULL                                            AS totale_dare,
    NULL                                            AS totale_avere,
    (
        SELECT SUM(importo_avere) - SUM(importo_dare)
        FROM movimenti_contabili
        WHERE tipo = 'Ricavi' AND periodo = 2025
    ) - (
        SELECT SUM(importo_dare) - SUM(importo_avere)
        FROM movimenti_contabili
        WHERE tipo = 'Costi' AND periodo = 2025
    )                                               AS importo_netto

ORDER BY tipo;


-- ------------------------------------------------------------
-- 4. CONTI PATRIMONIALI — ATTIVITÀ
--    Logica: saldo = Dare - Avere
-- ------------------------------------------------------------
SELECT
    conto                                           AS codice_conto,
    descrizione_conto,
    SUM(importo_dare)                               AS totale_dare,
    SUM(importo_avere)                              AS totale_avere,
    SUM(importo_dare) - SUM(importo_avere)          AS saldo
FROM movimenti_contabili
WHERE tipo      = 'Attività'
  AND periodo   = 2025
GROUP BY conto, descrizione_conto
ORDER BY conto;


-- ------------------------------------------------------------
-- 5. CONTI PATRIMONIALI — PASSIVITÀ
--    Logica: saldo = Avere - Dare
-- ------------------------------------------------------------
SELECT
    conto                                           AS codice_conto,
    descrizione_conto,
    SUM(importo_dare)                               AS totale_dare,
    SUM(importo_avere)                              AS totale_avere,
    SUM(importo_avere) - SUM(importo_dare)          AS saldo
FROM movimenti_contabili
WHERE tipo      = 'Passività'
  AND periodo   = 2025
GROUP BY conto, descrizione_conto
ORDER BY conto;


-- ------------------------------------------------------------
-- 6. SITUAZIONE CONTABILE COMPLETA A SEZIONI
--    Vista unica con tipo, conto, importo netto — usabile
--    come base per qualsiasi report
-- ------------------------------------------------------------
SELECT
    tipo,
    conto                                           AS codice_conto,
    descrizione_conto,
    SUM(importo_dare)                               AS totale_dare,
    SUM(importo_avere)                              AS totale_avere,
    CASE
        WHEN tipo IN ('Costi', 'Attività')
            THEN SUM(importo_dare)  - SUM(importo_avere)
        WHEN tipo IN ('Ricavi', 'Passività')
            THEN SUM(importo_avere) - SUM(importo_dare)
    END                                             AS importo_netto
FROM movimenti_contabili
WHERE periodo = 2025
GROUP BY tipo, conto, descrizione_conto
ORDER BY
    CASE tipo
        WHEN 'Ricavi'    THEN 1
        WHEN 'Costi'     THEN 2
        WHEN 'Attività'  THEN 3
        WHEN 'Passività' THEN 4
    END,
    conto;


-- ------------------------------------------------------------
-- 7. VERIFICA QUADRATURA
--    Totale Dare deve essere uguale a Totale Avere
-- ------------------------------------------------------------
SELECT
    SUM(importo_dare)                               AS totale_dare,
    SUM(importo_avere)                              AS totale_avere,
    SUM(importo_dare) - SUM(importo_avere)          AS differenza,
    CASE
        WHEN ABS(SUM(importo_dare) - SUM(importo_avere)) < 0.01
            THEN 'OK — Partita doppia in equilibrio'
        ELSE 'ATTENZIONE — Sbilancio rilevato'
    END                                             AS stato_quadratura
FROM movimenti_contabili
WHERE periodo = 2025;
