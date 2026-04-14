import './styles.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

const APP_LANGUAGES = new Set(['pt-BR', 'en']);

const TRANSLATIONS = {
    'pt-BR': {
        appTitle: 'bentinho - Mapa Interativo',
        nav: { explore: 'Explorar', about: 'Sobre' },
        search: {
            title: 'Onde você deseja ir?',
            placeholder: 'Pesquisar país...',
            clearAria: 'Limpar busca',
            counter: 'Explore {count} milagres documentados'
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
        nav: { explore: 'Explore', about: 'About' },
        search: {
            title: 'Where do you want to go?',
            placeholder: 'Search country...',
            clearAria: 'Clear search',
            counter: 'Explore {count} documented miracles'
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

async function loadCountriesData(lang) {
    const response = await fetch(getDataFilePathByLanguage(lang));
    if (!response.ok) {
        throw new Error(`Failed to load data file: ${response.status}`);
    }

    const rawCountries = await response.json();
    return rawCountries.map((country) => ({
        ...country,
        totalMiracles: country.cities.length
    }));
}

const selectors = {
    pageExplore: document.getElementById('page-explore'),
    pageAbout: document.getElementById('page-about'),
    navExplore: document.getElementById('nav-explore'),
    navAbout: document.getElementById('nav-about'),
    globalCounter: document.getElementById('globalCounter'),
    countryGrid: document.getElementById('countryGrid'),
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

const map = L.map('map', { zoomControl: false }).setView([20, 0], 3);
const markersCluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 7
});
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' }).addTo(map);

function t(path, replacements = {}) {
    const value = path.split('.').reduce((acc, key) => acc?.[key], TRANSLATIONS[currentLanguage]) || '';
    return Object.entries(replacements).reduce((text, [key, replacement]) => {
        return text.replace(`{${key}}`, replacement);
    }, value);
}

function getLanguageFlag(lang) {
    return lang === 'en' ? '🇺🇸' : '🇧🇷';
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
    selectors.globalCounter.innerText = t('search.counter', { count: String(totalMiracles) });
    selectors.languageCurrentFlag.textContent = getLanguageFlag(currentLanguage);
    document.querySelectorAll('.miracle-item-status.loading').forEach((statusEl) => {
        statusEl.textContent = t('status.loading');
    });
}

function resolveInitialLanguage() {
    const browserLanguage = (navigator.language || '').toLowerCase();
    if (browserLanguage.startsWith('en')) {
        return 'en';
    }
    return 'pt-BR';
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

function updateCountrySelectionState() {
    document.querySelectorAll('.country-card').forEach((card) => {
        card.classList.toggle('selected', Number(card.dataset.countryId) === activeCountryId);
    });
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
        enqueueMiraclePrefetch(getBaseUrlByLanguage(currentLanguage) + city.url, sessionId);
    });
}

function openMiracleModal(city, countryName) {
    const miracleUrl = getBaseUrlByLanguage(currentLanguage) + city.url;
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
    const sessionId = startCountryPrefetchSession();
    activeCountryId = country.id;
    updateCountrySelectionState();
    prefetchCountryMiracles(country, sessionId);
    map.flyTo(country.coords, country.zoom, { duration: 1.5 });
    selectors.detailCountryTitle.innerHTML = `${country.flag} ${country.countryName}`;
    selectors.miracleList.innerHTML = '';
    activeMiracleUnsubscribers.forEach((unsubscribe) => unsubscribe());
    activeMiracleUnsubscribers = [];

    country.cities.forEach((city) => {
        const miracleUrl = getBaseUrlByLanguage(currentLanguage) + city.url;
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
    map.flyTo([20, 0], 3, { duration: 1.5 });
}

function renderCountries() {
    countries.forEach((country) => {
        const card = document.createElement('div');
        card.className = 'country-card';
        card.dataset.name = country.countryName.toLowerCase();
        card.dataset.countryId = country.id;
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.innerHTML = `<div class="country-flag">${country.flag}</div><div class="country-info"><span class="country-name">${country.countryName}</span><span class="miracle-count">${country.totalMiracles}</span></div>`;
        card.addEventListener('click', () => openCountryDetails(country));
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openCountryDetails(country);
            }
        });
        selectors.countryGrid.appendChild(card);

        country.cities.forEach((city) => {
            const marker = L.marker([city.lat, city.lng]);
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

    renderCountries();
    bindEvents();
    applyTranslations();
}

try {
    await initializeApp();
} catch (error) {
    console.error(error);
    selectors.globalCounter.innerText = t('error.dataLoad');
}
