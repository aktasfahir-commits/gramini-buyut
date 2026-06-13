/* Gramını Büyüt — fiziksel altın & külçe gümüş biriktirme uygulaması.
   Felsefe: Fiyatlar değişir. Gramlar kalır. */

const STORAGE_KEY = 'gramini-buyut';
const DATA_VERSION = 2;

/* ---------------- Varlık türleri ---------------- */
// fixed: true → birim gram sabittir, gram = unitGrams × quantity (otomatik).
// fixed: false → kullanıcı gramı doğrudan girer.

// Altın ayar bazlı sınıflandırılır. Her ayar sınıfının kendi ürünleri vardır.
const GOLD_PURITY_ORDER = ['24', '22', '14'];

const GOLD_PURITIES = {
  '24': {
    label: '24 Ayar',
    items: {
      gram: { label: 'Gram Altın', unitGrams: 1.0, fixed: true },
    },
  },
  '22': {
    label: '22 Ayar',
    items: {
      ceyrek: { label: 'Çeyrek Altın', unitGrams: 1.75, fixed: true },
      yarim: { label: 'Yarım Altın', unitGrams: 3.5, fixed: true },
      tam: { label: 'Tam Altın', unitGrams: 7.0, fixed: true },
      cumhuriyet: { label: 'Cumhuriyet Altını', unitGrams: 7.2, fixed: true },
      bilezik22: { label: '22 Ayar Bilezik', unitGrams: null, fixed: false },
    },
  },
  '14': {
    label: '14 Ayar',
    items: {
      altin14: { label: '14 Ayar Altın', unitGrams: null, fixed: false },
    },
  },
};

const ASSET_TYPES = {
  gold: {
    label: 'Altın',
    icon: '🥇',
    purities: GOLD_PURITIES,
  },
  silver: {
    label: 'Gümüş',
    icon: '🥈',
    items: {
      kulce50: { label: '50 gr Külçe', unitGrams: 50, fixed: true },
      kulce100: { label: '100 gr Külçe', unitGrams: 100, fixed: true },
      kulce250: { label: '250 gr Külçe', unitGrams: 250, fixed: true },
      kulce500: { label: '500 gr Külçe', unitGrams: 500, fixed: true },
      kulce1000: { label: '1000 gr Külçe', unitGrams: 1000, fixed: true },
      ozelGram: { label: 'Özel Gram', unitGrams: null, fixed: false },
    },
  },
};

// Eski (v1) altın itemType → yeni ayar eşlemesi (migration için).
const LEGACY_GOLD_PURITY = {
  gram: '24',
  ceyrek: '22',
  yarim: '22',
  tam: '22',
  cumhuriyet: '22',
  '22ayar': '22',
};
// Yeni yapıda karşılığı olmayan eski itemType'lar için yeniden eşleme.
const LEGACY_ITEM_REMAP = {
  '22ayar': 'bilezik22',
};

/* ---------------- Motivasyon kartları ---------------- */
// V1: statik havuz. İleride 200-300 karta ve fiyat temelli kartlara büyüyecek.
// type alanı şimdiden ileri uyumluluk için: 'genel' | 'gunluk-ornek' | 'fiyat-dusus' | 'fiyat-artis'
const MOTIVATION_CARDS = [
  { id: 'm1', type: 'gunluk-ornek', text: 'Bir kahve birkaç dakikalık keyif verebilir. Bir gram altın yıllarca seninle kalabilir. İkisinin de yeri var.' },
  { id: 'm2', type: 'genel', text: 'Hayatı erteleme. Geleceğini de erteleme.' },
  { id: 'm3', type: 'genel', text: 'Bugün gelecekteki kendine küçük bir hediye bırak.' },
  { id: 'm4', type: 'genel', text: 'Fiyatlar değişir. Gramlar kalır.' },
  { id: 'm5', type: 'genel', text: 'Dokunuyorsan Senindir.' },
  { id: 'm6', type: 'genel', text: 'Hayatı yaşa. Geleceğini de unutma.' },
  { id: 'm7', type: 'genel', text: 'Küçük ama düzenli. Gerçek birikim böyle büyür.' },
  { id: 'm8', type: 'genel', text: 'Tohumlar fidana, gramlar eve, arabaya, tatile dönmeli yurdumda.' },
];

/* ---------------- Fiyat altyapısı (V1: canlı API yok) ---------------- */
// TODO: Güncel altın ve gümüş fiyatları güvenilir bir API'den çekilecek. (V2)
// V1'de canlı fiyat entegrasyonu YOK. Değerler manuel/demo olabilir veya boş kalır.
// Ana ekranda asla TL gösterilmez; tahmini değer yalnızca "Toplam Birikimim"
// ekranında, kullanıcı açıkça isterse gösterilir. Gram önce gelir, TL değeri sonra.
const DEFAULT_PRICE_STATE = {
  gold24BuyPricePerGramTRY: null,
  gold22BuyPricePerGramTRY: null,
  gold14BuyPricePerGramTRY: null,
  silverPricePerGramTRY: null,
  updatedAt: null,
};

// Demo değer denemek istersen yukarıdaki null'ları sayıyla değiştir, örn:
// gold24BuyPricePerGramTRY: 4250, gold22BuyPricePerGramTRY: 3900,
// gold14BuyPricePerGramTRY: 2500, silverPricePerGramTRY: 45, updatedAt: '2026-06-13'
// TEK KAYNAK: fiyatlar yalnızca data.priceState içinde tutulur (ayrı modül değişkeni yok).

/* ---------------- Günlük Piyasa (ana ekran bilgi kartı) ---------------- */
// TODO: Günlük Piyasa fiyatları canlı API'den marketState'e yazılacak. (V2)
// TODO: Günlük Piyasa kartı kullanıcı tarafından gizlenebilir yapılacak.
// marketState yalnızca ana ekrandaki Günlük Piyasa kartı içindir; priceState ile karışmaz.
const DEFAULT_MARKET_STATE = {
  goldGramTRY: null,
  silverGramTRY: null,
  updatedAt: null,
};

// Demo denemek için: goldGramTRY: 4250, silverGramTRY: 45, updatedAt: '2026-06-13T10:00:00'

/* ---------------- State ---------------- */
// Tam v2 şeması ile boş veri üretir (her sıfırlamada aynı eksiksiz şekil).
function emptyData() {
  return {
    version: DATA_VERSION,
    records: [],
    settings: { showEstimatedValue: false, name: null, nameAsked: false },
    priceState: { ...DEFAULT_PRICE_STATE },
    marketState: { ...DEFAULT_MARKET_STATE },
  };
}

let data = emptyData();
let formAsset = 'gold';          // kayıt formundaki aktif varlık
let formPurity = '24';           // altın seçiliyken aktif ayar sınıfı
let editRecordId = null;         // düzenleme modundaysak kayıt id'si
let deleteRecordId = null;

/* ---------------- Tarih yardımcıları ---------------- */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function monthKey(dateStr) {
  return dateStr.slice(0, 7); // YYYY-MM
}

function formatTurkishDate(s) {
  return parseDateStr(s).toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatMonthTitle(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('tr-TR', { year: 'numeric', month: 'long' });
}

function daysBetween(fromStr, toStr) {
  const from = parseDateStr(fromStr);
  const to = parseDateStr(toStr);
  const utcFrom = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const utcTo = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((utcTo - utcFrom) / 86400000);
}

/* ---------------- Genel yardımcılar ---------------- */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatGrams(n) {
  const num = Number(n) || 0;
  const rounded = Math.round(num * 100) / 100;
  const str = Number.isInteger(rounded)
    ? rounded.toLocaleString('tr-TR')
    : rounded.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
  return `${str} gr`;
}

function formatKg(n) {
  const kg = (Number(n) || 0) / 1000;
  const str = kg.toLocaleString('tr-TR', { maximumFractionDigits: 3 });
  return `${str} kg`;
}

function escapeHtml(t) {
  const d = document.createElement('div');
  d.textContent = t == null ? '' : t;
  return d.innerHTML;
}

// Aynı gün hep aynı kart (rastgele değil, kararlı seçim).
function stablePick(seed, options) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  return options[Math.abs(h) % options.length];
}

// Altında goldPurity zorunlu; gümüşte yok sayılır.
function getItemDef(assetType, itemType, goldPurity) {
  if (assetType === 'gold') {
    const purity = goldPurity || formPurity;
    return GOLD_PURITIES[purity]?.items[itemType] || null;
  }
  return ASSET_TYPES.silver?.items[itemType] || null;
}

function itemLabel(assetType, itemType, goldPurity) {
  return getItemDef(assetType, itemType, goldPurity)?.label || itemType;
}

function purityLabel(purity) {
  return GOLD_PURITIES[purity]?.label || '';
}

/* ---------------- Veri yükleme / kayıt ---------------- */
function loadData() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    const parsed = JSON.parse(stored);
    if (!parsed || !Array.isArray(parsed.records)) {
      data = emptyData();
      return;
    }

    const settings = normalizeSettings(parsed.settings);
    const priceState = normalizePriceState(parsed.priceState);
    const marketState = normalizeMarketState(parsed.marketState);

    if (parsed.version === DATA_VERSION) {
      data = {
        version: DATA_VERSION,
        records: parsed.records.map(normalizeRecord).filter(isValidRecord),
        settings,
        priceState,
        marketState,
      };
      return;
    }

    if (parsed.version === 1) {
      data = {
        version: DATA_VERSION,
        records: parsed.records.map(migrateRecordV1toV2).filter(isValidRecord),
        settings,
        priceState,
        marketState,
      };
      saveData();
      return;
    }

    // Bilinmeyen/eski şema: tam v2 şemasıyla güvenli sıfırlama.
    data = emptyData();
  } catch {
    data = emptyData();
  }
}

function normalizeSettings(s) {
  const src = s && typeof s === 'object' ? s : {};
  const name = typeof src.name === 'string' && src.name.trim() ? src.name.trim() : null;
  return {
    ...src,
    showEstimatedValue: src.showEstimatedValue === true,
    name,
    nameAsked: src.nameAsked === true,
  };
}

function normalizePriceState(p) {
  const src = p && typeof p === 'object' ? p : {};
  const out = { ...DEFAULT_PRICE_STATE };
  Object.keys(DEFAULT_PRICE_STATE).forEach((k) => {
    if (k === 'updatedAt') out[k] = typeof src[k] === 'string' ? src[k] : null;
    else out[k] = typeof src[k] === 'number' && src[k] > 0 ? src[k] : null;
  });
  return out;
}

function normalizeMarketState(m) {
  const src = m && typeof m === 'object' ? m : {};
  return {
    goldGramTRY: typeof src.goldGramTRY === 'number' && src.goldGramTRY > 0 ? src.goldGramTRY : null,
    silverGramTRY: typeof src.silverGramTRY === 'number' && src.silverGramTRY > 0 ? src.silverGramTRY : null,
    updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : null,
  };
}

// v1 → v2: altın kayıtlarına goldPurity ekle, gümüşte null.
function migrateRecordV1toV2(r) {
  if (!r || typeof r !== 'object') return r;
  if (r.assetType === 'gold') {
    const purity = LEGACY_GOLD_PURITY[r.itemType] || '22';
    const itemType = LEGACY_ITEM_REMAP[r.itemType] || r.itemType;
    return { ...r, itemType, goldPurity: purity };
  }
  return { ...r, goldPurity: null };
}

// v2 kayıtlarını güvenli hale getir (eksik goldPurity'i tamamla).
function normalizeRecord(r) {
  if (!r || typeof r !== 'object') return r;
  if (r.assetType === 'gold' && !GOLD_PURITY_ORDER.includes(r.goldPurity)) {
    return { ...r, goldPurity: LEGACY_GOLD_PURITY[r.itemType] || '22' };
  }
  if (r.assetType === 'silver' && r.goldPurity !== null) {
    return { ...r, goldPurity: null };
  }
  return r;
}

function isValidRecord(r) {
  return r
    && (r.assetType === 'gold' || r.assetType === 'silver')
    && typeof r.itemType === 'string'
    && Number(r.grams) > 0
    && typeof r.date === 'string';
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Kota dolu / depolama izni kapalı (ör. gizli mod) → uygulama çökmesin.
    showToast('Veri kaydedilemedi. Tarayıcı depolama iznini kontrol et.');
  }
}

/* ---------------- Hesaplamalar ---------------- */
function totalGrams(assetType) {
  return data.records
    .filter((r) => r.assetType === assetType)
    .reduce((sum, r) => sum + (Number(r.grams) || 0), 0);
}

function goldGramsByPurity(purity) {
  return data.records
    .filter((r) => r.assetType === 'gold' && r.goldPurity === purity)
    .reduce((sum, r) => sum + (Number(r.grams) || 0), 0);
}

/* ---------------- Tahmini değer (opsiyonel, ikincil) ---------------- */
const PURITY_PRICE_KEY = {
  '24': 'gold24BuyPricePerGramTRY',
  '22': 'gold22BuyPricePerGramTRY',
  '14': 'gold14BuyPricePerGramTRY',
};

function formatTRY(n) {
  return (Number(n) || 0).toLocaleString('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 0,
  });
}

function hasAnyPrice() {
  return Object.values(PURITY_PRICE_KEY)
    .concat('silverPricePerGramTRY')
    .some((k) => typeof data.priceState[k] === 'number' && data.priceState[k] > 0);
}

function estimateGoldValueTRY() {
  let value = 0;
  let ok = true;
  GOLD_PURITY_ORDER.forEach((p) => {
    const grams = goldGramsByPurity(p);
    if (grams <= 0) return;
    const price = data.priceState[PURITY_PRICE_KEY[p]];
    if (typeof price !== 'number' || price <= 0) { ok = false; return; }
    value += grams * price;
  });
  return { value, ok };
}

function estimateSilverValueTRY() {
  const grams = totalGrams('silver');
  if (grams <= 0) return { value: 0, ok: true };
  const price = data.priceState.silverPricePerGramTRY;
  if (typeof price !== 'number' || price <= 0) return { value: 0, ok: false };
  return { value: grams * price, ok: true };
}

function monthGrams(assetType, ym) {
  return data.records
    .filter((r) => r.assetType === assetType && monthKey(r.date) === ym)
    .reduce((sum, r) => sum + (Number(r.grams) || 0), 0);
}

function firstRecordDate() {
  if (!data.records.length) return null;
  return data.records.reduce((min, r) => (r.date < min ? r.date : min), data.records[0].date);
}

// Son 12 takvim ayında en az 1 kayıt bulunan farklı ay sayısı.
function activeMonthsLast12() {
  const now = new Date();
  const validKeys = new Set();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    validKeys.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const monthsWithRecords = new Set(
    data.records.map((r) => monthKey(r.date)).filter((k) => validKeys.has(k))
  );
  return monthsWithRecords.size;
}

/* ---------------- Ana ekran render ---------------- */
function renderHome() {
  const goldTotal = totalGrams('gold');
  const silverTotal = totalGrams('silver');
  const ym = monthKey(today());

  document.getElementById('gold-total-grams').textContent = formatGrams(goldTotal);
  document.getElementById('gold-total-kg').textContent = formatKg(goldTotal);
  document.getElementById('silver-total-grams').textContent = formatGrams(silverTotal);
  document.getElementById('silver-total-kg').textContent = formatKg(silverTotal);

  document.getElementById('gold-month-grams').textContent = formatGrams(monthGrams('gold', ym));
  document.getElementById('silver-month-grams').textContent = formatGrams(monthGrams('silver', ym));

  renderGreeting();
  renderGoldPurityBreakdown();
  renderJourney();
  renderMotivation();
  renderMarketCard();
}

// Başlık altında sıcak karşılama: kayıt yoksa "hoş geldin", varsa "devam et".
function renderGreeting() {
  const el = document.getElementById('brand-greeting');
  const name = data.settings.name;
  if (!name) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = data.records.length > 0
    ? `${name}, gramını büyütmeye devam et.`
    : `${name}, hoş geldin.`;
  el.classList.remove('hidden');
}

// 24/22/14 ayar kırılımı markup'ı — ana ekran ve Toplam Birikimim ortak kullanır.
function goldPurityBreakdownHtml() {
  return GOLD_PURITY_ORDER.map((p) => `
    <span class="purity-line">
      <span class="purity-name">${escapeHtml(purityLabel(p))}</span>
      <span class="purity-grams">${escapeHtml(formatGrams(goldGramsByPurity(p)))}</span>
    </span>`).join('');
}

// Birleşik altın toplamının altında küçük ayar kırılımı.
function renderGoldPurityBreakdown() {
  document.getElementById('gold-purity-breakdown').innerHTML = goldPurityBreakdownHtml();
}

// İlk kayıttan bu yana geçen süreyi gün/ay/yıl olarak ifade eder (1. gün hariç).
function journeyDurationText(days) {
  if (days >= 365) return `${Math.floor(days / 365)} yıl oldu`;
  if (days >= 30) return `${Math.floor(days / 30)} ay oldu`;
  return `${days} gün oldu`;
}

function renderJourney() {
  const first = firstRecordDate();
  const journeyCard = document.getElementById('journey-card');
  const startCard = document.getElementById('start-card');
  const firstEl = document.getElementById('journey-first-date');
  const daysEl = document.getElementById('journey-days');
  const rhythmEl = document.getElementById('journey-rhythm');

  // Henüz kayıt yokken: yolculuk kartını gizle, başlangıç kartını göster.
  if (!first) {
    journeyCard.classList.add('hidden');
    startCard.classList.remove('hidden');
    return;
  }
  // İlk kayıttan sonra başlangıç kartı tamamen kaybolur.
  startCard.classList.add('hidden');
  journeyCard.classList.remove('hidden');

  firstEl.textContent = formatTurkishDate(first);

  const labelEl = document.getElementById('journey-days-label');
  const daysRow = daysEl.closest('.journey-row');
  const days = Math.max(0, daysBetween(first, today()));

  if (days === 0) {
    // İlk gün özel hissettirsin: etiket gizlenir, tek satır vurgulanır.
    labelEl.classList.add('hidden');
    daysRow.classList.add('first-day');
    daysEl.textContent = 'Bugün başladın 🌱';
  } else {
    labelEl.classList.remove('hidden');
    daysRow.classList.remove('first-day');
    daysEl.textContent = journeyDurationText(days);
  }

  const active = activeMonthsLast12();
  rhythmEl.textContent = active > 0
    ? `Son 12 ayın ${active} ayında kayıt ekledin`
    : '—';
}

function renderMotivation() {
  const card = stablePick(`mot|${today()}`, MOTIVATION_CARDS);
  document.getElementById('motivation-text').textContent = card.text;
}

function formatMarketUpdatedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Günlük Piyasa: bilgilendirme amaçlı, portföy/kâr-zarar yok.
function renderMarketCard() {
  const body = document.getElementById('market-card-body');
  const m = data.marketState;
  const hasGold = typeof m.goldGramTRY === 'number' && m.goldGramTRY > 0;
  const hasSilver = typeof m.silverGramTRY === 'number' && m.silverGramTRY > 0;

  if (!hasGold && !hasSilver) {
    body.innerHTML = '<p class="market-empty">Fiyat bilgisi yakında eklenecek.</p>';
    return;
  }

  const updatedLine = m.updatedAt
    ? `<p class="market-updated">Son güncelleme: ${escapeHtml(formatMarketUpdatedAt(m.updatedAt))}</p>`
    : '';

  body.innerHTML = `
    <div class="market-rows">
      <div class="market-row">
        <span class="market-label">Gram Altın</span>
        <span class="market-value">${hasGold ? escapeHtml(formatTRY(m.goldGramTRY)) : '—'}</span>
      </div>
      <div class="market-row">
        <span class="market-label">Gram Gümüş</span>
        <span class="market-value">${hasSilver ? escapeHtml(formatTRY(m.silverGramTRY)) : '—'}</span>
      </div>
    </div>
    ${updatedLine}`;
}

/* ---------------- Toplam Birikimim render ---------------- */
function renderSavingsSummary() {
  document.getElementById('summary-gold-total').textContent = formatGrams(totalGrams('gold'));
  document.getElementById('summary-silver-total').textContent = formatGrams(totalGrams('silver'));
  document.getElementById('summary-purity-breakdown').innerHTML = goldPurityBreakdownHtml();
}

function renderEstimateOption() {
  const toggle = document.getElementById('estimate-toggle');
  toggle.checked = data.settings.showEstimatedValue === true;
  renderEstimatePanel();
}

function renderEstimatePanel() {
  const panel = document.getElementById('estimate-panel');
  const show = data.settings.showEstimatedValue === true;
  panel.classList.toggle('hidden', !show);
  if (!show) { panel.innerHTML = ''; return; }

  const gold = estimateGoldValueTRY();
  const silver = estimateSilverValueTRY();

  // Fiyat verisi yoksa veya tutan varlık için fiyat eksikse bilgilendirici mesaj.
  if (!hasAnyPrice() || !gold.ok || !silver.ok) {
    panel.innerHTML = `<p class="estimate-empty">Değer hesaplaması için fiyat bilgisi henüz eklenmedi.</p>`;
    return;
  }

  const total = gold.value + silver.value;
  panel.innerHTML = `
    <p class="estimate-lead">Bugünkü tahmini değer</p>
    <ul class="estimate-list">
      <li class="estimate-row"><span>🥇 Tahmini Altın Değeri</span><strong>${escapeHtml(formatTRY(gold.value))}</strong></li>
      <li class="estimate-row"><span>🥈 Tahmini Gümüş Değeri</span><strong>${escapeHtml(formatTRY(silver.value))}</strong></li>
      <li class="estimate-row estimate-row-total"><span>Toplam Tahmini Değer</span><strong>${escapeHtml(formatTRY(total))}</strong></li>
    </ul>
    <p class="estimate-note">Gram önce gelir, değer sonra. Tahmini değer bilgilendirme amaçlıdır.</p>`;
}

/* ---------------- Kayıt listesi render ---------------- */
function renderHistory() {
  renderSavingsSummary();
  renderEstimateOption();

  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');

  if (!data.records.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const sorted = [...data.records].sort((a, b) => {
    if (a.date !== b.date) return b.date < a.date ? -1 : 1;
    return (b.createdAt || '') < (a.createdAt || '') ? -1 : 1;
  });

  const groups = new Map();
  sorted.forEach((r) => {
    const key = monthKey(r.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });

  list.innerHTML = [...groups.entries()].map(([ym, records]) => {
    const items = records.map(renderHistoryItem).join('');
    return `<div class="history-month-group">
      <p class="history-month-title">${escapeHtml(formatMonthTitle(ym))}</p>
      ${items}
    </div>`;
  }).join('');
}

function renderHistoryItem(r) {
  const asset = ASSET_TYPES[r.assetType];
  const def = getItemDef(r.assetType, r.itemType, r.goldPurity);
  // Örnek: 22 Ayar · 1 adet · 1,75 gr  (ürün adı üstte başlık olarak gösterilir)
  const parts = [];
  if (r.assetType === 'gold' && r.goldPurity) parts.push(purityLabel(r.goldPurity));
  if (def?.fixed && r.quantity >= 1) parts.push(`${r.quantity} adet`);
  parts.push(formatGrams(r.grams));
  const metaLine = parts.map(escapeHtml).join(' · ');
  const note = r.note
    ? `<p class="history-item-note">“${escapeHtml(r.note)}”</p>`
    : '';
  return `<div class="history-item asset-${r.assetType}" data-id="${r.id}">
    <span class="history-item-icon" aria-hidden="true">${asset.icon}</span>
    <div class="history-item-info">
      <p class="history-item-name">${escapeHtml(itemLabel(r.assetType, r.itemType, r.goldPurity))}</p>
      <p class="history-item-meta">${metaLine}</p>
      <p class="history-item-sub">${escapeHtml(formatTurkishDate(r.date))}</p>
      ${note}
    </div>
    <div class="history-item-actions">
      <button type="button" class="btn-icon" data-action="edit-record" data-id="${r.id}" aria-label="Düzenle">✏️</button>
      <button type="button" class="btn-icon" data-action="delete-record" data-id="${r.id}" aria-label="Sil">🗑️</button>
    </div>
  </div>`;
}

/* ---------------- Görünüm yönetimi ---------------- */
function switchView(view) {
  document.getElementById('home-view').classList.toggle('hidden', view !== 'home');
  document.getElementById('add-view').classList.toggle('hidden', view !== 'add');
  document.getElementById('history-view').classList.toggle('hidden', view !== 'history');
  if (view === 'home') renderHome();
  else if (view === 'history') renderHistory();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------- Kayıt formu ---------------- */
function currentFormItems() {
  if (formAsset === 'gold') return GOLD_PURITIES[formPurity].items;
  return ASSET_TYPES.silver.items;
}

function populateItemSelect() {
  const sel = document.getElementById('item-type');
  const items = currentFormItems();
  sel.innerHTML = Object.entries(items)
    .map(([key, def]) => `<option value="${key}">${escapeHtml(def.label)}</option>`)
    .join('');
}

function renderPuritySegment() {
  const seg = document.getElementById('purity-segment');
  seg.innerHTML = GOLD_PURITY_ORDER.map((p) => {
    const active = p === formPurity ? ' active' : '';
    return `<button type="button" class="segment-btn${active}" data-purity="${p}" role="tab">${escapeHtml(GOLD_PURITIES[p].label)}</button>`;
  }).join('');
}

function setFormAsset(asset) {
  formAsset = asset;
  document.querySelectorAll('#asset-segment .segment-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.asset === asset);
  });
  // Ayar seçimi yalnızca altında gösterilir.
  document.getElementById('purity-field').classList.toggle('hidden', asset !== 'gold');
  if (asset === 'gold') renderPuritySegment();
  populateItemSelect();
  syncItemFields();
}

function setFormPurity(purity) {
  formPurity = GOLD_PURITY_ORDER.includes(purity) ? purity : '24';
  document.querySelectorAll('#purity-segment .segment-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.purity === formPurity);
  });
  populateItemSelect();
  syncItemFields();
}

// Seçili ürüne göre adet/gram alanlarını ve önizlemeyi günceller.
function syncItemFields() {
  const itemType = document.getElementById('item-type').value;
  const def = getItemDef(formAsset, itemType, formPurity);
  const quantityField = document.getElementById('quantity-field');
  const gramsField = document.getElementById('grams-field');

  if (!def) return;

  if (def.fixed) {
    quantityField.classList.remove('hidden');
    gramsField.classList.add('hidden');
  } else {
    quantityField.classList.add('hidden');
    gramsField.classList.remove('hidden');
  }
  updateGramsPreview();
}

// Aktif giriş değerlerinden bu kaydın toplam gramını hesaplar.
function computeFormGrams() {
  const itemType = document.getElementById('item-type').value;
  const def = getItemDef(formAsset, itemType, formPurity);
  if (!def) return 0;
  if (def.fixed) {
    const qty = Math.max(1, parseInt(document.getElementById('quantity').value, 10) || 1);
    return Math.round(def.unitGrams * qty * 100) / 100;
  }
  const g = parseFloat(document.getElementById('grams-input').value);
  return Number.isNaN(g) || g <= 0 ? 0 : Math.round(g * 100) / 100;
}

function updateGramsPreview() {
  const grams = computeFormGrams();
  const preview = document.getElementById('grams-preview');
  if (grams > 0) {
    preview.textContent = `Bu kayıt: ${formatGrams(grams)}`;
  } else {
    preview.textContent = '';
  }
}

function openAddForm() {
  editRecordId = null;
  document.getElementById('add-title').textContent = 'Gram Ekle';
  document.getElementById('add-desc').textContent = 'Biriktirdiğin fiziksel altın veya gümüşü ekle.';
  document.getElementById('record-submit').textContent = 'Gram Ekle';
  document.getElementById('record-form').reset();
  document.getElementById('quantity').value = '1';
  document.getElementById('record-date').value = today();
  formPurity = '24';
  setFormAsset('gold');
  document.getElementById('item-type').value = 'gram';
  syncItemFields();
  switchView('add');
}

function openEditForm(id) {
  const r = data.records.find((x) => x.id === id);
  if (!r) return;
  editRecordId = id;
  document.getElementById('add-title').textContent = 'Kaydı Düzenle';
  document.getElementById('add-desc').textContent = 'Bu kaydın bilgilerini güncelle.';
  document.getElementById('record-submit').textContent = 'Güncelle';
  document.getElementById('record-form').reset();

  if (r.assetType === 'gold') formPurity = GOLD_PURITY_ORDER.includes(r.goldPurity) ? r.goldPurity : '22';
  setFormAsset(r.assetType);
  if (r.assetType === 'gold') setFormPurity(formPurity);

  const sel = document.getElementById('item-type');
  sel.value = r.itemType;
  syncItemFields();

  const def = getItemDef(r.assetType, r.itemType, r.goldPurity);
  if (def?.fixed) {
    document.getElementById('quantity').value = String(r.quantity || 1);
  } else {
    document.getElementById('grams-input').value = String(r.grams);
  }
  document.getElementById('record-date').value = r.date;
  document.getElementById('record-note').value = r.note || '';
  updateGramsPreview();
  switchView('add');
}

function submitRecordForm() {
  const itemType = document.getElementById('item-type').value;
  const def = getItemDef(formAsset, itemType, formPurity);
  if (!def) return;

  const grams = computeFormGrams();
  if (grams <= 0) {
    showToast('Lütfen geçerli bir gram değeri gir.');
    return;
  }

  const quantity = def.fixed
    ? Math.max(1, parseInt(document.getElementById('quantity').value, 10) || 1)
    : 1;
  const goldPurity = formAsset === 'gold' ? formPurity : null;
  const date = document.getElementById('record-date').value || today();
  const note = document.getElementById('record-note').value.trim();

  if (editRecordId) {
    const r = data.records.find((x) => x.id === editRecordId);
    if (r) {
      r.assetType = formAsset;
      r.itemType = itemType;
      r.goldPurity = goldPurity;
      r.grams = grams;
      r.quantity = quantity;
      r.note = note;
      r.date = date;
    }
    saveData();
    editRecordId = null;
    switchView('history');
    showToast('Kayıt güncellendi.');
    return;
  }

  const record = {
    id: generateId(),
    assetType: formAsset,
    itemType,
    goldPurity,
    grams,
    quantity,
    note,
    date,
    createdAt: new Date().toISOString(),
  };
  data.records.push(record);
  saveData();
  showCelebration(record);
}

/* ---------------- Kutlama ---------------- */
function showCelebration(record) {
  const goldTotal = totalGrams('gold');
  const silverTotal = totalGrams('silver');
  const addedGold = record.assetType === 'gold';

  // Eklenen miktar satırı (ayar bilgisi varsa göster).
  const addedAmount = formatGrams(record.grams);
  const addedLine = addedGold
    ? `Bugün <strong>${escapeHtml(purityLabel(record.goldPurity))}</strong> altın birikimine <strong>${escapeHtml(addedAmount)}</strong> ekledin.`
    : `Bugün gümüş birikimine <strong>${escapeHtml(addedAmount)}</strong> ekledin.`;

  const stats = [];
  stats.push(`<li class="celebrate-stat just-added">
    <span class="stat-emoji" aria-hidden="true">${addedGold ? '🥇' : '🥈'}</span>
    <span>${addedLine}</span>
  </li>`);
  stats.push(`<li class="celebrate-stat">
    <span class="stat-emoji" aria-hidden="true">🥇</span>
    <span>Altın varlığın <strong>${escapeHtml(formatGrams(goldTotal))}</strong>'a ulaştı.</span>
  </li>`);
  stats.push(`<li class="celebrate-stat">
    <span class="stat-emoji" aria-hidden="true">🥈</span>
    <span>Gümüş varlığın <strong>${escapeHtml(formatGrams(silverTotal))}</strong>'a ulaştı.</span>
  </li>`);

  document.getElementById('celebrate-stats').innerHTML = stats.join('');
  document.getElementById('celebrate-overlay').classList.remove('hidden');
}

function closeCelebration() {
  document.getElementById('celebrate-overlay').classList.add('hidden');
  switchView('home');
}

/* ---------------- Silme ---------------- */
function openDeleteModal(id) {
  const r = data.records.find((x) => x.id === id);
  if (!r) return;
  deleteRecordId = id;
  const purityPrefix = r.assetType === 'gold' && r.goldPurity ? `${purityLabel(r.goldPurity)} · ` : '';
  document.getElementById('delete-record-name').textContent =
    `${purityPrefix}${itemLabel(r.assetType, r.itemType, r.goldPurity)} · ${formatGrams(r.grams)}`;
  document.getElementById('delete-overlay').classList.remove('hidden');
}

function closeDeleteModal() {
  deleteRecordId = null;
  document.getElementById('delete-overlay').classList.add('hidden');
}

function confirmDelete() {
  if (!deleteRecordId) return;
  data.records = data.records.filter((r) => r.id !== deleteRecordId);
  saveData();
  closeDeleteModal();
  renderGreeting();
  renderHistory();
  showToast('Kayıt silindi.');
}

/* ---------------- İsim (ilk açılışta bir kez) ---------------- */
function maybeAskName() {
  if (data.settings.nameAsked) return;
  const input = document.getElementById('name-input');
  input.value = '';
  document.getElementById('name-overlay').classList.remove('hidden');
  setTimeout(() => input.focus(), 60);
}

function submitName() {
  const value = document.getElementById('name-input').value.trim();
  data.settings.name = value || null;
  data.settings.nameAsked = true; // boş geçilse de tekrar sorulmaz
  saveData();
  document.getElementById('name-overlay').classList.add('hidden');
  renderGreeting();
}

/* ---------------- Toast ---------------- */
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), 2400);
}

/* ---------------- Olaylar ---------------- */
document.getElementById('open-add-btn').addEventListener('click', openAddForm);
document.getElementById('open-history-btn').addEventListener('click', () => switchView('history'));
document.getElementById('add-back-btn').addEventListener('click', () => switchView('home'));
document.getElementById('history-back-btn').addEventListener('click', () => switchView('home'));

document.getElementById('asset-segment').addEventListener('click', (e) => {
  const btn = e.target.closest('.segment-btn');
  if (btn) setFormAsset(btn.dataset.asset);
});

document.getElementById('purity-segment').addEventListener('click', (e) => {
  const btn = e.target.closest('.segment-btn');
  if (btn) setFormPurity(btn.dataset.purity);
});

document.getElementById('item-type').addEventListener('change', syncItemFields);
document.getElementById('quantity').addEventListener('input', updateGramsPreview);
document.getElementById('grams-input').addEventListener('input', updateGramsPreview);

document.getElementById('qty-minus').addEventListener('click', () => {
  const input = document.getElementById('quantity');
  input.value = String(Math.max(1, (parseInt(input.value, 10) || 1) - 1));
  updateGramsPreview();
});
document.getElementById('qty-plus').addEventListener('click', () => {
  const input = document.getElementById('quantity');
  input.value = String((parseInt(input.value, 10) || 1) + 1);
  updateGramsPreview();
});

document.getElementById('record-form').addEventListener('submit', (e) => {
  e.preventDefault();
  submitRecordForm();
});

document.getElementById('estimate-toggle').addEventListener('change', (e) => {
  data.settings.showEstimatedValue = e.target.checked;
  saveData();
  renderEstimatePanel();
});

document.getElementById('history-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  if (action === 'edit-record') openEditForm(id);
  else if (action === 'delete-record') openDeleteModal(id);
});

document.getElementById('name-form').addEventListener('submit', (e) => {
  e.preventDefault();
  submitName();
});

document.getElementById('celebrate-close').addEventListener('click', closeCelebration);
document.getElementById('delete-cancel').addEventListener('click', closeDeleteModal);
document.getElementById('delete-confirm').addEventListener('click', confirmDelete);
document.getElementById('delete-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'delete-overlay') closeDeleteModal();
});

/* ---------------- Başlat ---------------- */
loadData();
setFormAsset('gold');
switchView('home');
maybeAskName();

/* ---------------- Service worker (PWA) ---------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
