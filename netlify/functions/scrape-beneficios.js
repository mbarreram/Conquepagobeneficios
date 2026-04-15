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

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; ConQuePagoBot/1.1; +https://conquepago.app)',
  'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8'
};

async function getHtml(url) {
  const response = await axios.get(url, {
    headers: DEFAULT_HEADERS,
    timeout: 25000,
    maxRedirects: 5
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

function extractLinksFromSitemap(xml) {
  const links = [];
  const regex = /<loc>(.*?)<\/loc>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const url = match[1].trim();
    if (url.includes('/descuentos/detalle/')) links.push(url);
  }
  return uniq(links);
}

function extractLinksFromHtml(html) {
  const $ = cheerio.load(html);
  removeNoise($);
  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && href.includes('/descuentos/detalle/')) links.push(absolute(href));
  });
  return uniq(links);
}

function inferCategory(url, title, blocks) {
  const hay = `${url} ${title} ${blocks.join(' ')}`.toLowerCase();
  if (/restaurante|restaurant|pizza|dunkin|papa john|doggis|cafe|bar|antojos|sanguch|mcdonald/i.test(hay)) return 'Gastronomía';
  if (/viaje|hotel|vuelo|turbus|aeropuerto|maleta/i.test(hay)) return 'Viajes';
  if (/farmacia|salud|seguro|clinica/i.test(hay)) return 'Salud';
  if (/retail|tienda|mall|sodimac|tottus|parque arauco/i.test(hay)) return 'Retail';
  if (/educacion|universidad|curso/i.test(hay)) return 'Educación';
  if (/entreten|cine|fest|evento/i.test(hay)) return 'Entretención';
  return 'Sin clasificar';
}

function extractDays(text) {
  const normalized = clean(text).toLowerCase();
  const days = ['lunes','martes','miércoles','miercoles','jueves','viernes','sábado','sabado','domingo'];
  return uniq(days.filter((day) => normalized.includes(day)).map(normalizeDay));
}

function extractCards(text) {
  const normalized = clean(text);
  const cards = [];
  if (/CMR Mastercard Elite/i.test(normalized)) cards.push('CMR Mastercard Elite');
  if (/CMR Mastercard Premium/i.test(normalized)) cards.push('CMR Mastercard Premium');
  if (/CMR Mastercard(?!\s*(Elite|Premium))/i.test(normalized)) cards.push('CMR Mastercard');
  if (/Débito Banco Falabella/i.test(normalized) || /Tarjeta Débito Banco Falabella/i.test(normalized)) cards.push('Débito Banco Falabella');
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
    if (text && /Disfruta de tu beneficio en|Conoce el detalle|Condiciones|Exclusivo con/i.test(text)) {
      return el;
    }
  }

  return $('body');
}

function parseBenefitPage(html, url) {
  const $ = cheerio.load(html);
  removeNoise($);

  const root = getScopedText($);
  const pageText = clean(root.text());
  const h1 = clean(root.find('h1').first().text()) || clean($('h1').first().text()) || clean($('title').text());
  const comercio = h1.replace(/^Disfruta de tu beneficio en\s+/i, '').trim();

  const blocks = root.find('h2, h3, p, li, strong').map((_, el) => clean($(el).text())).get().filter(Boolean);
  const compactBlocks = uniq(blocks).filter((t) => t.length > 2 && t.length < 500);

  const beneficio =
    pickFirstByRegex(compactBlocks, /^Descuento:/i)?.replace(/^Descuento:\s*/i, '') ||
    pickFirstByRegex(compactBlocks, /(\d+%\s*(dcto|descuento|cashback)|2x1|cuotas sin interés)/i) ||
    '';

  let modalidad = pickFirstByRegex(compactBlocks, /presencial y online|presencial|online/i);
  modalidad = modalidad
    .replace(/^Modalidad:\s*/i, '')
    .replace(/^Exclusivo\s*/i, '')
    .trim();

  const vigenciaMatch = pageText.match(/Válido(?:s)?(?: hasta)?\s+(?:el\s+)?(\d{1,2}\s+de\s+[a-záéíóú]+\s+de\s+\d{4})/i)
    || pageText.match(/hasta\s+el\s+(\d{1,2}\s+de\s+[a-záéíóú]+\s+de\s+\d{4})/i)
    || pageText.match(/hasta\s+(\d{1,2}\s+de\s+[a-záéíóú]+\s+de\s+\d{4})/i);
  const vigencia = vigenciaMatch ? vigenciaMatch[1] : '';

  let ubicacion = '';
  const ubicacionIndex = compactBlocks.findIndex((t) => /^Ubicación:?$/i.test(t));
  if (ubicacionIndex >= 0 && compactBlocks[ubicacionIndex + 1]) {
    ubicacion = compactBlocks[ubicacionIndex + 1];
  }
  if (!ubicacion) {
    ubicacion = pickFirstByRegex(compactBlocks, /Región Metropolitana|Región de [A-Za-zÁÉÍÓÚáéíóú\s]+|Santiago|13\+|14\+|15\+/i);
  }

  const tarjetas = extractCards(pageText);
  const diasAplican = extractDays(pageText);
  const tarjetaPrincipal = tarjetas[0] || '';

  const topeMatch = pageText.match(/sin tope/i) || pageText.match(/tope\s+de\s+\$?[\d\.]+/i) || pageText.match(/máximo\s+\$?[\d\.]+/i);
  const tope = topeMatch ? clean(topeMatch[0]) : '';

  const detalleParts = compactBlocks.filter((t) =>
    /^Condiciones:?/i.test(t) ||
    /^Oferta válida/i.test(t) ||
    /No acumulable|Exclusivo|Todos los|Solo presencial|Solo online|Válido solo/i.test(t)
  );
  const detalle = clean(detalleParts.join(' | ')).slice(0, 1000);

  let tipoTarjeta = 'Crédito';
  if (tarjetas.some((t) => /Débito/i.test(t)) && tarjetas.some((t) => /CMR/i.test(t))) tipoTarjeta = 'Mixto';
  else if (tarjetas.some((t) => /Débito/i.test(t))) tipoTarjeta = 'Débito';

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
    urlFuente: url,
    fechaExtraccion: new Date().toISOString()
  };
}

async function getDetailLinks() {
  const detailLinks = new Set();

  try {
    const sitemapXml = await getHtml(SITEMAP_URL);
    extractLinksFromSitemap(sitemapXml).forEach((url) => detailLinks.add(url));
  } catch (error) {
    console.warn('No se pudo leer sitemap.xml.');
  }

  const pagesToScan = [LIST_URL, ...CATEGORY_PATHS.map((p) => `${BASE_URL}${p}`)];
  for (const pageUrl of pagesToScan) {
    try {
      const html = await getHtml(pageUrl);
      extractLinksFromHtml(html).forEach((url) => detailLinks.add(url));
    } catch (error) {
      console.warn(`No se pudo leer ${pageUrl}`);
    }
  }

  return [...detailLinks].filter((url) => /\/descuentos\/detalle\//.test(url));
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

    const sampleLinks = detailLinks.slice(0, 80);
    const pages = await Promise.allSettled(sampleLinks.map(async (url) => {
      const html = await getHtml(url);
      return parseBenefitPage(html, url);
    }));

    const items = pages
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value)
      .filter((item) => item.comercio && item.comercio.length < 120)
      .filter((item) => item.urlFuente.includes('/descuentos/detalle/'));

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
