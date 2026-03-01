// proxy.js — Proxy local para Monitor de Precios
// ─────────────────────────────────────────────────────────────────
// Corre en segundo plano y el HTML le hace peticiones.
// Maneja el scraping de: Guadalajara, Benavides, Similares
//
// USO: node proxy.js
// Puerto: 3030
// ─────────────────────────────────────────────────────────────────

const http = require('http');
const { chromium } = require('playwright');
require('dotenv').config();

const PORT = 3030;
const HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== 'false';
const PAUSA_MS = parseInt(process.env.PAUSA_ENTRE_BUSQUEDAS_MS) || 4000;

// ── Configuración por competidor ──────────────────────────────────
const COMPETIDORES = {
  guadalajara: {
    nombre: 'Farmacias Guadalajara',
    buscarURL: (q) => `https://www.farmaciasguadalajara.com/search?text=${encodeURIComponent(q)}`,
    // Selectores CSS para extraer resultados
    selectores: {
      item:   '.product-item, [data-product-code], .product__item',
      nombre: '.product__name, .name, h2, h3, [class*="product-name"]',
      precio: '.product-price, .price, [class*="price"], .price__value',
      link:   'a[href]',
    },
    sinResultados: ['no se encontraron', '0 resultado', 'sin resultado'],
  },
  benavides: {
    nombre: 'Farmacias Benavides',
    buscarURL: (q) => `https://www.benavides.com.mx/search?q=${encodeURIComponent(q)}`,
    selectores: {
      item:   '.product-item, .product-card, [class*="product"]',
      nombre: '.product-title, .product-name, h2, h3, .name',
      precio: '.price, .product-price, [class*="price"], .precio',
      link:   'a[href]',
    },
    sinResultados: ['no se encontraron', 'sin resultados', '0 product'],
  },
  similares: {
    nombre: 'Farmacias Similares',
    buscarURL: (q) => `https://www.farmaciassimilares.com.mx/busqueda?q=${encodeURIComponent(q)}`,
    selectores: {
      item:   '.product, .card, [class*="product"]',
      nombre: '.product-name, .name, h2, h3, .title',
      precio: '.price, .precio, [class*="price"]',
      link:   'a[href]',
    },
    sinResultados: ['no encontramos', 'sin resultados', 'no results'],
  },
};

// ── Instancia global del navegador (se reutiliza entre peticiones) ─
let browser = null;
let page    = null;

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: HEADLESS,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    console.log('🌐 Navegador Playwright iniciado');
  }
  return browser;
}

async function getPage(context) {
  const p = await context.newPage();
  // Ocultar fingerprint de automatización
  await p.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  // Bloquear imágenes/fuentes para velocidad
  await p.route('**/*', route => {
    const tipo = route.request().resourceType();
    if (['image', 'font', 'media', 'stylesheet'].includes(tipo)) route.abort();
    else route.continue();
  });
  return p;
}

// ── Utilidades de texto ────────────────────────────────────────────
function normalizar(s) {
  if (!s) return '';
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function similitud(a, b) {
  const pa = new Set(normalizar(a).split(' ').filter(w => w.length > 2));
  const pb = new Set(normalizar(b).split(' ').filter(w => w.length > 2));
  if (pa.size === 0) return 0;
  let hits = 0;
  pa.forEach(w => { if (pb.has(w)) hits++; });
  return hits / pa.size;
}

function extraerPrecio(txt) {
  if (!txt) return null;
  const m = txt.replace(/,/g, '').match(/\d+\.?\d*/);
  return m ? parseFloat(m[0]) : null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Scraping principal ─────────────────────────────────────────────
async function buscarEnCompetidor(producto, competidor) {
  const cfg = COMPETIDORES[competidor];
  if (!cfg) return { encontrado: false, razon: 'Competidor no soportado' };

  const br = await getBrowser();
  const ctx = await br.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'es-MX',
    timezoneId: 'America/Mexico_City',
  });
  const pg = await getPage(ctx);

  try {
    // Término de búsqueda: primeras 3-4 palabras
    const termino = producto.nombre.trim().split(/\s+/).slice(0, 4).join(' ');
    const url = cfg.buscarURL(termino);

    await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

    // Esperar resultados
    let cargado = false;
    for (const sel of cfg.selectores.item.split(', ')) {
      try {
        await pg.waitForSelector(sel.trim(), { timeout: 7000 });
        cargado = true; break;
      } catch {}
    }

    if (!cargado) await sleep(2000);

    // Verificar "sin resultados"
    const bodyText = (await pg.textContent('body').catch(() => '')).toLowerCase();
    for (const frase of cfg.sinResultados) {
      if (bodyText.includes(frase)) {
        return { encontrado: false, razon: 'Página sin resultados' };
      }
    }

    // Extraer productos con evaluate
    const items = await pg.evaluate((selectores) => {
      const resultados = [];
      const sels = selectores.item.split(', ');
      let elementos = [];
      for (const s of sels) {
        elementos = [...document.querySelectorAll(s)];
        if (elementos.length > 0) break;
      }

      const buscarTexto = (el, sels) => {
        for (const s of sels.split(', ')) {
          const found = el.querySelector(s);
          if (found) return found.textContent.trim();
        }
        return '';
      };

      elementos.slice(0, 10).forEach(el => {
        const nombre = buscarTexto(el, selectores.nombre);
        const precioTxt = buscarTexto(el, selectores.precio);
        const link = el.querySelector('a[href]');
        if (nombre) resultados.push({ nombre, precioTxt, url: link?.href || '' });
      });

      // Fallback: JSON-LD
      if (resultados.length === 0) {
        document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
          try {
            const d = JSON.parse(s.textContent);
            const items = d.itemListElement || (d['@type'] === 'Product' ? [{ item: d }] : []);
            items.forEach(i => {
              const item = i.item || i;
              if (item.name) resultados.push({
                nombre: item.name,
                precioTxt: String(item.offers?.price || ''),
                url: item.url || ''
              });
            });
          } catch {}
        });
      }

      return resultados;
    }, cfg.selectores);

    if (items.length === 0) {
      return { encontrado: false, razon: 'No se extrajeron productos del DOM' };
    }

    // Mejor match por similitud
    let mejor = null, mejorScore = 0;
    for (const item of items) {
      const score = similitud(producto.nombre, item.nombre);
      if (score > mejorScore) { mejorScore = score; mejor = item; }
    }

    if (!mejor || mejorScore < 0.35) {
      return { encontrado: false, razon: `Sin match suficiente (max score: ${mejorScore.toFixed(2)})` };
    }

    const precio = extraerPrecio(mejor.precioTxt);
    if (!precio) {
      return { encontrado: false, razon: 'Precio no extraíble' };
    }

    return {
      encontrado: true,
      nombre_encontrado: mejor.nombre,
      precio_comp: precio,
      url: mejor.url || url,
      match_score: mejorScore,
    };

  } catch (err) {
    return { encontrado: false, razon: err.message };
  } finally {
    await ctx.close();
    // Pausa antes de la siguiente búsqueda
    await sleep(PAUSA_MS + Math.floor(Math.random() * 2000));
  }
}

// ── Servidor HTTP ──────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

function json(res, data, status = 200) {
  cors(res);
  res.writeHead(status);
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    cors(res); res.writeHead(204); res.end(); return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // GET /status — verificar que el proxy está vivo
  if (req.method === 'GET' && url.pathname === '/status') {
    return json(res, { ok: true, version: '1.0', competidores: Object.keys(COMPETIDORES) });
  }

  // POST /buscar — buscar un producto en un competidor
  if (req.method === 'POST' && url.pathname === '/buscar') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const { producto, competidor } = JSON.parse(body);
        if (!producto || !competidor) {
          return json(res, { error: 'Faltan parámetros: producto, competidor' }, 400);
        }
        const resultado = await buscarEnCompetidor(producto, competidor);
        return json(res, resultado);
      } catch (err) {
        return json(res, { error: err.message, encontrado: false }, 500);
      }
    });
    return;
  }

  // 404
  json(res, { error: 'Ruta no encontrada' }, 404);
});

server.listen(PORT, () => {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('   PROXY — MONITOR DE PRECIOS FARMACIA SAN BLAS');
  console.log(`   Puerto: http://localhost:${PORT}`);
  console.log('═══════════════════════════════════════════════════');
  console.log('\n✅ Listo. Abre monitor-precios.html en tu navegador.');
  console.log('   Ctrl+C para detener.\n');
  console.log('   Competidores disponibles:');
  Object.entries(COMPETIDORES).forEach(([k, v]) => console.log(`   • ${k}: ${v.nombre}`));
  console.log('');
});

// Cerrar el navegador al salir limpiamente
process.on('SIGINT', async () => {
  console.log('\n🔴 Cerrando...');
  if (browser) await browser.close();
  server.close();
  process.exit(0);
});
