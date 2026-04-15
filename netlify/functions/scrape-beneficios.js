const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.bancofalabella.cl';
const LIST_URL = `${BASE_URL}/descuentos`;
const SITEMAP_URL = `${BASE_URL}/sitemap.xml`;

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; ConQuePagoBot/1.0; +https://example.com)',
  'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8'
};

async function getHtml(url) {
  const response = await axios.get(url, {
    headers: DEFAULT_HEADERS,
    timeout: 25000
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
  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && href.includes('/descuentos/detalle/')) links.push(absolute(href));
  });
  return uniq(links);
}

function inferCategory(url, title) {
  const hay = `${url} ${title}`.toLowerCase();
  if (hay.includes('restaurant') || hay.includes('antojos') || hay.includes('pizza') || hay.includes('cafe')) return 'Gastronomía';
  if (hay.includes('viaje') || hay.includes('hotel')) return 'Viajes';
  if (hay.includes('mall') || hay.includes('retail') || hay.includes('tienda')) return 'Retail';
  return 'Sin clasificar';
}

function extractDays(text) {
  const normalized = clean(text).toLowerCase();
  const days = ['lunes','martes','miércoles','miercoles','jueves','viernes','sábado','sabado','domingo'];
  return uniq(days.filter((day) => normalized.includes(day)).map((day) => day
    .replace('miercoles', 'miércoles')
    .replace('sabado', 'sábado')));
}

function extractCards(text) {
  const normalized = clean(text);
  const cards = [];
  if (/CMR Mastercard Elite/i.test(normalized)) cards.push('CMR Mastercard Elite');
  if (/CMR Mastercard Premium/i.test(normalized)) cards.push('CMR Mastercard Premium');
  if (/CMR Mastercard/i.test(normalized)) cards.push('CMR Mastercard');
  if (/Débito Banco Falabella/i.test(normalized)) cards.push('Débito Banco Falabella');
  if (/logo mastercard/i.test(normalized)) cards.push('Mastercard');
  return uniq(cards);
}

function parseBenefitPage(html, url) {
  const $ = cheerio.load(html);
  const pageText = clean($('body').text());

  const title = clean($('h1').first().text()) || clean($('title').text());
  const headings = $('h1, h2, h3').map((_, el) => clean($(el).text())).get();
  const allTextBlocks = $('p, li, strong, span, div').map((_, el) => clean($(el).text())).get().filter(Boolean);

  const comercio = title
    .replace(/^Disfruta de tu beneficio en\s+/i, '')
    .replace(/^#\s*/i, '')
    .trim();

  let beneficio = headings.find((t) => /\d+%|cashback|2x1|descuento|dcto/i.test(t)) || '';
  if (!beneficio) {
    const candidate = allTextBlocks.find((t) => /^Descuento:/i.test(t) || /\d+%.*(dcto|cashback)/i.test(t));
    beneficio = candidate ? candidate.replace(/^Descuento:\s*/i, '') : '';
  }

  let modalidad = headings.find((t) => /presencial|online/i.test(t)) || '';
  if (!modalidad) {
    if (/presencial y online/i.test(pageText)) modalidad = 'Presencial y online';
    else if (/solo presencial|exclusivo presencial|presencial/i.test(pageText)) modalidad = 'Presencial';
    else if (/online/i.test(pageText)) modalidad = 'Online';
  }

  const vigenciaMatch = pageText.match(/Válido(?:s)?(?: hasta)?\s+(?:el\s+)?(\d{1,2}\s+de\s+[a-záéíóú]+\s+de\s+\d{4})/i)
    || pageText.match(/hasta\s+el\s+(\d{1,2}\s+de\s+[a-záéíóú]+\s+de\s+\d{4})/i)
    || pageText.match(/hasta\s+(\d{1,2}\s+de\s+[a-záéíóú]+\s+de\s+\d{4})/i);
  const vigencia = vigenciaMatch ? vigenciaMatch[1] : '';

  const ubicacionHeader = headings.find((t) => /^Región|^Ubicación/i.test(t));
  const ubicacionText = allTextBlocks.find((t) => /Región Metropolitana|Región|Santiago|Mall/i.test(t) && t.length < 80) || ubicacionHeader || '';

  const detalle = allTextBlocks.find((t) => /^Oferta válida/i.test(t) || /^Condiciones:/i.test(t) || /No acumulable/i.test(t)) || '';
  const topeMatch = pageText.match(/sin tope|tope[^.\n]*/i);
  const tope = topeMatch ? clean(topeMatch[0]) : '';

  const category = inferCategory(url, title);
  const tarjetas = extractCards(pageText);
  const diasAplican = extractDays(pageText);
  const tarjetaPrincipal = tarjetas[0] || '';

  return {
    banco: 'Banco Falabella',
    tarjetaPrincipal,
    tarjetas,
    tipoTarjeta: tarjetas.some((t) => /Débito/i.test(t)) ? 'Mixto' : 'Crédito',
    comercio,
    categoria: category,
    beneficio,
    detalle,
    vigencia,
    diasAplican,
    tope,
    medioPago: tarjetas.length ? `Pago con ${tarjetas.join(' / ')}` : '',
    modalidad,
    ubicacion: ubicacionText,
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
    console.warn('No se pudo leer sitemap.xml, se probará la portada de descuentos.');
  }

  if (!detailLinks.size) {
    const html = await getHtml(LIST_URL);
    extractLinksFromHtml(html).forEach((url) => detailLinks.add(url));
  }

  return [...detailLinks];
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
          note: 'No se encontraron links de detalle. Revisa sitemap.xml o los selectores del sitio.'
        })
      };
    }

    const sampleLinks = detailLinks.slice(0, 60);
    const pages = await Promise.allSettled(sampleLinks.map(async (url) => {
      const html = await getHtml(url);
      return parseBenefitPage(html, url);
    }));

    const items = pages
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value)
      .filter((item) => item.comercio || item.beneficio);

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
