/* ═══════════════════════════════════════════
   AirValo PRO — App Logic v3
   French labels, theme toggle, thin chart borders
   ═══════════════════════════════════════════ */

// Force Swiss-style single quote thousands separator for toLocaleString
const _origToLocaleString = Number.prototype.toLocaleString;
Number.prototype.toLocaleString = function(locale, options) {
    if (options) {
        return _origToLocaleString.call(this, locale, options);
    }
    const parts = this.toString().split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, "'");
    return parts.join('.');
};

let activeCity = 'vaud';
let activeView = 'overview';
let map = null;
let mapMarkers = [];
let radiusLayer = null;          // geographic circles showing the attractivity reach
let charts = {};
const cityData = {};
let mapFilterListingIds = null;  // IDs of listings to filter on the map
let lastSimulationComps = null;  // comps from the last simulation run

// Radii (metres) MUST mirror the data pipeline (compute_attractivity.py):
// amenities use a 1500 m radius, transit accessibility a reduced ~1000 m (train).
const MAP_RADII = { attract: 1500, transit: 1000 };

const CITY_META = {
    geneva: { lat: 46.2044, lng: 6.1432, zoom: 12, label: 'Genève' },
    zurich: { lat: 47.3769, lng: 8.5417, zoom: 12, label: 'Zurich' },
    vaud:   { lat: 46.5197, lng: 6.6323, zoom: 10, label: 'Vaud' },
};

// ═══════════════════════════════════════════
// SENTIMENT / EXPÉRIENCE VOYAGEURS
// Themes come from the NLP analysis of Airbnb guest comments
// (data/vaud_sentiment.json). Each theme gets an icon + colour so the
// map card, the attractivity view and the simulator share one visual language.
// ═══════════════════════════════════════════
const THEME_META = {
    'Confort / équipements':        { icon: '🛋️', color: '#FF5A5F' },
    'Communication hôte / accueil': { icon: '💬', color: '#0ea5e9' },
    'Vue / paysage':                { icon: '🏔️', color: '#27ae60' },
    'Localisation':                 { icon: '📍', color: '#9b59b6' },
    'Propreté':                     { icon: '🧼', color: '#16a085' },
    'Transports / accès':           { icon: '🚆', color: '#2980b9' },
    'Check-in / arrivée':           { icon: '🔑', color: '#e67e22' },
    'Calme / bruit':                { icon: '🔇', color: '#7f8c8d' },
    'Restaurants / commerces':      { icon: '🍽️', color: '#d35400' },
    'Ski / nature':                 { icon: '⛷️', color: '#3498db' },
    'Prix / valeur':                { icon: '💰', color: '#f39c12' },
    'Parking':                      { icon: '🅿️', color: '#34495e' },
};
const themeMeta = label => THEME_META[label] || { icon: '•', color: '#9aa0a6' };

// Reliability of a commune's sample (number of reviews) → colour + tooltip.
// Mirrors the « Fiabilité » column in the analysis document.
const FIABILITE_META = {
    'Très bonne': { color: '#27ae60', hint: 'Échantillon large — lecture solide.' },
    'Bonne':      { color: '#2ecc71', hint: 'Bon volume d’avis — lecture fiable.' },
    'Moyenne':    { color: '#f39c12', hint: 'Volume modéré — tendance indicative.' },
    'Faible':     { color: '#e67e22', hint: 'Peu d’avis — à interpréter avec prudence.' },
    'Très faible':{ color: '#e74c3c', hint: 'Très peu d’avis — signal fragile.' },
};
const fiabiliteMeta = label => FIABILITE_META[label] || { color: '#9aa0a6', hint: '' };

// Accessor: sentiment record for a commune (matches listing.nh / neighbourhood).
function getCommuneSentiment(commune) {
    return cityData[activeCity]?.sentiment?.byCommune?.[commune] || null;
}

// Build the shared « Expérience voyageurs » block for one commune.
// Used by the map detail card and the simulator result.
function communeSentimentHtml(commune, { compact = false } = {}) {
    const s = getCommuneSentiment(commune);
    if (!s) return '';
    const fm = fiabiliteMeta(s.fiabilite);
    const themesHtml = (s.themes || []).slice(0, 3).map(t => {
        const m = themeMeta(t.label);
        return `<span class="sent-theme" title="${t.label} — mentionné dans ${t.pct.toFixed(0)}% des avis">
                    <span class="sent-ico">${m.icon}</span>${t.label}
                    <span class="sent-pct" style="color:${m.color}">${t.pct.toFixed(0)}%</span>
                </span>`;
    }).join('');
    const frictions = (s.frictions || []).filter(f => f.pct > 0).slice(0, 2);
    const frictionsHtml = frictions.length
        ? frictions.map(f => `<span class="sent-friction" title="${f.label} — signal négatif dans ${f.pct.toFixed(0)}% des avis">⚠️ ${f.label} <em>${f.pct.toFixed(0)}%</em></span>`).join('')
        : `<span class="sent-friction sent-friction-none">Aucune friction marquée</span>`;
    return `
        <div class="sent-block${compact ? ' sent-compact' : ''}">
            <div class="sent-head">
                <span class="sent-title">💬 Expérience voyageurs</span>
                <span class="sent-fiab" style="--fc:${fm.color}" title="Fiabilité de l'échantillon : ${fm.hint} (${s.avis.toLocaleString('fr-CH')} avis)">${s.fiabilite}</span>
            </div>
            <div class="sent-themes-label">Ce que les voyageurs remarquent</div>
            <div class="sent-themes">${themesHtml}</div>
            <div class="sent-frictions">${frictionsHtml}</div>
            ${s.conseil ? `<div class="sent-conseil"><span class="sent-conseil-tag">Conseil</span>${s.conseil}</div>` : ''}
            <div class="sent-source">Basé sur ${s.avis.toLocaleString('fr-CH')} avis Airbnb (${s.logementsAvecAvis} logement${s.logementsAvecAvis > 1 ? 's' : ''} commenté${s.logementsAvecAvis > 1 ? 's' : ''}) — non le nombre d'annonces actives.</div>
        </div>`;
}

// Chart.js global config
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.color = '#717171';
// Airbnb Chart Colors
const C = {
    coral:     'rgba(255, 90, 95, 0.85)',
    coralBg:   'rgba(255, 90, 95, 0.4)',
    teal:      'rgba(0, 166, 153, 0.85)',
    tealBg:    'rgba(0, 166, 153, 0.4)',
    orange:    'rgba(252, 100, 45, 0.85)',
    orangeBg:  'rgba(252, 100, 45, 0.4)',
    pink:      'rgba(227, 28, 95, 0.85)',
    yellow:    'rgba(255, 180, 0, 0.85)',
    yellowBg:  'rgba(255, 180, 0, 0.4)',
    green:     'rgba(0, 132, 137, 0.85)',
    greenBg:   'rgba(0, 132, 137, 0.12)',
    purple:    'rgba(145, 70, 105, 0.85)',
    purpleBg:  'rgba(145, 70, 105, 0.12)',
};

// Libellés FR pour les types de logement (les données brutes restent en anglais).
const ROOM_TYPE_FR = {
    'Entire home/apt': 'Logement entier',
    'Private room':    'Chambre privée',
    'Shared room':     'Chambre partagée',
    'Hotel room':      "Chambre d'hôtel",
};
function roomTypeFr(type) {
    return ROOM_TYPE_FR[type] || type;
}

// Abréviations de mois EN -> FR pour les axes des graphiques.
const MONTH_FR = {
    Jan: 'Janv', Feb: 'Févr', Mar: 'Mars', Apr: 'Avr', May: 'Mai', Jun: 'Juin',
    Jul: 'Juil', Aug: 'Août', Sep: 'Sept', Oct: 'Oct', Nov: 'Nov', Dec: 'Déc',
};
function monthFr(m) {
    return MONTH_FR[m] || m;
}

function getChartTextColor() {
    return document.body.getAttribute('data-theme') === 'dark' ? '#A0A8C0' : '#717171';
}
function getChartGridColor() {
    return document.body.getAttribute('data-theme') === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
}

// Auto-interpretation under a chart. Disabled as per user request to remove comments under charts.
function setChartInsight(canvasId, html) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const panel = canvas.closest('.chart-panel') || canvas.parentElement;
    if (!panel) return;
    let cap = panel.querySelector(':scope > .chart-insight');
    if (cap) cap.remove();
}

// ─── Absolute score color scale (4 tiers, monotonic heat) ───
// Used EVERYWHERE a score appears so the user always sees the same mapping:
//   map dots, detail card, legends, recommendations.
const SCORE_TIERS = [
    { min: 0,  max: 30,  color: '#94a3b8', label: 'Limité',    hint: 'Potentiel faible' },
    { min: 30, max: 50,  color: '#fbbf24', label: 'Moyen',     hint: 'À surveiller' },
    { min: 50, max: 70,  color: '#00a699', label: 'Bon',       hint: 'Intéressant' },
    { min: 70, max: 101, color: '#FF5A5F', label: 'Excellent', hint: 'Top potentiel' },
];
function getScoreColor(score) {
    const s = Number(score) || 0;
    for (const t of SCORE_TIERS) if (s >= t.min && s < t.max) return t.color;
    return SCORE_TIERS[SCORE_TIERS.length - 1].color;
}
function getScoreTierIndex(score) {
    const s = Number(score) || 0;
    for (let i = 0; i < SCORE_TIERS.length; i++) {
        if (s >= SCORE_TIERS[i].min && s < SCORE_TIERS[i].max) return i;
    }
    return SCORE_TIERS.length - 1;
}
// Percentile of `value` within `sortedAsc`, 0..100. Uses binary search.
function percentileRank(sortedAsc, value) {
    if (!sortedAsc.length) return 0;
    let lo = 0, hi = sortedAsc.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sortedAsc[mid] < value) lo = mid + 1; else hi = mid;
    }
    return (lo / sortedAsc.length) * 100;
}

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
    // Load saved theme
    const saved = localStorage.getItem('airvalo-theme');
    if (saved === 'dark') document.body.setAttribute('data-theme', 'dark');

    setupNavigation();
    setupSliders();
    setupThemeToggle();
    setupCustomDropdowns();
    loadCity(activeCity);
});

// ═══════════════════════════════════════════
// CUSTOM AIRBNB DROPDOWNS
// ═══════════════════════════════════════════
function setupCustomDropdowns() {
    // Toggle dropdown on filter-group click if it contains a dropdown
    document.querySelectorAll('.filter-group').forEach(group => {
        const dd = group.querySelector('.custom-dropdown');
        if (dd) {
            group.addEventListener('click', (e) => {
                e.stopPropagation();
                const wasOpen = dd.classList.contains('open');
                // Close all first
                document.querySelectorAll('.custom-dropdown.open').forEach(d => d.classList.remove('open'));
                if (!wasOpen) dd.classList.add('open');
            });
        }
    });

    // Item selection
    document.querySelectorAll('.custom-dropdown .dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const dd = item.closest('.custom-dropdown');
            const sel = document.getElementById(dd.dataset.for);
            
            // Update hidden select
            sel.value = item.dataset.value;
            sel.dispatchEvent(new Event('change'));
            
            // Update UI
            dd.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            // Update trigger text
            dd.querySelector('.trigger-text').textContent = item.textContent;

            // Close
            dd.classList.remove('open');
        });
    });

    // Click outside closes all
    document.addEventListener('click', () => {
        document.querySelectorAll('.custom-dropdown.open').forEach(d => d.classList.remove('open'));
    });

    // Escape key closes all
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') document.querySelectorAll('.custom-dropdown.open').forEach(d => d.classList.remove('open'));
    });

    // Prevent clicks inside panel from closing
    document.querySelectorAll('.dropdown-panel').forEach(panel => {
        panel.addEventListener('click', (e) => e.stopPropagation());
    });
}

// ═══════════════════════════════════════════
// THEME TOGGLE
// ═══════════════════════════════════════════
function setupThemeToggle() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    updateThemeIcon();
    btn.addEventListener('click', () => {
        const isDark = document.body.getAttribute('data-theme') === 'dark';
        if (isDark) {
            document.body.removeAttribute('data-theme');
            localStorage.setItem('airvalo-theme', 'light');
        } else {
            document.body.setAttribute('data-theme', 'dark');
            localStorage.setItem('airvalo-theme', 'dark');
        }
        updateThemeIcon();
        updateChartColors();
    });
}
function updateThemeIcon() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    btn.textContent = isDark ? '☀️' : '🌙';
    btn.title = isDark ? 'Mode clair' : 'Mode sombre';
}
function updateChartColors() {
    Chart.defaults.color = getChartTextColor();
    Chart.defaults.borderColor = getChartGridColor();
    // Re-render current view
    const data = cityData[activeCity];
    if (data) {
        if (activeView === 'overview') renderOverview(data);
        if (activeView === 'analysis') renderAnalysis();
    }
}

// ═══════════════════════════════════════════
// SLIDER TRACK FILL
// ═══════════════════════════════════════════
function setupSliders() {
    document.querySelectorAll('input[type="range"]').forEach(slider => {
        updateSliderTrack(slider);
        slider.addEventListener('input', () => updateSliderTrack(slider));
    });
}
function updateSliderTrack(slider) {
    const min = parseFloat(slider.min), max = parseFloat(slider.max), val = parseFloat(slider.value);
    slider.style.setProperty('--slider-pct', ((val - min) / (max - min)) * 100 + '%');
}

// ═══════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════
function setupNavigation() {
    // ── Desktop nav tabs ──
    document.querySelectorAll('.nav-tabs .nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            mapFilterListingIds = null;
            document.querySelectorAll('.nav-tabs .nav-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            // Sync mobile menu
            document.querySelectorAll('.mobile-menu-item').forEach(m => m.classList.remove('active'));
            const mobileMatch = document.querySelector(`.mobile-menu-item[data-view="${tab.dataset.view}"]`);
            if (mobileMatch) mobileMatch.classList.add('active');
            switchView(tab.dataset.view);
        });
    });

    // ── Mobile burger menu ──
    const burgerBtn = document.getElementById('burger-btn');
    const mobileOverlay = document.getElementById('mobile-menu-overlay');
    const mobileDropdown = document.getElementById('mobile-menu-dropdown');

    function openMobileMenu() {
        mobileOverlay.classList.add('show');
        mobileDropdown.classList.add('show');
    }
    function closeMobileMenu() {
        mobileOverlay.classList.remove('show');
        mobileDropdown.classList.remove('show');
    }

    if (burgerBtn) {
        burgerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (mobileDropdown.classList.contains('show')) {
                closeMobileMenu();
            } else {
                openMobileMenu();
            }
        });
    }
    if (mobileOverlay) {
        mobileOverlay.addEventListener('click', closeMobileMenu);
    }

    // ── In-page CTA buttons (hero, etc.) — `data-go-view` avoids colliding
    //    with the existing `data-view` handlers on nav tabs / mobile items.
    document.querySelectorAll('[data-go-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.goView;
            // Sync nav active states so the chrome reflects where we landed
            document.querySelectorAll('.nav-tabs .nav-tab').forEach(t => t.classList.remove('active'));
            const navMatch = document.querySelector(`.nav-tabs .nav-tab[data-view="${target}"]`);
            if (navMatch) navMatch.classList.add('active');
            document.querySelectorAll('.mobile-menu-item').forEach(m => m.classList.remove('active'));
            const mobMatch = document.querySelector(`.mobile-menu-item[data-view="${target}"]`);
            if (mobMatch) mobMatch.classList.add('active');
            switchView(target);
        });
    });

    // ── Mobile menu items ──
    document.querySelectorAll('.mobile-menu-item[data-view]').forEach(item => {
        item.addEventListener('click', () => {
            mapFilterListingIds = null;
            // Update mobile active state
            document.querySelectorAll('.mobile-menu-item').forEach(m => m.classList.remove('active'));
            item.classList.add('active');
            // Sync desktop nav tabs
            document.querySelectorAll('.nav-tabs .nav-tab').forEach(t => t.classList.remove('active'));
            const desktopMatch = document.querySelector(`.nav-tabs .nav-tab[data-view="${item.dataset.view}"]`);
            if (desktopMatch) desktopMatch.classList.add('active');
            switchView(item.dataset.view);
            closeMobileMenu();
        });
    });
    // ── City selectors (desktop + mobile) ──
    function selectCity(city) {
        document.querySelectorAll('.city-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.mobile-city-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll(`.city-btn[data-city="${city}"]`).forEach(b => b.classList.add('active'));
        document.querySelectorAll(`.mobile-city-btn[data-city="${city}"]`).forEach(b => b.classList.add('active'));
        if (city !== activeCity) { activeCity = city; loadCity(activeCity); }
    }
    document.querySelectorAll('.city-btn').forEach(btn => {
        btn.addEventListener('click', () => selectCity(btn.dataset.city));
    });
    document.querySelectorAll('.mobile-city-btn').forEach(btn => {
        btn.addEventListener('click', () => selectCity(btn.dataset.city));
    });
    // Map filters
    ['map-min-score', 'map-min-price'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => { document.getElementById(id + '-val').textContent = el.value; renderMap(); });
    });
    ['map-color-by', 'map-room-type'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', renderMap);
    });
    // Analysis filters
    ['analysis-nh', 'analysis-type'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', renderAnalysis);
    });
    ['analysis-max-price', 'analysis-min-score'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => { document.getElementById(id + '-val').textContent = el.value; renderAnalysis(); });
    });

    const clearMapFilterBtn = document.getElementById('btn-clear-map-filter');
    if (clearMapFilterBtn) {
        clearMapFilterBtn.addEventListener('click', () => {
            mapFilterListingIds = null;
            renderMap();
        });
    }
}

function switchView(viewId) {
    activeView = viewId;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + viewId)?.classList.add('active');
    if (viewId === 'map') setTimeout(() => { if (!map) initMap(); else map.invalidateSize(); renderMap(); }, 100);
    if (viewId === 'analysis') renderAnalysis();
    if (viewId === 'attractivity') renderAttractivity();
    if (viewId === 'simulator') setupSimulator();
}

// ═══════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════
async function loadCity(cityId) {
    if (!cityData[cityId]) {
        try {
            // Cache-bust all data fetches so pipeline reruns are picked up
            // without forcing the user to hard-reload. Using `no-store` ensures
            // neither memory nor disk cache returns stale pipeline output.
            const noCache = { cache: 'no-store' };
            const fetches = [
                fetch(`data/${cityId}_listings.json`, noCache).then(r => r.json()),
                fetch(`data/${cityId}_neighborhoods.json`, noCache).then(r => r.json()),
                fetch(`data/${cityId}_property_types.json`, noCache).then(r => r.json()),
                fetch(`data/${cityId}_seasonal.json`, noCache).then(r => r.json()),
            ];
            const [listings, neighborhoods, propertyTypes, seasonal] = await Promise.all(fetches);
            cityData[cityId] = { listings, neighborhoods, propertyTypes, seasonal };

            // Load attractivity data for Vaud
            if (cityId === 'vaud') {
                try {
                    const [attractivity, weights, npa, sentiment, seasonalByNh] = await Promise.all([
                        fetch('data/vaud_attractivity.json', noCache).then(r => r.json()),
                        fetch('data/attractivity_weights.json', noCache).then(r => r.json()),
                        fetch('data/vaud_npa.json', noCache).then(r => r.ok ? r.json() : null).catch(() => null),
                        fetch('data/vaud_sentiment.json', noCache).then(r => r.ok ? r.json() : null).catch(() => null),
                        fetch('data/vaud_seasonal_by_nh.json', noCache).then(r => r.ok ? r.json() : null).catch(() => null),
                    ]);
                    cityData[cityId].attractivity = attractivity;
                    cityData[cityId].attractivityWeights = weights;
                    cityData[cityId].npa = npa;
                    cityData[cityId].sentiment = sentiment;
                    cityData[cityId].seasonalByNh = seasonalByNh;
                } catch (e) { console.warn('Attractivity data not available:', e); }
            }
        } catch (e) { console.error('Erreur chargement:', cityId, e); return; }
    }
    // Show/hide attractivity tab
    const hasAttractivity = !!cityData[cityId]?.attractivity;
    const navTab = document.getElementById('nav-tab-attractivity');
    const mobileTab = document.getElementById('mobile-tab-attractivity');
    if (navTab) navTab.classList.toggle('hidden', !hasAttractivity);
    if (mobileTab) mobileTab.classList.toggle('hidden', !hasAttractivity);
    // If switching away from vaud while on attractivity view, go to overview
    if (!hasAttractivity && activeView === 'attractivity') switchView('overview');
    // Hero title is static editorial copy ("Le Canton de Vaud, vu par la donnée") —
    // no longer overwritten from JS since the city selector is Vaud-only.
    populateAnalysisNhDropdown();
    populateSimulatorCommunes();
    renderOverview(cityData[cityId]);
    if (activeView === 'map') { map?.setView([CITY_META[cityId].lat, CITY_META[cityId].lng], CITY_META[cityId].zoom); renderMap(); }
    if (activeView === 'analysis') renderAnalysis();
    if (activeView === 'attractivity') renderAttractivity();
}

function populateAnalysisNhDropdown() {
    const sel = document.getElementById('analysis-nh');
    if (!sel) return;
    const data = cityData[activeCity];
    if (!data?.neighborhoods) return;

    // Update hidden select
    sel.innerHTML = '<option value="all">Tous les quartiers</option>';
    data.neighborhoods.forEach(n => { const o = document.createElement('option'); o.value = n.nh; o.textContent = n.nh; sel.appendChild(o); });

    // Update custom dropdown panel
    const dd = document.querySelector('.custom-dropdown[data-for="analysis-nh"]');
    if (!dd) return;
    const panel = dd.querySelector('.dropdown-panel');
    panel.innerHTML = '';

    // Add "all" option
    const allItem = document.createElement('div');
    allItem.className = 'dropdown-item active';
    allItem.dataset.value = 'all';
    allItem.innerHTML = `<div class="dd-icon-box">📍</div><div class="dd-text-box"><span class="dd-title">Tous les quartiers</span><span class="dd-subtitle">Vue globale de la ville</span></div>`;
    panel.appendChild(allItem);

    // Add neighborhood options
    data.neighborhoods.forEach(n => {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.dataset.value = n.nh;
        const icon = n.avg_score > 60 ? '🌟' : (n.avg_score > 40 ? '⭐' : '📍');
        item.innerHTML = `<div class="dd-icon-box">${icon}</div><div class="dd-text-box"><span class="dd-title">${n.nh}</span><span class="dd-subtitle">Score : ${n.avg_score.toFixed(1)} | CHF ${Math.round(n.avg_revenue).toLocaleString('fr-CH')}</span></div>`;
        panel.appendChild(item);
    });

    // Re-attach click handlers for new items
    panel.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            sel.value = item.dataset.value;
            sel.dispatchEvent(new Event('change'));
            panel.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            const titleSpan = item.querySelector('.dd-title');
            dd.querySelector('.trigger-text').textContent = titleSpan ? titleSpan.textContent : item.textContent;
            dd.classList.remove('open');
        });
    });

    // Reset trigger text
    dd.querySelector('.trigger-text').textContent = 'Tous les quartiers';
}

// ═══════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════
function renderOverview(data) {
    const { listings, neighborhoods, propertyTypes } = data;
    const n = listings.length;
    let sS = 0, sR = 0, sO = 0, sP = 0;
    listings.forEach(l => { sS += l.score; sR += l.revenue; sO += l.occupancy; sP += l.price; });
    animateValue('kpi-score', n > 0 ? (sS / n).toFixed(1) : '0');
    animateValue('kpi-revenue', `CHF ${n > 0 ? Math.round(sR / n).toLocaleString() : '0'}`);
    animateValue('kpi-occupancy', n > 0 ? Math.round(sO / n).toString() : '0');
    animateValue('kpi-price', `CHF ${n > 0 ? Math.round(sP / n).toLocaleString() : '0'}`);
    animateValue('kpi-listings', n.toLocaleString());
    renderTopNhChart(neighborhoods.slice(0, 8));
    renderPropertyTypeChart(propertyTypes);
}
function animateValue(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('animate-in'); void el.offsetWidth;
    el.textContent = text; el.classList.add('animate-in');
}

// ═══════════════════════════════════════════
// CHARTS
// ═══════════════════════════════════════════
function destroyChart(key) { if (charts[key]) { charts[key].destroy(); charts[key] = null; } }

function renderTopNhChart(nh) {
    destroyChart('topNh');
    const ctx = document.getElementById('chart-top-nh');
    if (!ctx) return;
    const gridColor = getChartGridColor();
    charts.topNh = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: nh.map(n => n.nh.length > 18 ? n.nh.substring(0, 18) + '…' : n.nh),
            datasets: [
                { label: 'Score d\'investissement', data: nh.map(n => n.avg_score),
                  backgroundColor: nh.map((_, i) => i === 0 ? C.coral : C.coralBg),
                  borderColor: nh.map(() => 'rgba(255,90,95,0.4)'),
                  borderWidth: 0, borderRadius: 6, yAxisID: 'y' },
                { label: 'Revenu moyen (CHF)', data: nh.map(n => n.avg_revenue), type: 'line',
                  borderColor: C.teal, backgroundColor: C.tealBg, pointBackgroundColor: C.teal,
                  borderWidth: 2, pointRadius: 3, tension: 0.4, yAxisID: 'y1', fill: true }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 16, font: { size: 11 } } } },
            scales: {
                y:  { beginAtZero: true, position: 'left', title: { display: true, text: 'Score' }, grid: { color: gridColor } },
                y1: { beginAtZero: true, position: 'right', title: { display: true, text: 'Revenu (CHF)' }, grid: { display: false } },
                x:  { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 10 } } }
            }
        }
    });
    if (nh.length) {
        const top = nh[0];
        const richest = [...nh].sort((a, b) => b.avg_revenue - a.avg_revenue)[0];
        const sameTop = richest.nh === top.nh;
        setChartInsight('chart-top-nh',
            `<strong>${top.nh}</strong> est le quartier le mieux noté (<strong>${Number(top.avg_score).toFixed(0)}/100</strong>)` +
            (sameTop
                ? `, et c'est aussi celui au revenu annuel moyen le plus élevé (CHF ${Math.round(top.avg_revenue).toLocaleString('fr-CH')}).`
                : `, tandis que <strong>${richest.nh}</strong> affiche le revenu annuel moyen le plus élevé (CHF ${Math.round(richest.avg_revenue).toLocaleString('fr-CH')}).`));
    }
}

function renderPropertyTypeChart(pt) {
    destroyChart('propType');
    const ctx = document.getElementById('chart-property-type');
    if (!ctx) return;
    const colors = [C.coral, C.teal, C.orange, C.purple];
    charts.propType = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: pt.map(p => roomTypeFr(p.type)),
            datasets: [{ label: 'Revenu moyen (CHF)', data: pt.map(p => p.avg_revenue),
                backgroundColor: pt.map((_, i) => colors[i % colors.length]), borderWidth: 0, borderRadius: 8 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, indexAxis: 'y',
            plugins: { legend: { display: false },
                tooltip: { callbacks: { afterLabel: ctx => { const d = pt[ctx.dataIndex]; return `Score: ${d.avg_score} | Annonces: ${d.count} | Occ: ${d.avg_occupancy}j`; } } } },
            scales: { x: { beginAtZero: true, grid: { color: getChartGridColor() } }, y: { grid: { display: false } } }
        }
    });
    // Best occupation/revenue balance, ignoring marginal categories (few listings).
    const meaningful = pt.filter(p => p.count >= 20);
    const pool = meaningful.length ? meaningful : pt;
    if (pool.length) {
        const maxRev = Math.max(...pool.map(p => p.avg_revenue)) || 1;
        const maxOcc = Math.max(...pool.map(p => p.avg_occupancy)) || 1;
        const best = [...pool].sort((a, b) =>
            (b.avg_revenue / maxRev + b.avg_occupancy / maxOcc) -
            (a.avg_revenue / maxRev + a.avg_occupancy / maxOcc))[0];
        setChartInsight('chart-property-type',
            `Les <strong>${roomTypeFr(best.type)}</strong> offrent le meilleur équilibre entre occupation et revenu annuel ` +
            `(CHF ${Math.round(best.avg_revenue).toLocaleString('fr-CH')}/an pour ${Math.round(best.avg_occupancy)} jours d'occupation).`);
    }
}

// ═══════════════════════════════════════════
// MAP
// ═══════════════════════════════════════════
function initMap() {
    const meta = CITY_META[activeCity];
    map = L.map('map-container', { zoomControl: false, attributionControl: false }).setView([meta.lat, meta.lng], meta.zoom);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19 }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    // Dedicated pane for the attractivity rings, placed BELOW the marker layer
    // (overlayPane z-index = 400) so their semi-transparent fill never steals
    // clicks from the listing dots sitting inside the radius. Tooltips on the
    // rings still work wherever they aren't covered by a dot.
    map.createPane('radiusPane');
    map.getPane('radiusPane').style.zIndex = 350;
}

function renderMap() {
    if (!map) return;
    const data = cityData[activeCity];
    if (!data?.listings) return;
    mapMarkers.forEach(m => map.removeLayer(m)); mapMarkers = [];
    clearRadius();

    const colorBy = document.getElementById('map-color-by')?.value || 'score';
    const roomFilter = document.getElementById('map-room-type')?.value || 'all';
    const minScore = parseInt(document.getElementById('map-min-score')?.value || '0', 10);
    const minPrice = parseInt(document.getElementById('map-min-price')?.value || '0', 10);

    let filtered = data.listings.filter(l => l.score >= minScore && l.price >= minPrice);
    if (roomFilter !== 'all') filtered = filtered.filter(l => l.type === roomFilter);

    // Apply simulation filter banner and listings restriction
    const banner = document.getElementById('map-filter-banner');
    if (mapFilterListingIds) {
        filtered = filtered.filter(l => mapFilterListingIds.includes(l.id));
        if (banner) {
            banner.classList.remove('hidden');
            const txt = banner.querySelector('.mfb-text');
            if (txt) txt.textContent = `🔍 Affichage de ${filtered.length} comparable${filtered.length > 1 ? 's' : ''} de la simulation`;
        }
    } else {
        if (banner) banner.classList.add('hidden');
    }

    // Precompute ABSOLUTE distribution for non-score metrics (computed once on the
    // full canton dataset, NOT on the filtered subset) so the colour of any dot is
    // stable whatever filter the user applies. For 'score' we use fixed tiers.
    const allValsSorted = colorBy !== 'score'
        ? data.listings.map(l => Number(l[colorBy]) || 0).sort((a, b) => a - b)
        : null;

    const meta = CITY_META[activeCity];
    if (mapFilterListingIds && filtered.length > 0) {
        const points = filtered.map(l => [l.lat, l.lng]);
        map.fitBounds(points, { padding: [50, 50] });
    } else {
        map.setView([meta.lat, meta.lng], meta.zoom);
    }

    filtered.forEach(l => {
        const raw = Number(l[colorBy]) || 0;
        // Map EVERY metric to a 0..100 "goodness" so we can reuse SCORE_TIERS.
        // - score: identity
        // - revenue / occupancy: higher = better → percentile rank
        // - price: lower = better for an investor (cheaper acquisition / night)
        //          → invert the percentile so cheap biens get high tiers
        let goodness;
        if (colorBy === 'score') goodness = raw;
        else {
            const pct = percentileRank(allValsSorted, raw);
            goodness = colorBy === 'price' ? (100 - pct) : pct;
        }
        const color = getScoreColor(goodness);
        const tierIdx = getScoreTierIndex(goodness);
        const radius = 5 + tierIdx * 2; // 5, 7, 9, 11 — bigger = better
        const circle = L.circleMarker([l.lat, l.lng], {
            radius, color, fillColor: color,
            fillOpacity: 0.65, weight: 1.5,
            opacity: 0.9,
        }).addTo(map);
        circle.on('click', () => showMapDetail(l));
        circle.bindTooltip(
            `<strong style="color:${color}">Score ${l.score}/100</strong><br>` +
            `CHF ${l.price}/nuit · CHF ${Math.round(l.revenue).toLocaleString()}/an`
        );
        mapMarkers.push(circle);
    });
    renderMapLegend(colorBy);
    document.getElementById('map-detail')?.classList.add('hidden');
}

function renderMapLegend(metricKey) {
    const el = document.getElementById('map-legend');
    if (!el) return;
    const metricLabels = {
        score:     "Score d'investissement",
        revenue:   'Revenu annuel',
        price:     'Prix par nuit',
        occupancy: 'Occupation annuelle',
    };
    const metricHints = {
        score:     'Combinaison pondérée de 6 facteurs : revenu, occupation, attractivité, saturation, rendement et stabilité.',
        revenue:   'Quartiles sur tous les biens du Canton — plus haut = mieux.',
        occupancy: "Quartiles sur tous les biens du Canton — plus de nuitées = mieux.",
        price:     "Quartiles inversés : les biens les moins chers sont colorés comme 'meilleurs' (coût d'acquisition nuitée plus bas).",
    };
    // Range labels differ by metric
    const rangeLabels = metricKey === 'score'
        ? ['0 – 30', '30 – 50', '50 – 70', '70 – 100']
        : metricKey === 'price'
            ? ['Top 25% cher', '25 – 50%', '50 – 75%', 'Top 25% abordable']
            : ['Bas 25%', '25 – 50%', '50 – 75%', 'Top 25%'];
    el.innerHTML = `
        <div class="ml-head">
            <span class="ml-eyebrow">Légende carte</span>
            <span class="ml-metric">${metricLabels[metricKey] || metricKey}</span>
        </div>
        <div class="ml-scale">
            ${SCORE_TIERS.map((t, i) => `
                <div class="ml-step">
                    <span class="ml-dot" style="background:${t.color};width:${10 + i * 3}px;height:${10 + i * 3}px;"></span>
                    <span class="ml-range">${rangeLabels[i]}</span>
                    <span class="ml-label">${t.label}</span>
                </div>
            `).join('')}
        </div>
        <p class="ml-hint">${metricHints[metricKey] || ''}</p>
        <p class="ml-tip">La taille du point suit le même niveau — plus c'est gros, plus le potentiel est fort.</p>
    `;
}

// Draw the geographic analysis radius around the selected listing so the user
// can SEE the zone the attractivity score is computed over (and the tighter
// transit-proximity ring). Cleared and redrawn on every selection.
function clearRadius() {
    if (radiusLayer && map) { map.removeLayer(radiusLayer); radiusLayer = null; }
}
function showAttractivityRadius(l) {
    if (!map || l?.lat == null || l?.lng == null) return;
    clearRadius();
    const center = [l.lat, l.lng];
    const outer = L.circle(center, {
        pane: 'radiusPane',
        radius: MAP_RADII.attract,
        color: '#FF5A5F', weight: 1.5, opacity: 0.7,
        fillColor: '#FF5A5F', fillOpacity: 0.07,
    });
    const transit = L.circle(center, {
        pane: 'radiusPane',
        radius: MAP_RADII.transit,
        color: '#0ea5e9', weight: 1.5, opacity: 0.8,
        fillColor: '#0ea5e9', fillOpacity: 0.05,
        dashArray: '5 5',
    });
    const pin = L.circleMarker(center, {
        pane: 'radiusPane',
        radius: 4, color: '#fff', weight: 2,
        fillColor: '#FF5A5F', fillOpacity: 1,
    });
    outer.bindTooltip(`Zone d'attractivité analysée · ${MAP_RADII.attract} m`, { sticky: true });
    transit.bindTooltip(`Proximité transports (gare ≤ ${MAP_RADII.transit} m)`, { sticky: true });
    radiusLayer = L.layerGroup([outer, transit, pin]).addTo(map);
    // Frame the zone so the radius is clearly visible.
    map.fitBounds(outer.getBounds(), { padding: [40, 40], maxZoom: 15 });
}

function showMapDetail(l) {
    const card = document.getElementById('map-detail');
    if (!card) return;
    showAttractivityRadius(l);
    card.classList.remove('hidden');
    // Some Airbnb hosts write titles all-lowercase ("chambre privée dans villa
    // paisible") which reads like a comment. Force a proper sentence start —
    // keep existing internal casing (NYON, Airbnb, etc.) to preserve intent.
    const rawName = (l.name || ('Annonce #' + l.id)).trim();
    const prettyName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : rawName;
    document.getElementById('detail-name').textContent = prettyName;
    document.getElementById('detail-score').textContent = l.score + '/100';
    document.getElementById('detail-score').style.color = getScoreColor(l.score);
    document.getElementById('detail-price').textContent = 'CHF ' + l.price;

    // Attractivity sub-scores (Vaud only)
    const attractDiv = document.getElementById('detail-attractivity');
    const barsDiv = document.getElementById('detail-attract-bars');
    if (attractDiv && barsDiv && l.cultural !== undefined) {
        attractDiv.classList.remove('hidden');
        const factors = [
            { label: 'Culture', score: l.cultural, color: '#9b59b6' },
            { label: 'Sport', score: l.sports, color: '#27ae60' },
            { label: 'Resto', score: l.restaurant, color: '#e67e22' },
            { label: 'Emploi', score: l.employment, color: '#3498db' },
            { label: 'Transport', score: l.transport ?? 0, color: '#0ea5e9' },
        ];
        barsDiv.innerHTML = factors.map(f => `
            <div class="da-bar">
                <span class="da-label">${f.label}</span>
                <div class="da-track"><div class="da-fill" style="width:${f.score}%;background:${f.color};"></div></div>
                <span class="da-val">${f.score.toFixed(0)}</span>
            </div>
        `).join('');
    } else if (attractDiv) {
        attractDiv.classList.add('hidden');
    }
    document.getElementById('detail-revenue').textContent = 'CHF ' + l.revenue.toLocaleString();
    document.getElementById('detail-occupancy').textContent = l.occupancy + ' jours';
    document.getElementById('detail-type').textContent = roomTypeFr(l.type);
    const prixEl = document.getElementById('detail-prix-m2');
    if (prixEl) prixEl.textContent = l.prix_m2 ? 'CHF ' + Number(l.prix_m2).toLocaleString() : '—';
    const npaEl = document.getElementById('detail-npa');
    if (npaEl) npaEl.textContent = l.npa || '—';

    // Guest-experience block (sentiment) for the listing's commune.
    const sentEl = document.getElementById('detail-sentiment');
    if (sentEl) sentEl.innerHTML = communeSentimentHtml(l.nh, { compact: true });
}

// ═══════════════════════════════════════════
// ANALYSIS (with filters)
// ═══════════════════════════════════════════
function getFilteredListings() {
    const data = cityData[activeCity];
    if (!data?.listings) return [];
    const nhF = document.getElementById('analysis-nh')?.value || 'all';
    const typeF = document.getElementById('analysis-type')?.value || 'all';
    const maxP = parseFloat(document.getElementById('analysis-max-price')?.value || '1000');
    const minScore = parseFloat(document.getElementById('analysis-min-score')?.value || '0');
    return data.listings.filter(l => {
        if (nhF !== 'all' && l.nh !== nhF) return false;
        if (typeF !== 'all' && l.type !== typeF) return false;
        if (l.price > maxP) return false;
        if (l.score < minScore) return false;
        return true;
    });
}

function renderAnalysis() {
    const data = cityData[activeCity];
    if (!data) return;
    const filtered = getFilteredListings();
    const n = filtered.length;
    let sR = 0, sO = 0, sS = 0;
    filtered.forEach(l => { sR += l.revenue; sO += l.occupancy; sS += l.score; });
    animateValue('analysis-kpi-count', n.toLocaleString());
    animateValue('analysis-kpi-revenue', `CHF ${n > 0 ? Math.round(sR / n).toLocaleString() : '0'}`);
    animateValue('analysis-kpi-occ', n > 0 ? Math.round(sO / n).toString() : '0');
    animateValue('analysis-kpi-score', n > 0 ? (sS / n).toFixed(1) : '0');

    // Type distribution
    const typeMap = {};
    filtered.forEach(l => { typeMap[l.type] = (typeMap[l.type] || 0) + 1; });
    const filteredTypes = Object.entries(typeMap).map(([type, count]) => ({ type, count }));

    // Seasonal occupancy — follows the selected quartier (real per-neighbourhood
    // calendar data). Falls back to the canton-wide curve when the quartier has
    // too few listings or "Tous les quartiers" is selected.
    const nhF = document.getElementById('analysis-nh')?.value || 'all';
    const byNh = data.seasonalByNh || {};
    const hasNh = nhF !== 'all' && Array.isArray(byNh[nhF]);
    const seasonalSeries = hasNh ? byNh[nhF] : (byNh.all || data.seasonal || []);
    const seasonalLabel = hasNh ? nhF : 'Canton de Vaud';
    const seasonalNote = (!hasNh && nhF !== 'all') ? ' · données quartier insuffisantes' : '';
    renderSeasonalChart(seasonalSeries, seasonalLabel, seasonalNote);

    renderRadarChart(data.neighborhoods);
    renderDoughnutChart(filteredTypes);
}

// Seasonal occupancy chart — reacts to the selected quartier.
// `seasonal` is a 12-month array [{month, occupancy_rate}], `scopeLabel` is the
// quartier name (or "Canton de Vaud"), `note` an optional caveat.
function renderSeasonalChart(seasonal, scopeLabel, note) {
    destroyChart('seasonal');
    const scopeEl = document.getElementById('seasonal-scope');
    if (scopeEl) scopeEl.textContent = scopeLabel ? `· ${scopeLabel}${note || ''}` : '';
    const ctx = document.getElementById('chart-seasonal');
    if (!ctx || !seasonal?.length) return;
    charts.seasonal = new Chart(ctx, {
        type: 'line',
        data: {
            labels: seasonal.map(s => monthFr(s.month)),
            datasets: [{
                label: `Taux d'occupation (%)${scopeLabel ? ' — ' + scopeLabel : ''}`,
                data: seasonal.map(s => s.occupancy_rate),
                borderColor: C.teal, backgroundColor: C.tealBg,
                borderWidth: 2, pointRadius: 4, tension: 0.4, fill: true,
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 16 } } },
            scales: {
                x: { grid: { display: false } },
                y: { beginAtZero: true, max: 100, title: { display: true, text: 'Occupation (%)' }, grid: { color: getChartGridColor() } }
            }
        }
    });
    renderSeasonalStats(seasonal);

    // Auto-interpretation
    const vals = seasonal.map(s => s.occupancy_rate).filter(v => typeof v === 'number');
    if (vals.length >= 2) {
        const best = seasonal.reduce((a, b) => b.occupancy_rate > a.occupancy_rate ? b : a);
        const worst = seasonal.reduce((a, b) => b.occupancy_rate < a.occupancy_rate ? b : a);
        const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
        const cv = mean > 0 ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length) / mean : 0;
        const level = cv < 0.10 ? 'faible' : cv < 0.25 ? 'modérée' : 'forte';
        const advice = cv < 0.10 ? 'revenus réguliers toute l\'année'
                     : cv < 0.25 ? 'demande assez stable, avec une haute saison marquée'
                     : 'revenus concentrés sur la haute saison';
        setChartInsight('chart-seasonal',
            `À <strong>${scopeLabel || 'l\'échelle du canton'}</strong>, l'occupation est maximale en <strong>${monthFr(best.month)}</strong> ` +
            `(${Math.round(best.occupancy_rate)}%) et minimale en <strong>${monthFr(worst.month)}</strong> (${Math.round(worst.occupancy_rate)}%) : ` +
            `saisonnalité ${level} — ${advice}.`);
    }
}

// Résumé de saisonnalité : meilleur mois, mois le plus creux et coefficient
// de variation (écart-type / moyenne) calculés sur le taux d'occupation
// du quartier sélectionné.
function renderSeasonalStats(seasonal) {
    const box = document.getElementById('seasonal-stats');
    if (!box) return;
    const vals = seasonal.map(s => s.occupancy_rate).filter(v => typeof v === 'number');
    if (vals.length < 2) { box.innerHTML = ''; return; }

    const best  = seasonal.reduce((a, b) => b.occupancy_rate > a.occupancy_rate ? b : a);
    const worst = seasonal.reduce((a, b) => b.occupancy_rate < a.occupancy_rate ? b : a);
    const mean  = vals.reduce((s, v) => s + v, 0) / vals.length;
    const std   = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    const cv    = mean > 0 ? std / mean : 0;
    const cvPct = Math.round(cv * 100);
    const level = cv < 0.10 ? 'faible' : cv < 0.25 ? 'modérée' : 'forte';

    box.innerHTML = `
        <div class="seasonal-stat is-high">
            <span class="seasonal-stat-label">Meilleur mois</span>
            <span class="seasonal-stat-value">${monthFr(best.month)} · ${Math.round(best.occupancy_rate)}%</span>
            <span class="seasonal-stat-hint">Occupation la plus haute</span>
        </div>
        <div class="seasonal-stat is-low">
            <span class="seasonal-stat-label">Mois le plus creux</span>
            <span class="seasonal-stat-value">${monthFr(worst.month)} · ${Math.round(worst.occupancy_rate)}%</span>
            <span class="seasonal-stat-hint">Occupation la plus basse</span>
        </div>
        <div class="seasonal-stat is-cv">
            <span class="seasonal-stat-label">Coefficient de variation</span>
            <span class="seasonal-stat-value">${cvPct}%</span>
            <span class="seasonal-stat-hint">Saisonnalité ${level} (écart-type / moyenne)</span>
        </div>`;
}

function renderRadarChart(neighborhoods) {
    destroyChart('radar');
    const ctx = document.getElementById('chart-radar');
    if (!ctx || !neighborhoods?.length) return;
    const nhF = document.getElementById('analysis-nh')?.value || 'all';
    const top = nhF !== 'all' ? (neighborhoods.find(n => n.nh === nhF) || neighborhoods[0]) : neighborhoods[0];
    charts.radar = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['Revenu', 'Occupation', 'Attractivité', 'Saturation', 'Rendement', 'Stabilité'],
            datasets: [{ label: top.nh, data: [
                    top.avg_rev_score || 0,
                    top.avg_occ_score || 0,
                    top.avg_attract_score || 0,
                    top.avg_saturation_score || 0,
                    top.avg_yield_score || 0,
                    top.avg_stability_score || 0
                ],
                borderColor: C.coral, backgroundColor: C.coralBg, pointBackgroundColor: C.coral, borderWidth: 2, pointRadius: 3 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { r: { min: 0, max: 100, ticks: { stepSize: 20, color: getChartTextColor(), backdropColor: 'transparent' },
                grid: { color: getChartGridColor(), lineWidth: 0.5 }, pointLabels: { color: getChartTextColor(), font: { size: 11 } },
                angleLines: { color: getChartGridColor(), lineWidth: 0.5 } } },
            plugins: { legend: { labels: { color: '#FF5A5F', font: { weight: 'bold' } } } }
        }
    });
    // Auto-interpretation: strongest & weakest scoring dimension.
    const factors = [
        { k: 'avg_rev_score', label: 'le revenu' },
        { k: 'avg_occ_score', label: "l'occupation" },
        { k: 'avg_attract_score', label: "l'attractivité" },
        { k: 'avg_saturation_score', label: 'la faible saturation' },
        { k: 'avg_yield_score', label: 'le rendement' },
        { k: 'avg_stability_score', label: 'la stabilité' },
    ].map(f => ({ ...f, v: top[f.k] || 0 }));
    const strong = factors.reduce((a, b) => b.v > a.v ? b : a);
    const weak = factors.reduce((a, b) => b.v < a.v ? b : a);
    setChartInsight('chart-radar',
        `<strong>${top.nh}</strong> se distingue surtout par <strong>${strong.label}</strong> (${Math.round(strong.v)}/100) ` +
        `et reste plus en retrait sur <strong>${weak.label}</strong> (${Math.round(weak.v)}/100).`);
}

function renderDoughnutChart(types) {
    destroyChart('doughnut');
    const ctx = document.getElementById('chart-doughnut');
    if (!ctx || !types) return;
    const colors = [C.coral, C.teal, C.orange, C.purple, C.yellow];
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    charts.doughnut = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: types.map(p => roomTypeFr(p.type)),
            datasets: [{ data: types.map(p => p.count),
                backgroundColor: types.map((_, i) => colors[i % colors.length]),
                borderColor: isDark ? 'rgba(22,33,62,0.6)' : 'rgba(255,255,255,0.8)',
                borderWidth: 1.5 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '65%',
            plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 12, font: { size: 11 } } } }
        }
    });
    const total = types.reduce((s, p) => s + p.count, 0);
    if (total > 0) {
        const dom = [...types].sort((a, b) => b.count - a.count)[0];
        setChartInsight('chart-doughnut',
            `Les <strong>${roomTypeFr(dom.type)}</strong> dominent l'offre (${Math.round(dom.count / total * 100)}% des annonces filtrées).`);
    }
}

// ═══════════════════════════════════════════
// ATTRACTIVITY VIEW (Vaud only)
// ═══════════════════════════════════════════
function renderAttractivity() {
    const data = cityData[activeCity];
    if (!data?.attractivity) return;
    const attractivity = data.attractivity;
    const weightsConfig = data.attractivityWeights;

    // Render weight bars
    renderWeightBars(weightsConfig);

    // Render the canton-wide guest-experience (sentiment) block
    renderExperienceVoyageurs(data.sentiment);

    // Render district ranking cards
    renderDistrictCards(attractivity, weightsConfig);

    // Render fine NPA ranking
    renderNpaRanking(data.npa, weightsConfig);

    // Render charts
    renderAttractivityRadar(attractivity, weightsConfig);
    renderAttractivityBar(attractivity);
    renderPoiStackedChart(attractivity, weightsConfig);
}

// Canton-wide guest-experience block: per-theme mention bars with the
// friction share highlighted, plus the global sentiment split and the
// analyst's reading note. Driven by data/vaud_sentiment.json.
function renderExperienceVoyageurs(sentiment) {
    const section = document.getElementById('experience-section');
    if (!section) return;
    if (!sentiment?.globalThemes?.length) { section.style.display = 'none'; return; }
    section.style.display = '';

    const themes = [...sentiment.globalThemes].sort((a, b) => b.mentions - a.mentions);
    const maxMentions = Math.max(...themes.map(t => t.mentions), 1);
    const themesEl = document.getElementById('exp-themes');
    if (themesEl) {
        themesEl.innerHTML = themes.map(t => {
            const m = themeMeta(t.theme);
            const w = (t.mentions / maxMentions) * 100;             // bar width relative to top theme
            const fr = t.mentions > 0 ? (t.frictions / t.mentions) * 100 : 0; // friction share of the bar
            return `
                <div class="exp-theme-row" title="${t.theme} : mentionné dans ${t.mentions.toFixed(1)}% des avis, dont ${t.frictions.toFixed(1)}% en friction">
                    <span class="exp-theme-name"><span class="exp-theme-ico">${m.icon}</span>${t.theme}</span>
                    <div class="exp-theme-track">
                        <div class="exp-theme-fill" style="width:${w.toFixed(1)}%;background:${m.color}">
                            <div class="exp-theme-friction" style="width:${fr.toFixed(1)}%"></div>
                        </div>
                    </div>
                    <span class="exp-theme-val">${t.mentions.toFixed(0)}%<em>${t.frictions.toFixed(0)}% friction</em></span>
                </div>`;
        }).join('');
    }

    // Global sentiment split (positif / mixte / neutre / négatif)
    const sentEl = document.getElementById('exp-sentiment');
    const sm = sentiment.sentiment;
    if (sentEl && sm) {
        const segs = [
            { k: 'positif', label: 'Positif', color: '#27ae60' },
            { k: 'mixte',   label: 'Mixte',   color: '#f39c12' },
            { k: 'neutre',  label: 'Neutre',  color: '#9aa0a6' },
            { k: 'negatif', label: 'Négatif', color: '#e74c3c' },
        ].filter(s => sm[s.k] != null);
        sentEl.innerHTML = `
            <div class="exp-sent-title">Tonalité globale des avis</div>
            <div class="exp-sent-bar">
                ${segs.map(s => `<span style="width:${sm[s.k]}%;background:${s.color}" title="${s.label} : ${sm[s.k]}%"></span>`).join('')}
            </div>
            <div class="exp-sent-legend">
                ${segs.map(s => `<span><span class="exp-sent-dot" style="background:${s.color}"></span>${s.label} <strong>${sm[s.k]}%</strong></span>`).join('')}
            </div>`;
    }

    const noteEl = document.getElementById('exp-note');
    if (noteEl) {
        noteEl.innerHTML = `<strong>À lire avec recul&nbsp;:</strong> les avis Airbnb sont structurellement très positifs. Les <em>thèmes</em> (ce dont on parle) et les <em>frictions</em> (ce qui agace) sont plus actionnables que la tonalité brute. ${sentiment.meta?.note ? `<br><span class="exp-note-src">${sentiment.meta.note}</span>` : ''}`;
    }
}

// Sort keys → accessor on an NPA aggregate row.
const NPA_SORTERS = {
    attract:   z => z.avg_attract_score ?? 0,
    transport: z => z.avg_transport_score ?? 0,
    score:     z => z.avg_score ?? 0,
    revenue:   z => z.avg_revenue ?? 0,
    occupancy: z => z.avg_occupancy ?? 0,
    price:     z => z.avg_price ?? 0,
    count:     z => z.count ?? 0,
};

function renderNpaRanking(npaData, config) {
    const section = document.getElementById('npa-section');
    const container = document.getElementById('npa-ranking');
    if (!container) return;
    if (!Array.isArray(npaData) || !npaData.length) {
        if (section) section.style.display = 'none';
        return;
    }
    if (section) section.style.display = '';
    wireNpaExplorer();

    const cats = config.categories;

    // Legend — explains every number shown on a card.
    const legendEl = document.getElementById('npa-legend');
    if (legendEl) {
        const chips = Object.values(cats).map(cat =>
            `<span class="npa-leg-item"><span class="npa-leg-dot" style="background:${cat.color}"></span>${cat.icon} ${cat.label}</span>`
        ).join('');
        legendEl.innerHTML = `
            <span class="npa-leg-note"><strong>Comment lire :</strong> le grand chiffre = score d'attractivité local moyen de la zone <strong>/100</strong>. Chaque pastille = sous-score <strong>/100</strong> d'un facteur (plus c'est haut, mieux la zone est dotée) :</span>
            <span class="npa-leg-cats">${chips}</span>`;
    }
    const query   = (document.getElementById('npa-search')?.value || '').trim().toLowerCase();
    const sortKey = document.getElementById('npa-sort')?.value || 'attract';
    const minCount = parseInt(document.getElementById('npa-min-count')?.value || '3', 10);
    const sorter = NPA_SORTERS[sortKey] || NPA_SORTERS.attract;

    let rows = npaData.filter(z => z.count >= minCount);
    if (query) {
        rows = rows.filter(z =>
            String(z.npa).toLowerCase().includes(query) ||
            (z.commune || '').toLowerCase().includes(query)
        );
    }
    rows.sort((a, b) => sorter(b) - sorter(a));

    const countEl = document.getElementById('npa-count');
    if (countEl) countEl.textContent = `${rows.length} zone${rows.length > 1 ? 's' : ''}`;

    const moreEl = document.getElementById('npa-more');
    if (!rows.length) {
        container.innerHTML = `<div class="npa-empty">Aucune zone NPA ne correspond à ces critères.</div>`;
        if (moreEl) moreEl.innerHTML = '';
        return;
    }

    // Collapsed by default: show the top NPA_COLLAPSED, reveal the rest on demand.
    const visible = npaExpanded ? rows : rows.slice(0, NPA_COLLAPSED);

    container.innerHTML = visible.map((z, i) => {
        const attract = z.avg_attract_score ?? 0;
        const bars = Object.entries(cats).map(([key, cat]) => {
            const s = z[`avg_${key}_score`] ?? 0;
            return `<div class="npa-chip" title="${cat.label} : ${s.toFixed(0)}/100 — densité dans un rayon, comparée au canton (100 = la mieux dotée, 0 = la moins dotée)">
                        <span class="npa-chip-dot" style="background:${cat.color}"></span>
                        <span class="npa-chip-ico">${cat.icon}</span>
                        <span class="npa-chip-val">${s.toFixed(0)}</span>
                    </div>`;
        }).join('');
        return `
            <div class="npa-card">
                <div class="npa-card-rank">${i + 1}</div>
                <div class="npa-card-id">
                    <span class="npa-card-code">${z.npa} · <span class="npa-card-commune">${z.commune || ''}</span></span>
                    <span class="npa-card-meta">${z.count} annonce${z.count > 1 ? 's' : ''} · ${Math.round(z.avg_price)} CHF/nuit · ${Math.round(z.avg_revenue).toLocaleString('fr-CH')} CHF/an · ${Math.round(z.avg_occupancy)} j/an · invest. ${z.avg_score.toFixed(0)}</span>
                </div>
                <div class="npa-card-score" style="color:${getScoreColor(attract)}" title="Attractivité locale moyenne /100">${attract.toFixed(0)}<span>/100</span></div>
                <div class="npa-card-chips">${bars}</div>
            </div>`;
    }).join('');

    // Expand / collapse control.
    if (moreEl) {
        const hidden = rows.length - visible.length;
        if (rows.length <= NPA_COLLAPSED) {
            moreEl.innerHTML = '';
        } else if (npaExpanded) {
            moreEl.innerHTML = `<button type="button" class="npa-more-btn" id="npa-toggle">Réduire la liste ▲</button>`;
        } else {
            moreEl.innerHTML = `<button type="button" class="npa-more-btn" id="npa-toggle">Voir les ${hidden} zones restantes ▾</button>`;
        }
        document.getElementById('npa-toggle')?.addEventListener('click', () => {
            npaExpanded = !npaExpanded;
            const data = cityData[activeCity];
            if (data?.npa && data?.attractivityWeights) renderNpaRanking(data.npa, data.attractivityWeights);
        });
    }
}

const NPA_COLLAPSED = 8;     // zones shown before "voir plus"
let npaExpanded = false;
let npaExplorerWired = false;
function wireNpaExplorer() {
    if (npaExplorerWired) return;
    npaExplorerWired = true;
    const rerun = () => {
        npaExpanded = false;   // any filter change collapses back to the top zones
        const data = cityData[activeCity];
        if (data?.npa && data?.attractivityWeights) renderNpaRanking(data.npa, data.attractivityWeights);
    };
    document.getElementById('npa-search')?.addEventListener('input', rerun);
    document.getElementById('npa-sort')?.addEventListener('change', rerun);
    document.getElementById('npa-min-count')?.addEventListener('change', rerun);
}

function renderWeightBars(config) {
    const container = document.getElementById('weight-bars');
    if (!container) return;
    const cats = config.categories;
    const weights = config.weights;
    container.innerHTML = '';

    for (const [key, cat] of Object.entries(cats)) {
        const pct = (weights[key] * 100).toFixed(0);
        const item = document.createElement('div');
        item.className = 'weight-bar-item';
        item.innerHTML = `
            <div class="wb-icon">${cat.icon}</div>
            <span class="wb-label">${cat.label}</span>
            <div class="wb-track">
                <div class="wb-fill" style="width: ${pct}%; background: ${cat.color};"></div>
            </div>
            <span class="wb-value" style="color: ${cat.color};">${pct}%</span>
            <span style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${cat.description}</span>
        `;
        container.appendChild(item);
    }
}

function renderDistrictCards(attractivity, config) {
    const container = document.getElementById('attractivity-ranking');
    if (!container) return;
    container.innerHTML = '';
    const cats = config.categories;

    attractivity.forEach((d, i) => {
        const rankColors = ['#FF5A5F', '#00A699', '#FC642D', '#914669', '#FFB400',
                           '#008489', '#767676', '#767676', '#767676', '#767676'];
        const card = document.createElement('div');
        card.className = 'district-card';
        card.innerHTML = `
            <div class="dc-header">
                <div class="dc-rank">
                    <div class="dc-rank-num" style="background: ${rankColors[i] || '#767676'};">${i + 1}</div>
                    <span class="dc-name">${d.district}</span>
                </div>
                <div class="dc-score-big">${d.attractivity_score.toFixed(1)}<span>/100</span></div>
            </div>
            <div class="dc-bars">
                ${Object.entries(cats).map(([key, cat]) => {
                    const score = d[key + '_score'] || 0;
                    return `
                    <div class="dc-bar-item">
                        <div class="dc-bar-label">
                            <span>${cat.icon} ${cat.label}</span>
                            <span style="font-weight:600;">${score.toFixed(0)}</span>
                        </div>
                        <div class="dc-bar-track">
                            <div class="dc-bar-fill" style="width: ${score}%; background: ${cat.color};"></div>
                        </div>
                    </div>`;
                }).join('')}
            </div>
            <div style="margin-top: 10px; font-size: 11px; color: var(--text-muted);">
                ${d.n_communes} communes | ${d.total_pois} POIs
                (${d.cultural_count} culture, ${d.sports_count} sport, ${d.restaurant_count} resto, ${d.employment_count} emploi, ${d.transport_count ?? 0} transport)
            </div>
        `;
        container.appendChild(card);
    });
}

function renderAttractivityRadar(attractivity, config) {
    destroyChart('attractRadar');
    const ctx = document.getElementById('chart-attractivity-radar');
    if (!ctx) return;
    const cats = config.categories;
    const labels = Object.values(cats).map(c => c.label);
    const catKeys = Object.keys(cats);
    // Distinct palette so every district stays readable (Vaud = 10 districts).
    const hues = ['#FF5A5F', '#00A699', '#FC642D', '#9b59b6', '#F4B400',
                  '#27ae60', '#0ea5e9', '#e74c3c', '#8e44ad', '#16a085',
                  '#d35400', '#2980b9'];

    // Show ALL districts
    const top = attractivity;
    const datasets = top.map((d, i) => {
        const col = hues[i % hues.length];
        return {
            label: d.district,
            data: catKeys.map(k => d[k + '_score'] || 0),
            borderColor: col,
            backgroundColor: col + '22',   // ~13% alpha fill
            pointBackgroundColor: col,
            borderWidth: 2,
            pointRadius: 2.5,
        };
    });

    charts.attractRadar = new Chart(ctx, {
        type: 'radar',
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                r: {
                    min: 0, max: 100, ticks: { stepSize: 25, color: getChartTextColor(), backdropColor: 'transparent' },
                    grid: { color: getChartGridColor(), lineWidth: 0.5 },
                    pointLabels: { color: getChartTextColor(), font: { size: 12 } },
                    angleLines: { color: getChartGridColor(), lineWidth: 0.5 }
                }
            },
            plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 12, font: { size: 11 } } } }
        }
    });
    // Which district leads, and on which factor the canton is globally strongest.
    if (top.length) {
        const leader = [...top].sort((a, b) => b.attractivity_score - a.attractivity_score)[0];
        const factorAvg = catKeys.map(k => ({
            label: cats[k].label,
            avg: top.reduce((s, d) => s + (d[k + '_score'] || 0), 0) / top.length,
        })).sort((a, b) => b.avg - a.avg);
        setChartInsight('chart-attractivity-radar',
            `<strong>${leader.district}</strong> présente le profil le plus complet. ` +
            `À l'échelle du canton, <strong>${factorAvg[0].label.toLowerCase()}</strong> est le facteur le mieux doté et ` +
            `<strong>${factorAvg[factorAvg.length - 1].label.toLowerCase()}</strong> le plus faible.`);
    }
}

function renderAttractivityBar(attractivity) {
    destroyChart('attractBar');
    const ctx = document.getElementById('chart-attractivity-bar');
    if (!ctx) return;

    const sorted = [...attractivity].sort((a, b) => b.attractivity_score - a.attractivity_score);
    const rankColors = sorted.map((_, i) => i === 0 ? C.coral : i < 3 ? C.teal : C.orangeBg);

    charts.attractBar = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(d => d.district),
            datasets: [{
                label: 'Score d\'attractivite',
                data: sorted.map(d => d.attractivity_score),
                backgroundColor: rankColors,
                borderWidth: 0,
                borderRadius: 6,
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, indexAxis: 'y',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        afterLabel: (ctx) => {
                            const d = sorted[ctx.dataIndex];
                            return `Culture: ${d.cultural_score.toFixed(0)} | Sport: ${d.sports_score.toFixed(0)} | Resto: ${d.restaurant_score.toFixed(0)} | Emploi: ${d.employment_score.toFixed(0)} | Transport: ${(d.transport_score ?? 0).toFixed(0)}`;
                        }
                    }
                }
            },
            scales: {
                x: { beginAtZero: true, max: 100, grid: { color: getChartGridColor() }, title: { display: true, text: 'Score d\'attractivite (0-100)' } },
                y: { grid: { display: false } }
            }
        }
    });
    if (sorted.length >= 2) {
        const gap = (sorted[0].attractivity_score - sorted[1].attractivity_score);
        setChartInsight('chart-attractivity-bar',
            `<strong>${sorted[0].district}</strong> est le district le plus attractif (<strong>${Math.round(sorted[0].attractivity_score)}/100</strong>), ` +
            `${gap >= 1 ? `${Math.round(gap)} pts devant` : 'au coude-à-coude avec'} <strong>${sorted[1].district}</strong>.`);
    }
}

function renderPoiStackedChart(attractivity, config) {
    destroyChart('poiStacked');
    const ctx = document.getElementById('chart-poi-stacked');
    if (!ctx) return;
    const cats = config.categories;
    const sorted = [...attractivity].sort((a, b) => b.total_pois - a.total_pois);

    const datasets = Object.entries(cats).map(([key, cat]) => ({
        label: cat.label,
        data: sorted.map(d => d[key + '_count']),
        backgroundColor: cat.color,
        borderWidth: 0,
        borderRadius: 2,
    }));

    charts.poiStacked = new Chart(ctx, {
        type: 'bar',
        data: { labels: sorted.map(d => d.district), datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { usePointStyle: true, padding: 12, font: { size: 11 } } } },
            scales: {
                x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 45, font: { size: 11 } } },
                y: { stacked: true, beginAtZero: true, grid: { color: getChartGridColor() }, title: { display: true, text: 'Nombre de POIs' } }
            }
        }
    });
    if (sorted.length) {
        const t = sorted[0];
        const topCat = Object.entries(cats)
            .map(([key, cat]) => ({ label: cat.label, n: t[key + '_count'] || 0 }))
            .sort((a, b) => b.n - a.n)[0];
        setChartInsight('chart-poi-stacked',
            `<strong>${t.district}</strong> concentre le plus de points d'intérêt (${(t.total_pois || 0).toLocaleString('fr-CH')} POIs)` +
            (topCat ? `, surtout en <strong>${topCat.label.toLowerCase()}</strong>.` : '.'));
    }
}

// ═══════════════════════════════════════════
// LAUNCH SIMULATOR
// ───────────────────────────────────────────
// Decisional tool for users who want to LAUNCH their own Airbnb in Vaud.
// Given a target commune + property profile, it mines comparable active
// listings and returns:
//   • Nightly price recommendation (P25 / P50 / P75 of comps)
//   • Expected occupancy (median days booked / year)
//   • Projected annual revenue (low / median / high)
//   • Payback of the launch setup in months
//   • Confidence badge based on how many comparables we found
// ═══════════════════════════════════════════

// ── Property profile definitions ──────────────────────────────────────────
// Each profile maps to a bedrooms range + accommodates range used for the
// comp filter. The label/desc are shown in the results header.
const PROPERTY_PROFILES = {
    studio: {
        label: 'Studio', icon: '🛏️',
        desc: '1 pièce · 1–3 personnes',
        bedroomsMin: 0, bedroomsMax: 0,
        accMin: 1,      accMax: 3,
    },
    appt2p: {
        label: 'Appartement 2P', icon: '🏠',
        desc: '1 chambre · 2–4 personnes',
        bedroomsMin: 1, bedroomsMax: 1,
        accMin: 2,      accMax: 4,
    },
    appt3p: {
        label: 'Appartement 3P+', icon: '🏘️',
        desc: '2–3 chambres · 4–7 personnes',
        bedroomsMin: 2, bedroomsMax: 3,
        accMin: 4,      accMax: 7,
    },
    maison: {
        label: 'Maison / Chalet', icon: '🏡',
        desc: '4+ chambres · 6–12 personnes',
        bedroomsMin: 4, bedroomsMax: 99,
        accMin: 6,      accMax: 99,
    },
};

// ── Budget preset definitions ──────────────────────────────────────────────
// `mid` is the value used in the payback calculation (midpoint of the range).
const BUDGET_PRESETS = {
    5500:  { tier: 'Basique',  range: '3k – 8k CHF',    mid: 5500  },
    13000: { tier: 'Confort',  range: '8k – 18k CHF',   mid: 13000 },
    29000: { tier: 'Premium',  range: '18k – 40k CHF',  mid: 29000 },
};

let simState = {
    commune:      null,
    roomType:     'Entire home/apt',
    profile:      'appt2p',      // key of PROPERTY_PROFILES
    setupBudget:  13000,         // mid-value of Confort preset
    propertyMode: 'own',         // 'own' = déjà propriétaire, 'buy' = achat du bien
    purchasePrice: 0,            // prix d'achat de l'immobilier (mode 'buy')
    annualCharges: 0,            // charges annuelles CHF/an (hypothèque, charges, loyer)
    wired:        false,
};

function populateSimulatorCommunes() {
    const sel = document.getElementById('sim-commune');
    if (!sel) return;
    const data = cityData[activeCity];
    if (!data?.listings) return;

    // Count listings per commune (nh) and sort by volume so the most
    // data-rich communes float to the top.
    const countByNh = {};
    data.listings.forEach(l => {
        if (!l.nh) return;
        countByNh[l.nh] = (countByNh[l.nh] || 0) + 1;
    });
    const communes = Object.entries(countByNh)
        .map(([nh, n]) => ({ nh, n }))
        .sort((a, b) => b.n - a.n);

    sel.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— Choisissez une commune —';
    placeholder.disabled = true;
    placeholder.selected = true;
    sel.appendChild(placeholder);
    communes.forEach(({ nh, n }) => {
        const o = document.createElement('option');
        o.value = nh;
        o.textContent = `${nh}  ·  ${n} annonce${n > 1 ? 's' : ''}`;
        sel.appendChild(o);
    });
}

function setupSimulator() {
    if (simState.wired) {
        // Refresh commune dropdown in case city data reloaded
        populateSimulatorCommunes();
        return;
    }
    simState.wired = true;

    // Commune select
    const communeSel = document.getElementById('sim-commune');
    if (communeSel) {
        communeSel.addEventListener('change', () => {
            simState.commune = communeSel.value || null;
            updateCommuneHelp();
        });
    }

    // Property profile tiles
    document.querySelectorAll('#sim-profile .sim-profile-tile').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#sim-profile .sim-profile-tile').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            simState.profile = btn.dataset.profile;
            updateRoomTypeForProfile();
        });
    });

    // Room type
    document.querySelectorAll('#sim-room-type .sim-radio').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#sim-room-type .sim-radio').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            simState.roomType = btn.dataset.value;
        });
    });

    // Budget preset tiles
    document.querySelectorAll('#sim-budget .sim-budget-tile').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#sim-budget .sim-budget-tile').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            simState.setupBudget = Number(btn.dataset.budget);
        });
    });

    // Property situation toggle (own vs buy)
    document.querySelectorAll('#sim-property-mode .sim-radio').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#sim-property-mode .sim-radio').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            simState.propertyMode = btn.dataset.mode;
            updatePropertyFields();
        });
    });

    // Purchase price input
    const purchaseInput = document.getElementById('sim-purchase');
    if (purchaseInput) {
        purchaseInput.addEventListener('input', () => {
            simState.purchasePrice = Math.max(0, Number(purchaseInput.value) || 0);
        });
    }

    // Annual charges input
    const chargesInput = document.getElementById('sim-charges');
    if (chargesInput) {
        chargesInput.addEventListener('input', () => {
            simState.annualCharges = Math.max(0, Number(chargesInput.value) || 0);
        });
    }

    updatePropertyFields();
    updateRoomTypeForProfile();

    // Submit
    const submit = document.getElementById('sim-submit');
    if (submit) submit.addEventListener('click', runSimulator);
}

// A studio has a single room, so "Private room" makes no sense — force and
// lock "Entire home/apt" whenever the studio profile is selected.
function updateRoomTypeForProfile() {
    const privateBtn = document.querySelector('#sim-room-type .sim-radio[data-value="Private room"]');
    const entireBtn  = document.querySelector('#sim-room-type .sim-radio[data-value="Entire home/apt"]');
    const help       = document.getElementById('sim-room-help');
    if (!privateBtn || !entireBtn) return;

    const isStudio = simState.profile === 'studio';
    privateBtn.disabled = isStudio;
    privateBtn.classList.toggle('is-disabled', isStudio);

    if (isStudio) {
        privateBtn.classList.remove('active');
        entireBtn.classList.add('active');
        simState.roomType = 'Entire home/apt';
    }
    if (help) {
        help.innerHTML = isStudio
            ? 'Un studio se loue forcément en entier — la chambre privée n\'est pas applicable.'
            : 'Vous louez l\'intégralité du logement, ou seulement une chambre chez vous&nbsp;?';
    }
}

// Show/hide the purchase-price field and adapt help text to the chosen mode.
function updatePropertyFields() {
    const purchaseWrap = document.getElementById('sim-purchase-wrap');
    const help         = document.getElementById('sim-property-help');
    const chargesLabel = document.getElementById('sim-charges-label');
    const isBuy = simState.propertyMode === 'buy';

    if (purchaseWrap) purchaseWrap.hidden = !isBuy;
    if (chargesLabel) {
        chargesLabel.textContent = isBuy
            ? 'Charges annuelles (intérêts hypothécaires, charges)'
            : 'Charges annuelles (hypothèque, charges, loyer)';
    }
    if (help) {
        help.innerHTML = isBuy
            ? 'Le prix d\'achat entre dans le ROI global. Les charges annuelles réduisent le revenu net.'
            : 'Vous êtes déjà propriétaire&nbsp;: le coût immobilier est nul. Indiquez vos charges annuelles pour obtenir un ROI net.';
    }
}

function updateCommuneHelp() {
    const help = document.getElementById('sim-commune-help');
    if (!help) return;
    if (!simState.commune) {
        help.textContent = 'Où comptez-vous lancer votre Airbnb\u00a0?';
        return;
    }
    const data = cityData[activeCity];
    const nComps = data?.listings?.filter(l => l.nh === simState.commune).length || 0;
    help.textContent = `${nComps} annonce${nComps > 1 ? 's' : ''} active${nComps > 1 ? 's' : ''} dans cette commune`;
}

// ── Pure math helpers ──
function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(arr, q) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const pos = (s.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    return s[base + 1] !== undefined ? s[base] + rest * (s[base + 1] - s[base]) : s[base];
}

// ── ROI helper ──
// Returns the annual return rate (%) and payback duration for a given
// investment and annual return. Guards against div-by-zero / negative cashflow.
function computeRoi(investment, annualReturn) {
    if (!investment || investment <= 0) {
        return { pctLabel: '—', paybackLabel: '—', sub: 'Investissement non renseigné.' };
    }
    if (annualReturn == null || annualReturn <= 0) {
        return {
            pctLabel: annualReturn < 0 ? 'négatif' : '0 %',
            paybackLabel: '—',
            sub: annualReturn < 0
                ? 'Charges supérieures au revenu — projet déficitaire.'
                : 'Revenu net insuffisant pour un retour.',
        };
    }
    const pct    = (annualReturn / investment) * 100;
    const months = (investment / annualReturn) * 12;
    const paybackLabel = months < 12
        ? `${months.toFixed(1)} mois`
        : `${(months / 12).toFixed(1)} ans`;
    const sub = months < 12  ? 'Remboursement en moins d\'un an — excellent.'
              : months < 24  ? 'Remboursement sous 2 ans — très bon.'
              : months < 48  ? 'Remboursement entre 2 et 4 ans — correct.'
              : months < 120 ? 'Remboursement entre 4 et 10 ans.'
              :                'Remboursement long — vérifiez vos hypothèses.';
    return { pct, pctLabel: `${pct.toFixed(1)} %/an`, paybackLabel, sub };
}

// ── Comp selection: progressively widen the filter until we have enough ──
// Uses profile-based ranges (not exact bedrooms/accommodates) so the filter
// stays logically consistent even if individual listings have imprecise data.
function findComparables() {
    const data = cityData[activeCity];
    if (!data?.listings) return { comps: [], scope: 'none' };
    const all = data.listings;

    if (!simState.commune) return { comps: [], scope: 'none' };

    const prof = PROPERTY_PROFILES[simState.profile] || PROPERTY_PROFILES.appt2p;

    // Find district of target commune
    const sample = all.find(l => l.nh === simState.commune);
    const targetDistrict = sample?.district;

    const matchType       = l => l.type === simState.roomType;
    const matchBedStrict  = l => {
        const b = l.bedrooms ?? 0;
        return b >= prof.bedroomsMin && b <= prof.bedroomsMax;
    };
    const matchBedLoose   = l => {
        const b = l.bedrooms ?? 0;
        return b >= Math.max(0, prof.bedroomsMin - 1) && b <= prof.bedroomsMax + 1;
    };
    const matchAccStrict  = l => {
        const a = l.accommodates ?? 0;
        return a >= prof.accMin && a <= prof.accMax;
    };
    const matchAccLoose   = l => {
        const a = l.accommodates ?? 0;
        return a >= Math.max(1, prof.accMin - 1) && a <= prof.accMax + 2;
    };

    // Tier 1 — same commune, exact profile range
    let comps = all.filter(l =>
        l.nh === simState.commune && matchType(l) && matchBedStrict(l) && matchAccStrict(l)
    );
    if (comps.length >= 5) return { comps, scope: 'commune-strict' };

    // Tier 2 — same commune, ±1 bedroom / +2 acc tolerance
    comps = all.filter(l =>
        l.nh === simState.commune && matchType(l) && matchBedLoose(l) && matchAccLoose(l)
    );
    if (comps.length >= 5) return { comps, scope: 'commune-loose' };

    // Tier 3 — same district, exact profile range
    if (targetDistrict) {
        comps = all.filter(l =>
            l.district === targetDistrict && matchType(l) && matchBedStrict(l) && matchAccStrict(l)
        );
        if (comps.length >= 5) return { comps, scope: 'district-strict' };

        // Tier 4 — same district, loose
        comps = all.filter(l =>
            l.district === targetDistrict && matchType(l) && matchBedLoose(l) && matchAccLoose(l)
        );
        if (comps.length >= 5) return { comps, scope: 'district-loose' };
    }

    // Tier 5 — last resort: same commune, any profile (low confidence)
    comps = all.filter(l => l.nh === simState.commune && matchType(l));
    if (comps.length > 0) return { comps, scope: 'commune-any' };

    return { comps: [], scope: 'none' };
}

function scopeLabel(scope) {
    switch (scope) {
        case 'commune-strict': return 'Comparables exacts dans la commune';
        case 'commune-loose':  return 'Comparables élargis dans la commune';
        case 'district-strict':return 'Comparables exacts dans le district';
        case 'district-loose': return 'Comparables élargis dans le district';
        case 'commune-any':    return 'Données limitées — toute la commune';
        default:               return 'Aucun comparable';
    }
}

function confidenceFromScope(scope, n) {
    if (scope === 'none' || n === 0) return { level: 'none', label: 'Données insuffisantes', hint: 'Moins de 5 comparables — résultats non fiables.', color: '#94a3b8' };

    // Base level from sample size
    let level, label, hint, color;
    if (n < 5) {
        level = 'low'; label = 'Confiance faible';  hint = `${n} comparables seulement — à interpréter avec prudence.`; color = '#fbbf24';
    } else if (n < 15) {
        level = 'med'; label = 'Confiance modérée'; hint = `${n} comparables — estimation raisonnable.`; color = '#fb7185';
    } else {
        level = 'high'; label = 'Confiance élevée'; hint = `${n} comparables analysés — estimation robuste.`; color = '#FF5A5F';
    }

    // Cap confidence when comps came from a looser scope (the profile match
    // was relaxed to find them, so they're less representative).
    const capBy = {
        'commune-loose':  'high',  // same commune, ±1 bedroom / ±2 accommodates → still strong
        'district-strict':'high',  // district-wide strict profile → still good
        'district-loose': 'med',   // district-wide loose profile → cap to moderate
        'commune-any':    'low',   // no profile match at all → cap to low
    };
    const cap = capBy[scope];
    const order = { low: 0, med: 1, high: 2 };
    if (cap && order[level] > order[cap]) {
        level = cap;
        if (cap === 'low') { label = 'Confiance faible';  color = '#fbbf24'; hint = `${n} annonces trouvées mais sans correspondance exacte au profil — indicatif uniquement.`; }
        if (cap === 'med') { label = 'Confiance modérée'; color = '#fb7185'; hint = `${n} comparables trouvés via un périmètre élargi — estimation à valider.`; }
    }

    return { level, label, hint, color };
}

function runSimulator() {
    if (!simState.commune) {
        alert('Choisissez une commune avant de lancer la simulation.');
        return;
    }
    const { comps, scope } = findComparables();
    lastSimulationComps = comps;
    const container = document.getElementById('sim-results');
    if (!container) return;

    if (!comps.length) {
        container.innerHTML = `
            <div class="sim-empty glass">
                <span class="eyebrow">Aucune donnée</span>
                <h3>Pas de comparable pour ce projet</h3>
                <p>Aucune annonce active ne correspond à <strong>${simState.commune}</strong> avec
                ce type de location. Essayez une commune voisine ou un autre gabarit.</p>
            </div>`;
        return;
    }

    // ── Compute stats from comps ──
    const prices   = comps.map(c => Number(c.price)   || 0).filter(v => v > 0);
    const revenues = comps.map(c => Number(c.revenue) || 0).filter(v => v >= 0);
    const occs     = comps.map(c => Number(c.occupancy) || 0).filter(v => v >= 0);
    const scores   = comps.map(c => Number(c.score)   || 0);

    const p25 = Math.round(quantile(prices, 0.25));
    const p50 = Math.round(quantile(prices, 0.50));
    const p75 = Math.round(quantile(prices, 0.75));
    const medOcc = Math.round(median(occs));
    const revLow = Math.round(quantile(revenues, 0.25));
    const revMed = Math.round(median(revenues));
    const revHigh= Math.round(quantile(revenues, 0.75));
    const avgScore = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);

    // ── ROI computations ──
    // Setup ROI: return on the launch outlay only, measured on gross revenue.
    // General ROI: return on total capital (setup + property purchase),
    // measured on net revenue (gross − annual charges).
    const purchasePrice = simState.propertyMode === 'buy' ? Math.max(0, simState.purchasePrice || 0) : 0;
    const annualCharges = Math.max(0, simState.annualCharges || 0);
    const netRevenue    = revMed - annualCharges;

    const roiSetup   = computeRoi(simState.setupBudget, revMed);
    const roiGeneral = computeRoi(simState.setupBudget + purchasePrice, netRevenue);

    const totalCapital = simState.setupBudget + purchasePrice;
    const roiHint = purchasePrice > 0
        ? `Global = revenu net (− CHF ${annualCharges.toLocaleString('fr-CH')} de charges) sur CHF ${totalCapital.toLocaleString('fr-CH')} (setup + achat).`
        : (annualCharges > 0
            ? `Vous possédez déjà le bien : global = revenu net (− CHF ${annualCharges.toLocaleString('fr-CH')} de charges) sur la mise de lancement.`
            : 'Vous possédez déjà le bien : le coût immobilier est nul. Ajoutez vos charges annuelles pour un ROI net.');

    const confidence  = confidenceFromScope(scope, comps.length);
    const scopeMsg    = scopeLabel(scope);
    const prof        = PROPERTY_PROFILES[simState.profile] || PROPERTY_PROFILES.appt2p;
    const budgetPreset= BUDGET_PRESETS[simState.setupBudget] || BUDGET_PRESETS[13000];
    const roomLabel   = simState.roomType === 'Entire home/apt' ? 'Logement entier' : 'Chambre privée';

    // Criteria summary for the transparency strip
    const criteriaDesc = `${prof.label} · ${roomLabel} · ${prof.desc}`;

    // Top 3 comparables — mix of high-score AND highest-revenue so the user
    // sees the best AND the most lucrative ones (not just score-ranked).
    const byScore   = [...comps].sort((a, b) => b.score - a.score).slice(0, 2);
    const byRevenue = [...comps].sort((a, b) => b.revenue - a.revenue).slice(0, 1);
    const topComps  = [...new Map([...byScore, ...byRevenue].map(c => [c.id, c])).values()];

    const topCompsHtml = topComps.map(c => {
        const rawName = (c.name || ('Annonce #' + c.id)).trim();
        const prettyName = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : rawName;
        const bedLabel = c.bedrooms === 0 ? 'Studio' : `${c.bedrooms} ch.`;
        const accLabel = `${c.accommodates} pers.`;
        return `
            <div class="sim-comp">
                <div class="sim-comp-head">
                    <span class="sim-comp-name" title="${prettyName.replace(/"/g, '&quot;')}">${prettyName}</span>
                    <span class="sim-comp-score" style="background:${getScoreColor(c.score)}">${Math.round(c.score)}</span>
                </div>
                <div class="sim-comp-meta">${bedLabel} · ${accLabel}</div>
                <div class="sim-comp-stats">
                    <span><strong>CHF ${Math.round(c.price)}</strong> /nuit</span>
                    <span><strong>${Math.round(c.occupancy)}</strong> j/an</span>
                    <span><strong>CHF ${Math.round(c.revenue).toLocaleString('fr-CH')}</strong> /an</span>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="sim-result-header glass reveal-up">
            <div class="sim-result-head-left">
                <span class="eyebrow">Votre simulation</span>
                <h2>${simState.commune}</h2>
                <div class="sim-profile-pills">
                    <span class="sim-pill">${prof.icon} ${prof.label}</span>
                    <span class="sim-pill">${roomLabel}</span>
                    <span class="sim-pill">Setup ${budgetPreset.range}</span>
                    <span class="sim-pill">${purchasePrice > 0 ? `🏷️ Achat CHF ${purchasePrice.toLocaleString('fr-CH')}` : '🔑 Bien possédé'}</span>
                </div>
            </div>
            <div class="sim-confidence" data-level="${confidence.level}">
                <span class="sim-conf-dot" style="background:${confidence.color}"></span>
                <div>
                    <span class="sim-conf-label">${confidence.label}</span>
                    <span class="sim-conf-hint">${confidence.hint}</span>
                </div>
            </div>
        </div>

        <div class="sim-cards">
            <!-- Price recommendation -->
            <div class="sim-card glass reveal-up" style="animation-delay:.05s">
                <span class="eyebrow">Prix conseillé /nuit</span>
                <div class="sim-price-main">CHF ${p50}</div>
                <div class="sim-price-range">
                    <div class="sim-price-bar">
                        <div class="sim-price-dot" style="left:0%"></div>
                        <div class="sim-price-dot" style="left:50%"></div>
                        <div class="sim-price-dot" style="left:100%"></div>
                    </div>
                    <div class="sim-price-labels">
                        <span>CHF ${p25}<br><em>bas (P25)</em></span>
                        <span>CHF ${p50}<br><em>médiane</em></span>
                        <span>CHF ${p75}<br><em>haut (P75)</em></span>
                    </div>
                </div>
            </div>

            <!-- Occupancy -->
            <div class="sim-card glass reveal-up" style="animation-delay:.1s">
                <span class="eyebrow">Occupation attendue</span>
                <div class="sim-big-number">${medOcc}<span class="sim-unit"> j/an</span></div>
                <div class="sim-bar-track">
                    <div class="sim-bar-fill" style="width:${Math.min(100, (medOcc / 365) * 100).toFixed(1)}%"></div>
                </div>
                <div class="sim-card-hint">Soit <strong>${Math.round((medOcc / 365) * 100)}%</strong> de l'année — médiane des comps.</div>
            </div>

            <!-- Revenue -->
            <div class="sim-card glass reveal-up" style="animation-delay:.15s">
                <span class="eyebrow">Revenu brut annuel projeté</span>
                <div class="sim-big-number">CHF ${revMed.toLocaleString('fr-CH')}</div>
                <div class="sim-revenue-range">
                    <span>Bas<strong>${revLow.toLocaleString('fr-CH')}</strong></span>
                    <span>Médiane<strong>${revMed.toLocaleString('fr-CH')}</strong></span>
                    <span>Haut<strong>${revHigh.toLocaleString('fr-CH')}</strong></span>
                </div>
                <div class="sim-card-hint">Revenu brut, avant frais Airbnb (~3%), charges et impôts.</div>
            </div>

            <!-- ROI : Setup vs Global -->
            <div class="sim-card glass reveal-up" style="animation-delay:.2s">
                <span class="eyebrow">Rentabilité (ROI)</span>
                <div class="sim-roi-split">
                    <div class="sim-roi-block">
                        <span class="sim-roi-tag">Setup seul</span>
                        <span class="sim-roi-pct">${roiSetup.pctLabel}</span>
                        <span class="sim-roi-pb">Remboursement&nbsp;: <strong>${roiSetup.paybackLabel}</strong></span>
                    </div>
                    <div class="sim-roi-divider"></div>
                    <div class="sim-roi-block">
                        <span class="sim-roi-tag">Global ${purchasePrice > 0 ? '(avec achat)' : '(bien possédé)'}</span>
                        <span class="sim-roi-pct">${roiGeneral.pctLabel}</span>
                        <span class="sim-roi-pb">Remboursement&nbsp;: <strong>${roiGeneral.paybackLabel}</strong></span>
                    </div>
                </div>
                <div class="sim-card-hint">${roiHint}</div>
            </div>
        </div>

        <!-- Criteria + confidence transparency strip -->
        <div class="sim-scope-strip glass reveal-up" style="animation-delay:.25s">
            <div class="sim-scope-criteria">
                <span class="eyebrow">Critères de recherche</span>
                <strong>${criteriaDesc}</strong>
                <span class="sim-scope-count">· ${comps.length} comparable${comps.length > 1 ? 's' : ''} · ${scopeMsg}</span>
            </div>
            <div class="sim-scope-score">
                <span class="eyebrow">Score AirValo moyen</span>
                <strong style="color:${getScoreColor(avgScore)}">${avgScore}<span class="sim-unit">/100</span></strong>
            </div>
        </div>

        ${getCommuneSentiment(simState.commune) ? `
        <!-- À savoir dans cette zone (sentiment voyageurs) -->
        <div class="sim-sentiment-panel glass reveal-up" style="animation-delay:.28s">
            <div class="sim-comps-header">
                <span class="eyebrow">À savoir dans cette zone</span>
                <h3>Ce que les voyageurs valorisent à ${simState.commune}</h3>
            </div>
            ${communeSentimentHtml(simState.commune)}
        </div>` : ''}

        <!-- Top comparables -->
        <div class="sim-comps-panel glass reveal-up" style="animation-delay:.3s">
            <div class="sim-comps-header">
                <span class="eyebrow">Annonces de référence</span>
                <h3>Les comps utilisés pour cette simulation</h3>
                <p class="sim-comps-explain">Ces annonces actives sur Airbnb correspondent à votre profil et à votre commune. Elles servent de données de marché — ce ne sont pas des biens à acheter.</p>
            </div>
            <div class="sim-comps-grid">
                ${topCompsHtml}
            </div>
            <button type="button" class="btn-link" data-go-view="map">
                Voir toutes les annonces comparables sur la carte <span aria-hidden="true">→</span>
            </button>
        </div>
    `;

    // Re-wire [data-go-view] for the button we just injected
    container.querySelectorAll('[data-go-view]').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.goView;
            if (target === 'map') {
                mapFilterListingIds = lastSimulationComps ? lastSimulationComps.map(c => c.id) : null;
            }
            document.querySelectorAll('.nav-tabs .nav-tab').forEach(t => t.classList.remove('active'));
            const navMatch = document.querySelector(`.nav-tabs .nav-tab[data-view="${target}"]`);
            if (navMatch) navMatch.classList.add('active');
            switchView(target);
        });
    });
}
