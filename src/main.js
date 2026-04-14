import './styles.css';
import '@fontsource/montserrat/300.css';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/800.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

let deferredInstallPrompt = null;

function trackPwaEvent(eventName, payload = {}) {
    console.info('[PWA]', eventName, payload);
}

async function requestPersistentStorage() {
    if (!('storage' in navigator) || typeof navigator.storage.persist !== 'function') {
        return;
    }

    try {
        const granted = await navigator.storage.persist();
        trackPwaEvent('storage-persist', { granted });
    } catch (error) {
        trackPwaEvent('storage-persist-error', { message: String(error) });
    }
}

globalThis.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    trackPwaEvent('beforeinstallprompt', { deferredAvailable: Boolean(deferredInstallPrompt) });
});

globalThis.addEventListener('appinstalled', () => {
    trackPwaEvent('appinstalled', { hadDeferredPrompt: Boolean(deferredInstallPrompt) });
    deferredInstallPrompt = null;
});

if ('serviceWorker' in navigator) {
    globalThis.addEventListener('load', () => {
        if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
            trackPwaEvent('sw-skip-localhost');
            navigator.serviceWorker.getRegistrations().then((registrations) => {
                registrations.forEach((registration) => {
                    registration.unregister();
                });
            });
            caches.keys().then((keys) => {
                keys.forEach((key) => {
                    if (key.startsWith('bentinho-app-')) {
                        caches.delete(key);
                    }
                });
            });
            return;
        }

        navigator.serviceWorker.register('/sw.js').then((registration) => {
            trackPwaEvent('sw-registered', { scope: registration.scope });
        }).catch((error) => {
            console.warn('Service worker registration failed:', error);
        });

        requestPersistentStorage();
    });
}

const APP_LANGUAGES = new Set(['pt-BR', 'en']);
const DEFAULT_MAP_CENTER = [20, 0];
const DEFAULT_MAP_ZOOM = 3;
const USER_MAP_ZOOM = 8;
const COUNTRY_CODE_BY_ID = {
    1: 'it',
    2: 'es',
    3: 'fr',
    4: 'de',
    5: 'nl',
    6: 'be',
    7: 'pl',
    8: 'at',
    9: 'eg',
    10: 'pt',
    11: 'hr',
    12: 'ch',
    13: 'ar',
    14: 'co',
    15: 'mx',
    16: 'pe',
    17: 've',
    18: 'in',
    19: 'mq',
    20: 're',
    21: 'va'
};

const TRANSLATIONS = {
    'pt-BR': {
        appTitle: 'bentinho - Mapa Interativo',
        nav: { explore: 'Milagres Eucarísticos', about: 'Sobre' },
        search: {
            title: 'Jesus está em todos os lugares',
            placeholder: 'Pesquisar país...',
            clearAria: 'Limpar busca',
            counter: 'Explore {count} milagres eucarísticos documentados ao redor do mundo. Escolha um país para começar.'
        },
        sections: {
            countries: 'Países',
            history: 'Histórico',
            historyEmpty: 'Nenhum país visitado ainda'
        },
        detail: { back: 'Voltar', countryRegion: 'País/Região' },
        about: {
            title: 'Sobre o Projeto',
            description: 'Navegue interativamente pelo catálogo documentado pelo Beato Carlo Acutis.',
            creditsLabel: 'Créditos:',
            creditsText: 'Acervo oficial pertence à Associação Amigos de Carlo Acutis.'
        },
        modal: { loading: 'Carregando documento oficial...' },
        status: { loading: 'Carregando...', ready: '' },
        error: { dataLoad: 'Erro ao carregar dados' }
    },
    en: {
        appTitle: 'bentinho - Interactive Map',
        nav: { explore: 'Eucharistic Miracles', about: 'About' },
        search: {
            title: 'Jesus is present everywhere',
            placeholder: 'Search country...',
            clearAria: 'Clear search',
            counter: 'Explore {count} documented Eucharistic miracles around the world. Choose a country to begin.'
        },
        sections: {
            countries: 'Countries',
            history: 'History',
            historyEmpty: 'No visited countries yet'
        },
        detail: { back: 'Back', countryRegion: 'Country/Region' },
        about: {
            title: 'About the Project',
            description: 'Browse the catalog documented by Blessed Carlo Acutis interactively.',
            creditsLabel: 'Credits:',
            creditsText: 'The official collection belongs to Associazione Amici di Carlo Acutis.'
        },
        modal: { loading: 'Loading official document...' },
        status: { loading: 'Loading...', ready: '' },
        error: { dataLoad: 'Error loading data' }
    }
};

let countries = [];
let activeCountryId = null;
let activeMiracleUrl = '';
let activeMiracleUnsubscribers = [];
let currentLanguage = 'pt-BR';
let visitedCountryIds = [];

const miracleStatus = new Map();
const miracleStatusListeners = new Map();
const prefetchQueue = [];
const queuedMiracleUrls = new Set();
let preloadIframe = null;
let prefetchInProgress = false;
let idlePrefetchScheduled = false;
let activePrefetchSessionId = 0;
let currentPrefetchEntry = null;

function getDataFilePathByLanguage(lang) {
    return lang === 'en' ? '/data/miracles-data.en.json' : '/data/miracles-data.json';
}

function getBaseUrlByLanguage(lang) {
    return lang === 'en'
        ? 'https://www.miracolieucaristici.org/en/Liste/'
        : 'https://www.miracolieucaristici.org/pr/Liste/';
}

function isMobileIframeContext() {
    return globalThis.matchMedia('(max-width: 1023px)').matches || navigator.maxTouchPoints > 0;
}

function buildMiracleDocumentUrl(relativePath) {
    const url = new URL(relativePath, getBaseUrlByLanguage(currentLanguage));
    if (isMobileIframeContext()) {
        url.searchParams.set('mobile', '1');
    }
    return url.toString();
}

function getLanguageCountryCode(lang) {
    return lang === 'en' ? 'us' : 'br';
}

function getLanguageDisplayName(lang) {
    return lang === 'en' ? 'English' : 'Português';
}

function getLanguageBadgeCode(lang) {
    return lang === 'en' ? 'EN' : 'PT';
}

async function loadCountriesData(lang) {
    const response = await fetch(getDataFilePathByLanguage(lang));
    if (!response.ok) {
        throw new Error(`Failed to load data file: ${response.status}`);
    }

    const rawCountries = await response.json();
    return rawCountries.map((country) => ({
        ...country,
        countryCode: COUNTRY_CODE_BY_ID[country.id] || '',
        totalMiracles: country.cities.length
    }));
}

const selectors = {
    pageExplore: document.getElementById('page-explore'),
    pageAbout: document.getElementById('page-about'),
    navExplore: document.getElementById('nav-explore'),
    navAbout: document.getElementById('nav-about'),
    globalCounter: document.getElementById('globalCounter'),
    mobileGlobalCounter: document.getElementById('mobileGlobalCounter'),
    countryGrid: document.getElementById('countryGrid'),
    mobileCountryCarousel: document.getElementById('mobileCountryCarousel'),
    historyList: document.getElementById('historyList'),
    detailCountryTitle: document.getElementById('detailCountryTitle'),
    miracleList: document.getElementById('miracleList'),
    viewCountries: document.getElementById('view-countries'),
    viewCountryDetails: document.getElementById('view-country-details'),
    searchCountryInput: document.getElementById('searchCountryInput'),
    clearCountrySearchButton: document.getElementById('clearCountrySearchButton'),
    searchMiracleInput: document.getElementById('searchMiracleInput'),
    miracleModal: document.getElementById('miracleModal'),
    modalTitle: document.getElementById('modalTitle'),
    modalYear: document.getElementById('modalYear'),
    closeModalButton: document.getElementById('closeModalButton'),
    languagePicker: document.getElementById('languagePicker'),
    languageCurrentButton: document.getElementById('languageCurrentButton'),
    languageCurrentFlag: document.getElementById('languageCurrentFlag'),
    languageMenu: document.getElementById('languageMenu'),
    languageOptions: Array.from(document.querySelectorAll('[data-lang-option]')),
    backToCountriesButton: document.getElementById('backToCountriesButton'),
    loadingSpinner: document.querySelector('.loading-spinner'),
    miracleIframe: document.getElementById('miracleIframe')
};

const map = L.map('map', { zoomControl: false }).setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
const markersCluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 7
});
const miracleMarkerIcon = L.divIcon({
    className: 'miracle-map-marker-wrapper',
    html: '<span class="miracle-map-marker" aria-hidden="true"></span>',
    iconSize: [38, 38],
    iconAnchor: [19, 19]
});
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' }).addTo(map);

function t(path, replacements = {}) {
    const value = path.split('.').reduce((acc, key) => acc?.[key], TRANSLATIONS[currentLanguage]) || '';
    return Object.entries(replacements).reduce((text, [key, replacement]) => {
        return text.replace(`{${key}}`, replacement);
    }, value);
}

function buildLanguageFlagImage(lang, className = 'language-flag-current') {
    const code = getLanguageCountryCode(lang);
    const label = getLanguageDisplayName(lang);
    return `<img class="${className}" src="/flags/${code}.svg" alt="${label}" decoding="async" loading="lazy">`;
}

function applyTranslations() {
    document.title = t('appTitle');
    document.documentElement.lang = currentLanguage === 'en' ? 'en' : 'pt-br';

    document.querySelectorAll('[data-i18n]').forEach((element) => {
        element.textContent = t(element.dataset.i18n);
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
        element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder));
    });

    document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
        element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
    });

    const totalMiracles = countries.reduce((sum, country) => sum + country.totalMiracles, 0);
    const counterText = t('search.counter', { count: String(totalMiracles) });
    selectors.globalCounter.innerText = counterText;
    if (selectors.mobileGlobalCounter) {
        selectors.mobileGlobalCounter.innerText = counterText;
    }
    selectors.languageCurrentFlag.innerHTML = buildLanguageFlagImage(currentLanguage);
    selectors.languageOptions.forEach((option) => {
        const lang = option.dataset.langOption;
        option.innerHTML = `${buildLanguageFlagImage(lang, 'language-flag-inline')} <span>${getLanguageDisplayName(lang)}</span>`;
    });
    document.querySelectorAll('.miracle-item-status.loading').forEach((statusEl) => {
        statusEl.textContent = t('status.loading');
    });
    renderVisitedHistory();
}

function resolveInitialLanguage() {
    const browserLanguage = (navigator.language || '').toLowerCase();
    if (browserLanguage.startsWith('en')) {
        return 'en';
    }
    return 'pt-BR';
}

function isMobileLayoutContext() {
    return globalThis.matchMedia('(max-width: 1023px)').matches;
}

function initializeMapViewport() {
    if (!isMobileLayoutContext() || !('geolocation' in navigator)) {
        map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => {
                map.setView([coords.latitude, coords.longitude], USER_MAP_ZOOM);
                resolve();
            },
            (error) => {
                if (error.code === error.PERMISSION_DENIED) {
                    console.info('[Map] Location permission denied, using global default.');
                } else if (error.code === error.POSITION_UNAVAILABLE) {
                    console.info('[Map] Location unavailable, using global default.');
                } else if (error.code === error.TIMEOUT) {
                    console.info('[Map] Location timeout, using global default.');
                }
                map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
                resolve();
            },
            {
                enableHighAccuracy: false,
                timeout: 7000,
                maximumAge: 120000
            }
        );
    });
}

async function setLanguage(lang) {
    if (!APP_LANGUAGES.has(lang)) {
        return;
    }
    if (lang === currentLanguage) {
        applyTranslations();
        return;
    }

    currentLanguage = lang;
    countries = await loadCountriesData(currentLanguage);
    rerenderCountryUI();
    applyTranslations();
}

function resetCountryDetailView() {
    activeCountryId = null;
    closeMiracleModal();
    selectors.viewCountryDetails.classList.remove('active');
    selectors.viewCountries.classList.remove('hidden');
}

function rerenderCountryUI() {
    selectors.countryGrid.innerHTML = '';
    selectors.miracleList.innerHTML = '';
    selectors.detailCountryTitle.textContent = '';
    selectors.searchCountryInput.value = '';
    if (selectors.searchMiracleInput) {
        selectors.searchMiracleInput.value = '';
    }
    selectors.clearCountrySearchButton.classList.remove('visible');

    activeMiracleUnsubscribers.forEach((unsubscribe) => unsubscribe());
    activeMiracleUnsubscribers = [];
    startCountryPrefetchSession();
    markersCluster.clearLayers();

    resetCountryDetailView();
    renderCountries();
}

function setActivePage(page) {
    selectors.pageExplore.style.display = 'none';
    selectors.pageAbout.style.display = 'none';
    selectors.navExplore.classList.remove('active');
    selectors.navAbout.classList.remove('active');

    if (page === 'explore') {
        selectors.pageExplore.style.display = 'flex';
        selectors.navExplore.classList.add('active');
        selectors.navExplore.setAttribute('aria-current', 'page');
        selectors.navAbout.removeAttribute('aria-current');
        setTimeout(() => map.invalidateSize(), 100);
        return;
    }

    selectors.pageAbout.style.display = 'block';
    selectors.navAbout.classList.add('active');
    selectors.navAbout.setAttribute('aria-current', 'page');
    selectors.navExplore.removeAttribute('aria-current');
}

function clearCountrySearch() {
    selectors.searchCountryInput.value = '';
    selectors.clearCountrySearchButton.classList.remove('visible');
    document.querySelectorAll('.country-card').forEach((card) => {
        card.style.display = 'flex';
    });
    selectors.searchCountryInput.focus();
}

function renderVisitedHistory() {
    if (!selectors.historyList) {
        return;
    }

    selectors.historyList.innerHTML = '';
    if (!visitedCountryIds.length) {
        const emptyState = document.createElement('p');
        emptyState.className = 'history-empty';
        emptyState.textContent = t('sections.historyEmpty');
        selectors.historyList.appendChild(emptyState);
        return;
    }

    visitedCountryIds.forEach((countryId) => {
        const country = countries.find((item) => item.id === countryId);
        if (!country) {
            return;
        }

        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'history-item';
        item.innerHTML = `
            <div class="history-item-main">
                ${buildCountryFlagImage(country)}
                <span class="history-item-name">${country.countryName}</span>
            </div>
            <span class="history-item-count">${country.totalMiracles}</span>
        `;
        item.addEventListener('click', () => openCountryDetails(country));
        selectors.historyList.appendChild(item);
    });
}

function updateCountrySelectionState() {
    document.querySelectorAll('.country-card').forEach((card) => {
        card.classList.toggle('selected', Number(card.dataset.countryId) === activeCountryId);
    });
}

function buildCountryFlagImage(country) {
    if (!country.countryCode) {
        return `<span class="country-flag-fallback" aria-hidden="true">${country.flag || ''}</span>`;
    }
    return `<img class="country-flag-image" src="/flags/${country.countryCode}.svg" alt="${country.countryName}" loading="lazy" decoding="async">`;
}

function getMiracleStatus(url) {
    return miracleStatus.get(url) || 'idle';
}

function setMiracleStatus(url, status) {
    miracleStatus.set(url, status);
    const listeners = miracleStatusListeners.get(url);
    if (listeners) {
        listeners.forEach((listener) => listener(status));
    }
}

function subscribeMiracleStatus(url, listener) {
    const listeners = miracleStatusListeners.get(url) || new Set();
    listeners.add(listener);
    miracleStatusListeners.set(url, listeners);
    listener(getMiracleStatus(url));

    return () => {
        listeners.delete(listener);
        if (!listeners.size) {
            miracleStatusListeners.delete(url);
        }
    };
}

function resetMiracleStatusToIdle(url) {
    if (getMiracleStatus(url) === 'ready') {
        return;
    }
    setMiracleStatus(url, 'idle');
}

function cancelPreviousCountryPrefetch(nextSessionId) {
    const cancelledEntries = prefetchQueue.filter((entry) => entry.sessionId !== nextSessionId);
    cancelledEntries.forEach((entry) => {
        resetMiracleStatusToIdle(entry.url);
        queuedMiracleUrls.delete(entry.url);
    });

    const activeEntries = prefetchQueue.filter((entry) => entry.sessionId === nextSessionId);
    prefetchQueue.length = 0;
    prefetchQueue.push(...activeEntries);
    queuedMiracleUrls.clear();
    activeEntries.forEach((entry) => queuedMiracleUrls.add(entry.url));

    if (currentPrefetchEntry && currentPrefetchEntry.sessionId !== nextSessionId) {
        resetMiracleStatusToIdle(currentPrefetchEntry.url);
        currentPrefetchEntry = null;
        prefetchInProgress = false;
        if (preloadIframe) {
            preloadIframe.onload = null;
            preloadIframe.onerror = null;
            preloadIframe.src = 'about:blank';
        }
    }
}

function startCountryPrefetchSession() {
    activePrefetchSessionId += 1;
    cancelPreviousCountryPrefetch(activePrefetchSessionId);
    return activePrefetchSessionId;
}

function loadNextMiracleInQueue() {
    if (!preloadIframe || prefetchInProgress || !prefetchQueue.length) {
        return;
    }

    const nextEntry = prefetchQueue.shift();
    const { url: nextUrl, sessionId } = nextEntry;
    queuedMiracleUrls.delete(nextUrl);

    if (sessionId !== activePrefetchSessionId) {
        resetMiracleStatusToIdle(nextUrl);
        loadNextMiracleInQueue();
        return;
    }

    if (getMiracleStatus(nextUrl) === 'ready') {
        loadNextMiracleInQueue();
        return;
    }

    currentPrefetchEntry = nextEntry;
    prefetchInProgress = true;
    setMiracleStatus(nextUrl, 'loading');

    const finishLoad = (status) => {
        if (!currentPrefetchEntry || currentPrefetchEntry.url !== nextUrl || currentPrefetchEntry.sessionId !== sessionId || sessionId !== activePrefetchSessionId) {
            prefetchInProgress = false;
            currentPrefetchEntry = null;
            loadNextMiracleInQueue();
            return;
        }
        setMiracleStatus(nextUrl, status);
        prefetchInProgress = false;
        currentPrefetchEntry = null;
        loadNextMiracleInQueue();
    };

    preloadIframe.onload = () => finishLoad('ready');
    preloadIframe.onerror = () => finishLoad('error');
    preloadIframe.src = nextUrl;
}

function scheduleIdlePrefetchPump() {
    if (idlePrefetchScheduled) {
        return;
    }

    idlePrefetchScheduled = true;
    const run = () => {
        idlePrefetchScheduled = false;
        loadNextMiracleInQueue();
        if (prefetchQueue.length) {
            scheduleIdlePrefetchPump();
        }
    };

    if ('requestIdleCallback' in globalThis) {
        globalThis.requestIdleCallback(run, { timeout: 700 });
    } else {
        globalThis.setTimeout(run, 180);
    }
}

function enqueueMiraclePrefetch(url, sessionId = activePrefetchSessionId) {
    const status = getMiracleStatus(url);
    if (status === 'ready' || status === 'loading' || queuedMiracleUrls.has(url)) {
        return;
    }

    queuedMiracleUrls.add(url);
    prefetchQueue.push({ url, sessionId });
    scheduleIdlePrefetchPump();
}

function prefetchCountryMiracles(country, sessionId) {
    country.cities.forEach((city) => {
        enqueueMiraclePrefetch(buildMiracleDocumentUrl(city.url), sessionId);
    });
}

function openMiracleModal(city, countryName) {
    const miracleUrl = buildMiracleDocumentUrl(city.url);
    const status = getMiracleStatus(miracleUrl);

    selectors.modalTitle.innerText = city.name;
    selectors.modalYear.innerText = `${t('detail.countryRegion')}: ${countryName}`;
    selectors.loadingSpinner.style.display = status === 'ready' ? 'none' : 'flex';
    selectors.miracleIframe.style.opacity = status === 'ready' ? '1' : '0';
    activeMiracleUrl = miracleUrl;
    selectors.miracleIframe.src = miracleUrl;
    selectors.miracleModal.classList.add('active');
}

function hideIframeSpinner() {
    if (activeMiracleUrl) {
        setMiracleStatus(activeMiracleUrl, 'ready');
    }
    selectors.loadingSpinner.style.display = 'none';
    selectors.miracleIframe.style.opacity = '1';
}

function closeMiracleModal() {
    selectors.miracleModal.classList.remove('active');
    setTimeout(() => {
        selectors.miracleIframe.src = '';
    }, 300);
}

function closeModalOnBackdropClick(event) {
    if (event.target === selectors.miracleModal) {
        closeMiracleModal();
    }
}

function openCountryDetails(country) {
    visitedCountryIds = [country.id, ...visitedCountryIds.filter((id) => id !== country.id)];
    renderVisitedHistory();
    const sessionId = startCountryPrefetchSession();
    activeCountryId = country.id;
    updateCountrySelectionState();
    prefetchCountryMiracles(country, sessionId);
    map.flyTo(country.coords, country.zoom, { duration: 1.5 });
    selectors.detailCountryTitle.innerHTML = `${buildCountryFlagImage(country)} <span>${country.countryName}</span>`;
    selectors.miracleList.innerHTML = '';
    activeMiracleUnsubscribers.forEach((unsubscribe) => unsubscribe());
    activeMiracleUnsubscribers = [];

    country.cities.forEach((city) => {
        const miracleUrl = buildMiracleDocumentUrl(city.url);
        const listItem = document.createElement('div');
        listItem.className = 'miracle-list-item';
        listItem.dataset.search = `${city.name.toLowerCase()} ${city.year.toLowerCase()}`;
        listItem.dataset.url = miracleUrl;
        listItem.innerHTML = `
            <div class="miracle-item-main">
                <div class="miracle-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="4"></circle>
                        <line x1="12" y1="2" x2="12" y2="5"></line>
                        <line x1="12" y1="19" x2="12" y2="22"></line>
                        <line x1="4.9" y1="4.9" x2="7" y2="7"></line>
                        <line x1="17" y1="17" x2="19.1" y2="19.1"></line>
                        <line x1="2" y1="12" x2="5" y2="12"></line>
                        <line x1="19" y1="12" x2="22" y2="12"></line>
                        <line x1="4.9" y1="19.1" x2="7" y2="17"></line>
                        <line x1="17" y1="7" x2="19.1" y2="4.9"></line>
                    </svg>
                </div>
                <div class="miracle-text">
                    <h4>${city.name}</h4>
                    <span>${city.year}</span>
                </div>
            </div>
            <small class="miracle-item-status"></small>
        `;
        listItem.addEventListener('click', () => openMiracleModal(city, country.countryName));
        const statusEl = listItem.querySelector('.miracle-item-status');
        const unsubscribe = subscribeMiracleStatus(miracleUrl, (status) => {
            if (status === 'ready') {
                statusEl.textContent = t('status.ready');
                statusEl.className = 'miracle-item-status ready';
                return;
            }
            statusEl.textContent = t('status.loading');
            statusEl.className = 'miracle-item-status loading';
        });
        activeMiracleUnsubscribers.push(unsubscribe);
        selectors.miracleList.appendChild(listItem);
        enqueueMiraclePrefetch(miracleUrl, sessionId);
    });

    selectors.viewCountries.classList.add('hidden');
    selectors.viewCountryDetails.classList.add('active');
    if (selectors.searchMiracleInput) {
        selectors.searchMiracleInput.value = '';
    }
}

function goBackToCountries() {
    selectors.viewCountryDetails.classList.remove('active');
    selectors.viewCountries.classList.remove('hidden');
    map.flyTo(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, { duration: 1.5 });
}

function renderCountries() {
    selectors.countryGrid.innerHTML = '';
    if (selectors.mobileCountryCarousel) {
        selectors.mobileCountryCarousel.innerHTML = '';
    }
    countries.forEach((country) => {
        const createCountryCard = () => {
            const card = document.createElement('div');
            card.className = 'country-card';
            card.dataset.name = country.countryName.toLowerCase();
            card.dataset.countryId = country.id;
            card.setAttribute('role', 'button');
            card.setAttribute('tabindex', '0');
            card.innerHTML = `<div class="country-flag">${buildCountryFlagImage(country)}</div><div class="country-info"><span class="country-name">${country.countryName}</span><span class="miracle-count">${country.totalMiracles}</span></div>`;
            card.addEventListener('click', () => openCountryDetails(country));
            card.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openCountryDetails(country);
                }
            });
            return card;
        };

        selectors.countryGrid.appendChild(createCountryCard());
        if (selectors.mobileCountryCarousel) {
            selectors.mobileCountryCarousel.appendChild(createCountryCard());
        }

        country.cities.forEach((city) => {
            const marker = L.marker([city.lat, city.lng], {
                icon: miracleMarkerIcon,
                title: country.countryName
            });
            marker.bindTooltip(country.countryName, {
                direction: 'top',
                offset: [0, -18],
                opacity: 0.9
            });
            marker.on('click', () => openMiracleModal(city, country.countryName));
            markersCluster.addLayer(marker);
        });
    });
    map.addLayer(markersCluster);
}

function bindEvents() {
    selectors.navExplore.addEventListener('click', () => setActivePage('explore'));
    selectors.navAbout.addEventListener('click', () => setActivePage('about'));
    selectors.navExplore.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setActivePage('explore');
        }
    });
    selectors.navAbout.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setActivePage('about');
        }
    });
    selectors.backToCountriesButton.addEventListener('click', goBackToCountries);
    selectors.closeModalButton.addEventListener('click', closeMiracleModal);
    selectors.miracleModal.addEventListener('click', closeModalOnBackdropClick);
    selectors.miracleIframe.addEventListener('load', hideIframeSpinner);
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && selectors.miracleModal.classList.contains('active')) {
            closeMiracleModal();
        }
    });
    selectors.clearCountrySearchButton.addEventListener('click', clearCountrySearch);
    selectors.languageCurrentButton.addEventListener('click', () => {
        const isOpen = selectors.languageMenu.classList.toggle('open');
        selectors.languageCurrentButton.setAttribute('aria-expanded', String(isOpen));
    });
    selectors.languageOptions.forEach((option) => {
        option.addEventListener('click', async () => {
            await setLanguage(option.dataset.langOption);
            selectors.languageMenu.classList.remove('open');
            selectors.languageCurrentButton.setAttribute('aria-expanded', 'false');
        });
    });
    document.addEventListener('click', (event) => {
        if (!selectors.languagePicker.contains(event.target)) {
            selectors.languageMenu.classList.remove('open');
            selectors.languageCurrentButton.setAttribute('aria-expanded', 'false');
        }
    });
    globalThis.addEventListener('resize', () => {
        map.invalidateSize();
    });

    selectors.searchCountryInput.addEventListener('input', (event) => {
        const term = event.target.value.toLowerCase();
        selectors.clearCountrySearchButton.classList.toggle('visible', term.length > 0);
        document.querySelectorAll('.country-card').forEach((card) => {
            card.style.display = card.dataset.name.includes(term) ? 'flex' : 'none';
        });
    });

    if (selectors.searchMiracleInput) {
        selectors.searchMiracleInput.addEventListener('input', (event) => {
            const term = event.target.value.toLowerCase();
            document.querySelectorAll('.miracle-list-item').forEach((item) => {
                item.style.display = item.dataset.search.includes(term) ? 'flex' : 'none';
            });
        });
    }
}

async function initializeApp() {
    currentLanguage = resolveInitialLanguage();
    countries = await loadCountriesData(currentLanguage);
    preloadIframe = document.createElement('iframe');
    preloadIframe.style.display = 'none';
    preloadIframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(preloadIframe);

    await initializeMapViewport();
    renderCountries();
    renderVisitedHistory();
    bindEvents();
    applyTranslations();
}

try {
    await initializeApp();
} catch (error) {
    console.error(error);
    selectors.globalCounter.innerText = t('error.dataLoad');
    if (selectors.mobileGlobalCounter) {
        selectors.mobileGlobalCounter.innerText = t('error.dataLoad');
    }
}
