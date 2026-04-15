const state = {
  raw: [],
  filtered: []
};

const $ = (id) => document.getElementById(id);

const loadBtn = $('loadBtn');
const exportJsonBtn = $('exportJsonBtn');
const exportCsvBtn = $('exportCsvBtn');
const searchInput = $('searchInput');
const categoryFilter = $('categoryFilter');
const cardFilter = $('cardFilter');
const modeFilter = $('modeFilter');
const resultsBody = $('resultsBody');
const statusText = $('statusText');
const errorBox = $('errorBox');

function setStatus(text) {
  statusText.textContent = text;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function hideError() {
  errorBox.textContent = '';
  errorBox.classList.add('hidden');
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
}

function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-CL');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function fillSelect(selectEl, values) {
  const current = selectEl.value;
  selectEl.innerHTML = '<option value="">Todas</option>' + values
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join('');
  selectEl.value = values.includes(current) ? current : '';
}

function updateFilters() {
  fillSelect(categoryFilter, uniqueSorted(state.raw.map((item) => item.categoria)));
  fillSelect(modeFilter, uniqueSorted(state.raw.map((item) => item.modalidad)));

  const cards = uniqueSorted(
    state.raw.flatMap((item) => Array.isArray(item.tarjetas) ? item.tarjetas : [])
  );
  fillSelect(cardFilter, cards);
}

function renderStats(items) {
  $('statTotal').textContent = items.length;
  $('statMerchants').textContent = new Set(items.map((item) => item.comercio).filter(Boolean)).size;
  $('statCategories').textContent = new Set(items.map((item) => item.categoria).filter(Boolean)).size;
  $('statUpdated').textContent = formatDate(items[0]?.fechaExtraccion || '');
}

function renderTable(items) {
  if (!items.length) {
    resultsBody.innerHTML = '<tr><td colspan="8" class="empty">No hay resultados para esos filtros.</td></tr>';
    return;
  }

  resultsBody.innerHTML = items.map((item) => {
    const tarjetas = (item.tarjetas || []).map((t) => `<span class="badge">${escapeHtml(t)}</span>`).join('');
    const dias = (item.diasAplican || []).map((d) => `<span class="badge">${escapeHtml(d)}</span>`).join('');

    return `
      <tr>
        <td>
          <strong>${escapeHtml(item.comercio || '-')}</strong>
          <div class="small">${escapeHtml(item.ubicacion || '')}</div>
        </td>
        <td>${escapeHtml(item.categoria || '-')}</td>
        <td>
          <div><strong>${escapeHtml(item.beneficio || '-')}</strong></div>
          <div class="small">${escapeHtml(item.detalle || '')}</div>
        </td>
        <td>${tarjetas || '-'}</td>
        <td>${escapeHtml(item.modalidad || '-')}</td>
        <td>${escapeHtml(item.vigencia || '-')}</td>
        <td>${dias || '-'}</td>
        <td><a href="${escapeHtml(item.urlFuente)}" target="_blank" rel="noreferrer">Abrir</a></td>
      </tr>
    `;
  }).join('');
}

function applyFilters() {
  const term = searchInput.value.trim().toLowerCase();
  const category = categoryFilter.value;
  const card = cardFilter.value;
  const mode = modeFilter.value;

  state.filtered = state.raw.filter((item) => {
    const hayTexto = !term || [
      item.comercio,
      item.categoria,
      item.beneficio,
      item.detalle,
      item.vigencia,
      item.modalidad,
      ...(item.tarjetas || []),
      ...(item.diasAplican || [])
    ].join(' ').toLowerCase().includes(term);

    const hayCategoria = !category || item.categoria === category;
    const hayTarjeta = !card || (item.tarjetas || []).includes(card);
    const hayModalidad = !mode || item.modalidad === mode;

    return hayTexto && hayCategoria && hayTarjeta && hayModalidad;
  });

  renderTable(state.filtered);
  renderStats(state.filtered.length ? state.filtered : state.raw);
  setStatus(`${state.filtered.length} resultado(s)`);
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows) {
  const headers = [
    'banco','tarjetaPrincipal','tarjetas','comercio','categoria','beneficio','detalle','modalidad','ubicacion','vigencia','diasAplican','tope','medioPago','urlFuente','fechaExtraccion'
  ];
  const esc = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const lines = [headers.join(',')];

  for (const item of rows) {
    lines.push([
      item.banco,
      item.tarjetaPrincipal,
      (item.tarjetas || []).join(' | '),
      item.comercio,
      item.categoria,
      item.beneficio,
      item.detalle,
      item.modalidad,
      item.ubicacion,
      item.vigencia,
      (item.diasAplican || []).join(' | '),
      item.tope,
      item.medioPago,
      item.urlFuente,
      item.fechaExtraccion
    ].map(esc).join(','));
  }

  return lines.join('\n');
}

async function loadData() {
  hideError();
  setStatus('Extrayendo...');
  loadBtn.disabled = true;

  try {
    const res = await fetch('/api/beneficios');
    if (!res.ok) {
      throw new Error(`Error HTTP ${res.status}`);
    }

    const payload = await res.json();
    state.raw = Array.isArray(payload.items) ? payload.items : [];
    updateFilters();
    applyFilters();
    exportJsonBtn.disabled = !state.raw.length;
    exportCsvBtn.disabled = !state.raw.length;
    $('statUpdated').textContent = formatDate(payload.scrapedAt || '');
  } catch (error) {
    console.error(error);
    showError('No se pudieron cargar los beneficios. Revisa la función serverless o ajusta los selectores del sitio fuente.');
    setStatus('Error de extracción');
  } finally {
    loadBtn.disabled = false;
  }
}

[searchInput, categoryFilter, cardFilter, modeFilter].forEach((el) => {
  el.addEventListener('input', applyFilters);
  el.addEventListener('change', applyFilters);
});

loadBtn.addEventListener('click', loadData);
exportJsonBtn.addEventListener('click', () => {
  downloadFile('beneficios-banco-falabella.json', JSON.stringify(state.filtered, null, 2), 'application/json');
});
exportCsvBtn.addEventListener('click', () => {
  downloadFile('beneficios-banco-falabella.csv', toCsv(state.filtered), 'text/csv;charset=utf-8');
});
