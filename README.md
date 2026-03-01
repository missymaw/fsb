# Monitor de Precios — Farmacia San Blas
## Módulo 2 del Sistema de Gestión Integral

Monitorea automáticamente los precios de la competencia y te avisa cuándo te están ganando.

---

## ¿Qué hace?

- Busca tus productos en **Farmacias Guadalajara** (scraping automático)
- Compara sus precios contra los tuyos
- Guarda el historial en una base de datos local
- Genera reportes CSV listos para abrir en Excel
- Corre automáticamente de madrugada (configurable)

---

## Instalación

### Requisitos previos
- Node.js 18+ instalado
- El mismo servidor donde tienes el backend (Módulo 1), o cualquier computadora con Node

### Pasos

```bash
# 1. Entrar a la carpeta
cd monitor-precios

# 2. Instalar dependencias
npm install

# 3. Instalar el navegador Chromium de Playwright
npx playwright install chromium

# 4. Configurar tu entorno
cp .env.example .env
# Edita .env con tu editor favorito (Notepad, VS Code, etc.)

# 5. Poner tu catálogo CSV en ./data/
# (Exporta desde SAV o usa el mismo CSV del Dashboard)
mkdir data
# Copia aquí tu catalogo-sanblas.csv
```

---

## Configuración (.env)

```env
# Ruta a tu catálogo exportado de SAV
TU_CATALOGO_CSV=./data/catalogo-sanblas.csv

# Cuántos productos monitorear (los de mayor valor neto)
TOP_PRODUCTOS=500

# Pausa entre búsquedas (milisegundos) — no bajar de 3000
PAUSA_ENTRE_BUSQUEDAS_MS=5000

# Cuándo correr automáticamente (formato cron)
# "0 3 * * *" = todos los días a las 3am
CRON_SCHEDULE=0 3 * * *
```

---

## Uso

### Prueba rápida (3 productos)
```bash
node scrapers/guadalajara.js --test
```
Útil para verificar que el scraper funciona antes de lanzarlo completo.

### Correr el monitor ahora mismo
```bash
node index.js --ahora
```
- Carga tu catálogo desde el CSV
- Busca los top 500 productos en Farmacias Guadalajara
- Guarda resultados en la base de datos
- Genera los reportes CSV en ./reportes/

### Solo generar reportes (sin nuevo scraping)
```bash
node index.js --reporte
```
Genera los CSV con la información que ya está en la base de datos.

### Modo automático (dejar corriendo)
```bash
node index.js
```
Inicia el cron. Corre automáticamente a las 3am todos los días.

---

## Reportes generados

En la carpeta `./reportes/` encontrarás dos archivos CSV:

### `comparacion_guadalajara_FECHA.csv`
Comparación completa de todos los productos encontrados:
- Tu precio vs precio de Guadalajara
- Diferencia en % (negativo = ellos más baratos)
- URL del producto en su sitio
- Situación: "FG más barato ⚠️" / "Yo más barato ✅"

### `urgente_guadalajara_mas_barata_FECHA.csv`
Solo los productos donde Guadalajara te gana precio, ordenados de mayor a menor diferencia.
**Este es el reporte más importante** — muestra dónde tienes que ajustar precios urgente.

---

## Formato del CSV de catálogo

El sistema detecta automáticamente las columnas. Funciona con el mismo CSV que ya exportas
para el Dashboard. Las columnas que busca:

| Campo necesario | Nombres que reconoce |
|---|---|
| Clave del producto | clave, codigo, art_clave |
| Nombre | nombre, descripcion, description |
| Precio de venta | precio_total, precio_venta, precio, total |
| Costo | costo, cost |
| Margen | margen, margin |
| Existencia | existencia, stock |
| Proveedor | proveedor, provider |
| Departamento | familia, departamento, categoria |

---

## Estructura de archivos

```
monitor-precios/
├── index.js                    ← Punto de entrada + cron
├── package.json
├── .env.example                ← Configuración (copiar como .env)
├── data/
│   └── catalogo-sanblas.csv    ← Tu catálogo aquí
├── db/
│   └── precios-db.js           ← Base de datos SQLite
├── scrapers/
│   └── guadalajara.js          ← Scraper de Farmacias Guadalajara
├── engine/
│   └── monitor-engine.js       ← Orquestador
├── reports/
│   └── report-generator.js     ← Generador de CSVs
└── reportes/
    └── (aquí se generan los CSV)
```

---

## Notas importantes

**Sobre el scraping:**
- Farmacias Guadalajara usa JavaScript dinámico (SAP Commerce), por eso necesitamos Playwright
- Las pausas entre búsquedas son necesarias para no ser bloqueadas
- Si el scraper falla o devuelve pocos resultados, puede ser que el sitio haya cambiado su estructura

**Sobre los precios:**
- Los precios de farmaciasguadalajara.com son precios **online**, pueden diferir de sucursal
- El scraper indica el nivel de confianza del match (match_score)
- Scores > 0.8 = coincidencia muy buena

**Próximos competidores a agregar:**
- Farmacias Benavides (próximo módulo)
- Farmacias Similares (requiere Playwright, similar a este)
- Mercado Libre (API oficial)
