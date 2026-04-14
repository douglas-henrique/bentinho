const BASE_URL = "https://www.miracolieucaristici.org/pr/Liste/";
const DATA_FILE_PATH = "/data/miracles-data.json";

import './styles.css';

let countries = [];

async function loadCountriesData() {
    const response = await fetch(DATA_FILE_PATH);
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
    searchMiracleInput: document.getElementById('searchMiracleInput'),
    miracleModal: document.getElementById('miracleModal'),
    modalTitle: document.getElementById('modalTitle'),
    modalYear: document.getElementById('modalYear'),
    closeModalButton: document.getElementById('closeModalButton'),
    backToCountriesButton: document.getElementById('backToCountriesButton'),
    loadingSpinner: document.querySelector('.loading-spinner'),
    miracleIframe: document.getElementById('miracleIframe')
};

const map = L.map('map', { zoomControl: false }).setView([20, 0], 3);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' }).addTo(map);

function setActivePage(page) {
    selectors.pageExplore.style.display = 'none';
    selectors.pageAbout.style.display = 'none';
    selectors.navExplore.classList.remove('active');
    selectors.navAbout.classList.remove('active');

    if (page === 'explore') {
        selectors.pageExplore.style.display = 'flex';
        selectors.navExplore.classList.add('active');
        setTimeout(() => map.invalidateSize(), 100);
        return;
    }

    selectors.pageAbout.style.display = 'block';
    selectors.navAbout.classList.add('active');
}

function openMiracleModal(city, countryName) {
    selectors.modalTitle.innerText = city.name;
    selectors.modalYear.innerText = `País/Região: ${countryName}`;
    selectors.loadingSpinner.style.display = 'block';
    selectors.miracleIframe.style.opacity = '0';
    selectors.miracleIframe.src = BASE_URL + city.url;
    selectors.miracleModal.classList.add('active');
}

function hideIframeSpinner() {
    selectors.loadingSpinner.style.display = 'none';
    selectors.miracleIframe.style.opacity = '1';
    selectors.miracleIframe.style.transition = 'opacity 0.3s ease';
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
    map.flyTo(country.coords, country.zoom, { duration: 1.5 });
    selectors.detailCountryTitle.innerHTML = `${country.flag} ${country.countryName}`;
    selectors.miracleList.innerHTML = '';

    country.cities.forEach((city) => {
        const listItem = document.createElement('div');
        listItem.className = 'miracle-list-item';
        listItem.dataset.search = `${city.name.toLowerCase()} ${city.year.toLowerCase()}`;
        listItem.innerHTML = `
            <div class="miracle-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            </div>
            <div>
                <h4>${city.name}</h4>
                <span>${city.year}</span>
            </div>
        `;
        listItem.addEventListener('click', () => openMiracleModal(city, country.countryName));
        selectors.miracleList.appendChild(listItem);
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
        card.innerHTML = `<div class="country-flag">${country.flag}</div><div class="country-info"><span class="country-name">${country.countryName}</span><span class="miracle-count">${country.totalMiracles}</span></div>`;
        card.addEventListener('click', () => openCountryDetails(country));
        selectors.countryGrid.appendChild(card);

        country.cities.forEach((city) => {
            const marker = L.marker([city.lat, city.lng]).addTo(map);
            marker.on('click', () => openMiracleModal(city, country.countryName));
        });
    });
}

function bindEvents() {
    selectors.navExplore.addEventListener('click', () => setActivePage('explore'));
    selectors.navAbout.addEventListener('click', () => setActivePage('about'));
    selectors.backToCountriesButton.addEventListener('click', goBackToCountries);
    selectors.closeModalButton.addEventListener('click', closeMiracleModal);
    selectors.miracleModal.addEventListener('click', closeModalOnBackdropClick);
    selectors.miracleIframe.addEventListener('load', hideIframeSpinner);

    selectors.searchCountryInput.addEventListener('input', (event) => {
        const term = event.target.value.toLowerCase();
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
    countries = await loadCountriesData();
    const totalMiracles = countries.reduce((sum, country) => sum + country.totalMiracles, 0);
    selectors.globalCounter.innerText = `Explore ${totalMiracles} milagres documentados`;
    renderCountries();
    bindEvents();
}

try {
    await initializeApp();
} catch (error) {
    console.error(error);
    selectors.globalCounter.innerText = 'Erro ao carregar dados';
}
