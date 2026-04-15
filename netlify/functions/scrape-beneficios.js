const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.bancofalabella.cl';
const LIST_URL = `${BASE_URL}/descuentos`;
const SITEMAP_URL = `${BASE_URL}/sitemap.xml`;
const CATEGORY_PATHS = [
  '/descuentos/antojos',
  '/descuentos/viajes',
  '/descuentos/todos'
];

const DISCOVERY_SEEDS = [
  `${BASE_URL}/descuentos/detalle/especial-verano-region-valparaiso`,
  `${BASE_URL}/descuentos/detalle/especial-verano-la-serena`,
  `${BASE_URL}/descuentos/detalle/especial-verano-puerto-varas`,
  `${BASE_URL}/descuentos/detalle/especial-verano-valdivia`,
  `${BASE_URL}/descuentos/detalle/especial-verano-iquique`,
  `${BASE_URL}/descuentos/detalle/especial-verano-villarica`,
  `${BASE_URL}/descuentos/detalle/club-de-restaurantes`
];

const KNOWN_DETAIL_URLS = [
  'badass',
  'canje-de-hoteles-viajes-falabella',
  'canje-de-traslados-viajes-falabella',
  'carnes-a-punto',
  'centro-de-salud-uss',
  'chuck-e-cheese-domingo',
  'clinica-you',
  'club-de-restaurantes',
  'cmr-days-fasa-febrero',
  'cuotas-sin-interes-en-viajes-falabella',
  'de-barrio',
  'destino-del-mes',
  'doggis',
  'dunkin',
  'family-park',
  'farmacias-ahumada-cmrpuntos',
  'frida-kahlo',
  'happyland',
  'inmunomedica',
  'integramedica-60-descuento',
  'juan-maestro',
  'la-barra',
  'la-cabrera-al-paso',
  'le-vice',
  'maleta-gratis-elite',
  'mccombodelmes',
  'miscelaneo',
  'muu-grill',
  'papa-johns',
  'parque-aventura',
  'sabor-y-aroma',
  'sog-jalisco',
  'sog-la-piazza',
  'take-a-wok',
  'traslado-al-aeropuerto-elite',
  'turbus',
  'uno-salud-dental',
  'vapiano',
  'vendetta',
  'viaja-ya'
].map((slug) => `${BASE_URL}/descuentos/detalle/${slug}`);

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
  'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache'
};

async function getHtml(url) {
  const response = await axios.get(url, {
    headers: DEFAULT_HEADERS,
    timeout: 30000,
    maxRedirects: 5,
    validateStatus: (status) => status >= 200 && status < 400
  });
  return response.data;
}

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function absolute(url) {
  if (!url) return '';
  return url.startsWith('http') ? url : `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

function uniq(array) {
  return [...new Set(array.filter(Boolean))];
}

function normalizeDay(day) {
  return day
    .toLowerCase()
    .replace('miercoles', 'miércoles')
    .replace('sabado', 'sábado');
}

function removeNoise($) {
  $('script, style, noscript, iframe, svg, header, footer').remove();
  $('[class*="menu"], [class*="nav"], [class*="header"], [class*="footer"], [class*="loader"], [id*="menu"], [id*="nav"]').remove();
}

function parseXmlLocs(xml) {
  const links = [];
  const regex = /<loc>(.*?)<\/loc>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    links.push(match[1].trim());
  }
  return uniq(links);
}

async function crawlSitemaps(startUrl, seen = new Set()) {
  if (seen.has(startUrl)) return [];
  seen.add(startUrl);

  try {
    const xml = await getHtml(startUrl);
    const locs = parseXmlLocs(xml);
    const detailLinks = [];

    for (const loc of locs) {
      if (loc.endsWith('.xml')) {
        const nested = await crawlSitemaps(loc, seen);
        nested.forEach((url) => detailLinks.push(url));
      } else if (loc.includes('/descuentos/detalle/')) {
        detailLinks.push(loc);
      }
    }

    return uniq(detailLinks);
  } catch (error) {
    return [];
  }
}

function extractLinksFromHtml(html) {
  const $ = cheerio.load(html);
  removeNoise($);
  const links = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const url = absolute(href);
    if (url.includes('/descuentos/detalle/')) links.push(url);
  });

  const htmlString = $.html();
  const regex = /https:\/\/www\.bancofalabella\.cl\/descuentos\/detalle\/[a-z0-9\-]+/gi;
  const inlineMatches = htmlString.match(regex) || [];
  inlineMatches.forEach((url) => links.push(url));

  return uniq(links);
}

function inferCategory(url, title, blocks) {
  const hay = `${url} ${title} ${blocks.join(' ')}`.toLowerCase();
  if (/restaurante|restaurant|pizza|dunkin|papa john|doggis|juan maestro|cafe|bar|antojos|sanguch|mcdonald|kfc|wendy|domino|wok|grill|sushi/i.test(hay)) return 'Gastronomía';
  if (/viaje|hotel|vuelo|turbus|aeropuerto|maleta|traslado|bus/i.test(hay)) return 'Viajes';
  if (/farmacia|salud|seguro|clinica|dental|m[eé]dica|kinesiolog/i.test(hay)) return 'Salud';
  if (/retail|tienda|mall|sodimac|tottus|parque arauco|plaza/i.test(hay)) return 'Retail';
  if (/educacion|universidad|curso/i.test(hay)) return 'Educación';
  if (/entreten|cine|fest|evento|happyland|park|aventur|chuck e cheese|cinemark/i.test(hay)) return 'Entretención';
  return 'Sin clasificar';
}

function extractDays(text) {
  const normalized = clean(text).toLowerCase();
  const days = ['lunes', 'martes', 'miércoles', 'miercoles', 'jueves', 'viernes', 'sábado', 'sabado', 'domingo'];
  return uniq(days.filter((day) => normalized.includes(day)).map(normalizeDay));
}

function extractCards(text) {
  const normalized = clean(text);
  const cards = [];
  if (/CMR Mastercard Elite/i.test(normalized)) cards.push('CMR Mastercard Elite');
  if (/CMR Mastercard Premium/i.test(normalized)) cards.push('CMR Mastercard Premium');
  if (/CMR Mastercard(?!\s*(Elite|Premium))/i.test(normalized)) cards.push('CMR Mastercard');
  if (/D[eé]bito Banco Falabella/i.test(normalized) || /Tarjeta D[eé]bito Banco Falabella/i.test(normalized)) cards.push('Débito Banco Falabella');
  return uniq(cards);
}

function pickFirstByRegex(list, regex) {
  return list.find((t) => regex.test(t)) || '';
}

function getScopedText($) {
  const candidates = [
    'main',
    'article',
    '[class*="detalle"]',
    '[class*="benefit"]',
    '[class*="beneficio"]',
    '[class*="content"]'
  ];

  for (const selector of candidates) {
    const el = $(selector).first();
    const text = clean(el.text());
    if (text && /Disfruta de tu beneficio en|Conoce el detalle|Condiciones|Exclusivo con|Sigue estos pasos/i.test(text)) {
      return el;
    }
  }

  return $('body');
}

function normalizeTitle(value = '') {
  return clean(value)
    .replace(/^Disfruta de tu beneficio en\s+/i, '')
    .replace(/^Conoce el detalle\s*/i, '')
    .replace(/^Sigue estos pasos\s*/i, '')
    .trim();
}

function extractLogo($, root, comercio) {
  const logoByText = root.find('img').filter((_, el) => {
    const alt = clean($(el).attr('alt')).toLowerCase();
    return comercio && alt.includes(comercio.toLowerCase().slice(0, 10));
  }).first().attr('src');

  const candidates = [
    logoByText,
    $('meta[property="og:image"]').attr('content'),
    $('meta[name="twitter:image"]').attr('content'),
    root.find('img').map((_, el) => $(el).attr('src')).get().find((src) => src && !/loader|icono|mastercard|modalidad/i.test(src)),
    $('img').map((_, el) => $(el).attr('src')).get().find((src) => src && !/loader|icono|mastercard|modalidad|logo-banco/i.test(src))
  ];

  for (const src of candidates) {
    if (!src) continue;
    const url = absolute(src);
    if (/loader|icono|favicon|mastercard|modalidad|logo-banco/i.test(url)) continue;
    return url;
  }
  return '';
}

function extractMerchantName(root, $, url) {
  const h1 = normalizeTitle(root.find('h1').first().text()) || normalizeTitle($('h1').first().text());
  if (h1 && h1.length < 90) return h1;

  const slug = url.split('/').pop() || '';
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeBenefit(text) {
  return clean(text)
    .replace(/^Descuento:\s*/i, '')
    .replace(/^Beneficio:\s*/i, '')
    .replace(/^Exclusivo con:\s*/i, '')
    .replace(/\|/g, ' · ')
    .trim();
}

function parseBenefitPage(html, url) {
  const $ = cheerio.load(html);
  removeNoise($);

  const root = getScopedText($);
  const pageText = clean(root.text());
  const comercio = extractMerchantName(root, $, url);

  const blocks = root.find('h1, h2, h3, p, li, strong, span').map((_, el) => clean($(el).text())).get().filter(Boolean);
  const compactBlocks = uniq(blocks).filter((t) => t.length > 2 && t.length < 420);

  const rawBenefit =
    pickFirstByRegex(compactBlocks, /^Descuento:/i) ||
    pickFirstByRegex(compactBlocks, /^Beneficio:/i) ||
    pickFirstByRegex(compactBlocks, /(\d+%\s*(dcto|descuento|cashback)|2x1|cuotas sin interés|cuotas sin interes|maleta|traslados?)/i) ||
    pickFirstByRegex(compactBlocks, /Todos los\s+(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)/i) ||
    '';
  const beneficio = normalizeBenefit(rawBenefit);

  let modalidad = pickFirstByRegex(compactBlocks, /presencial y online|presencial|online|app|totem/i);
  modalidad = clean(modalidad)
    .replace(/^Modalidad:\s*/i, '')
    .replace(/^Condiciones:\s*/i, '')
    .replace(/^Exclusivo\s*/i, '')
    .trim();

  const vigenciaMatch = pageText.match(/Válido(?:s)?(?: hasta)?\s+(?:el\s+)?(\d{1,2}\s+de\s+[a-záéíóú]+\s+de\s+\d{4})/i)
    || pageText.match(/hasta\s+el\s+(\d{1,2}\s+de\s+[a-záéíóú]+\s+de\s+\d{4})/i)
    || pageText.match(/hasta\s+(\d{1,2}\s+de\s+[a-záéíóú]+\s+de\s+\d{4})/i);
  const vigencia = vigenciaMatch ? vigenciaMatch[1] : '';

  let ubicacion = '';
  const ubicacionIndex = compactBlocks.findIndex((t) => /^Ubicación:?$/i.test(t) || /^Válido en locales:?$/i.test(t));
  if (ubicacionIndex >= 0 && compactBlocks[ubicacionIndex + 1]) {
    ubicacion = compactBlocks[ubicacionIndex + 1];
  }
  if (!ubicacion) {
    ubicacion = pickFirstByRegex(compactBlocks, /Región Metropolitana|Región de [A-Za-zÁÉÍÓÚáéíóú\s]+|Santiago|13\+|14\+|15\+|Parque Arauco|Costanera/i);
  }

  const tarjetas = extractCards(pageText);
  const diasAplican = extractDays(pageText);
  const tarjetaPrincipal = tarjetas[0] || '';

  const topeMatch = pageText.match(/sin tope/i) || pageText.match(/tope\s+de\s+\$?[\d\.]+/i) || pageText.match(/máximo\s+\$?[\d\.]+/i);
  const tope = topeMatch ? clean(topeMatch[0]) : '';

  const detalleParts = compactBlocks.filter((t) =>
    /^Condiciones:?/i.test(t) ||
    /^Oferta válida/i.test(t) ||
    /No acumulable|Exclusivo|Todos los|Solo presencial|Solo online|Válido solo|Ingresa los primeros 6 dígitos|medio de pago|canje|aplica/i.test(t)
  );
  const detalle = clean(detalleParts.join(' | ')).slice(0, 1000);

  let tipoTarjeta = 'Crédito';
  if (tarjetas.some((t) => /Débito/i.test(t)) && tarjetas.some((t) => /CMR/i.test(t))) tipoTarjeta = 'Mixto';
  else if (tarjetas.some((t) => /Débito/i.test(t))) tipoTarjeta = 'Débito';

  const logoComercio = extractLogo($, root, comercio);

  return {
    banco: 'Banco Falabella',
    tarjetaPrincipal,
    tarjetas,
    tipoTarjeta,
    comercio,
    categoria: inferCategory(url, comercio, compactBlocks),
    beneficio,
    detalle,
    vigencia,
    diasAplican,
    tope,
    medioPago: tarjetas.length ? `Pago con ${tarjetas.join(' / ')}` : '',
    modalidad,
    ubicacion,
    logoComercio,
    urlFuente: url,
    fechaExtraccion: new Date().toISOString()
  };
}

function dedupeItems(items) {
  const map = new Map();
  for (const item of items) {
    const key = `${item.comercio}`.toLowerCase().trim();
    if (!key) continue;
    const current = map.get(key);
    if (!current) {
      map.set(key, item);
      continue;
    }
    const currentScore = `${current.beneficio} ${current.detalle}`.length;
    const newScore = `${item.beneficio} ${item.detalle}`.length;
    if (newScore > currentScore) map.set(key, item);
  }
  return [...map.values()].sort((a, b) => a.comercio.localeCompare(b.comercio, 'es'));
}

async function getDetailLinks() {
  const detailLinks = new Set(KNOWN_DETAIL_URLS);

  const sitemapLinks = await crawlSitemaps(SITEMAP_URL);
  sitemapLinks.forEach((url) => detailLinks.add(url));

  const pagesToScan = [
    LIST_URL,
    ...CATEGORY_PATHS.map((p) => `${BASE_URL}${p}`),
    ...DISCOVERY_SEEDS,
    ...KNOWN_DETAIL_URLS.slice(0, 20)
  ];

  for (const pageUrl of pagesToScan) {
    try {
      const html = await getHtml(pageUrl);
      extractLinksFromHtml(html).forEach((url) => detailLinks.add(url));
    } catch (error) {
      // continue
    }
  }

  return [...detailLinks].filter((url) => /\/descuentos\/detalle\//.test(url));
}

async function processInBatches(urls, batchSize = 4) {
  const items = [];
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(async (url) => {
      const html = await getHtml(url);
      return parseBenefitPage(html, url);
    }));

    for (const result of results) {
      if (result.status === 'fulfilled') items.push(result.value);
    }
  }
  return items;
}

exports.handler = async () => {
  try {
    const detailLinks = await getDetailLinks();

    if (!detailLinks.length) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          items: [],
          scrapedAt: new Date().toISOString(),
          note: 'No se encontraron links de detalle.'
        })
      };
    }

    const sampleLinks = detailLinks.slice(0, 60);
    const parsed = await processInBatches(sampleLinks, 4);

    const items = dedupeItems(
      parsed
        .filter((item) => item.comercio && item.comercio.length < 120)
        .filter((item) => item.urlFuente.includes('/descuentos/detalle/'))
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({
        source: LIST_URL,
        totalDetectedLinks: detailLinks.length,
        totalProcessedLinks: sampleLinks.length,
        scrapedAt: new Date().toISOString(),
        items
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: true,
        message: error.message,
        stack: error.stack
      })
    };
  }
};
