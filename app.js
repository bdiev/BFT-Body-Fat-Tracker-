// ===== СОСТОЯНИЕ И ПЕРЕМЕННЫЕ =====
const sexState = { current: 'male' };
let currentUser = null;
let authenticated = false;
let history = [];
let userId = null;
let ws = null; // WebSocket для реал-тайма

// Состояние воды
let waterSettings = {
	weight: 70,
	activity: 'moderate',
	daily_goal: 2000,
	reset_time: '00:00',
	quick_buttons: []
};
let waterLogs = [];
let currentWaterPeriod = 'day';
let currentWaterChartPeriod = 'day';
let waterChartData = [];

const CACHE_KEYS = {
	user: 'cache_user',
	history: 'cache_history',
	userSettings: 'cache_user_settings',
	waterSettings: 'cache_water_settings',
	waterLogs: 'cache_water_logs'
};

function saveCache(key, value) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch (e) {
		console.warn('Не удалось сохранить кэш', key, e);
	}
}

function loadCache(key, fallback = null) {
	try {
		const raw = localStorage.getItem(key);
		return raw ? JSON.parse(raw) : fallback;
	} catch (e) {
		console.warn('Не удалось загрузить кэш', key, e);
		return fallback;
	}
}

const defaultCardVisibility = () => ({
	form: true,
	history: true,
	chart: true,
	waterTracker: true,
	waterChart: true
});

const defaultCardOrder = () => [
	'form',
	'history',
	'chart',
	'waterTracker',
	'waterChart'
];

let userSettings = {
	card_visibility: defaultCardVisibility(),
	card_order: defaultCardOrder()
};

// Синхронизация настроек между устройствами
let lastSyncTime = 0;
let lastCardVisibility = defaultCardVisibility();
let lastCardOrder = defaultCardOrder();

// Очередь для оффлайн-запросов
let offlineQueue = [];

// Событие установки PWA
let deferredPrompt = null;

// Загружаем очередь из localStorage при старте
try {
	const savedQueue = localStorage.getItem('offlineQueue');
	if (savedQueue) {
		offlineQueue = JSON.parse(savedQueue);
		console.log('📦 Загружена очередь оффлайн-запросов:', offlineQueue.length);
	}
} catch (e) {
	console.error('Ошибка загрузки очереди:', e);
}

// Ловим событие установки PWA
window.addEventListener('beforeinstallprompt', (e) => {
	e.preventDefault();
	deferredPrompt = e;
	console.log('✨ PWA можно установить');
});

// Функция показа диалога установки
async function showInstallPrompt() {
	if (!deferredPrompt) {
		alert('Приложение уже установлено или не поддерживается на этом устройстве');
		return;
	}

	try {
		deferredPrompt.prompt();
		const { outcome } = await deferredPrompt.userChoice;
		console.log(`Результат установки: ${outcome}`);
		deferredPrompt = null;
	} catch (err) {
		console.error('Ошибка при показе диалога установки:', err);
	}
}

// Сохраняем очередь в localStorage
function saveOfflineQueue() {
	try {
		localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
	} catch (e) {
		console.error('Ошибка сохранения очереди:', e);
	}
}

// Обработка оффлайн-запросов при возвращении онлайн
async function processOfflineQueue() {
	if (offlineQueue.length === 0) return;
	
	console.log('🌐 Онлайн! Обрабатываю очередь из', offlineQueue.length, 'запросов...');
	
	const queue = [...offlineQueue];
	offlineQueue = [];
	saveOfflineQueue();
	
	for (const item of queue) {
		try {
			console.log('📤 Отправляю оффлайн-запрос:', item.endpoint);
			await apiCall(item.endpoint, item.options);
			console.log('✓ Успешно:', item.endpoint);
		} catch (err) {
			console.error('❌ Ошибка при отправке оффлайн-запроса:', err);
			// Возвращаем обратно в очередь если не удалось
			offlineQueue.push(item);
		}
	}
	
	saveOfflineQueue();
	
	if (offlineQueue.length === 0) {
		console.log('✓ Все оффлайн-данные синхронизированы!');
		// Перезагружаем данные после синхронизации
		if (authenticated) {
			await loadUserData();
			await loadUserSettings();
			await loadWaterSettings();
			await loadWaterLogs();
			renderHistory();
			drawChart();
		}
	}
}

// Отслеживаем восстановление соединения
window.addEventListener('online', () => {
	console.log('🌐 Соединение восстановлено!');
	processOfflineQueue();
});

window.addEventListener('offline', () => {
	console.log('📴 Соединение потеряно. Данные будут синхронизированы при восстановлении.');
});

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ДАТЫ/ВРЕМЕНИ =====
function formatLocalDateTime(timestamp, options = {}) {
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	return new Date(timestamp).toLocaleString('ru-RU', { timeZone, ...options });
}

// Нормализация временной метки: если сервер вернул строку без таймзоны ("YYYY-MM-DD HH:mm:ss"),
// добавляем 'Z', чтобы трактовать её как UTC и затем показать в локальном времени пользователя.
function normalizeTimestamp(ts) {
	if (ts instanceof Date) return ts;
	if (typeof ts === 'number') return new Date(ts);
	if (typeof ts === 'string') {
		const hasTZ = /[zZ]|[+-]\d\d:?\d\d/.test(ts);
		return new Date(hasTZ ? ts : `${ts}Z`);
	}
	return new Date(ts);
}

// Возвращает локальный момент последнего "сброса дня" для воды по reset_time (HH:mm)
function getLastWaterResetBoundary(resetTime = '00:00') {
	const [hh, mm] = (resetTime || '00:00').split(':').map(v => parseInt(v, 10) || 0);
	const now = new Date();
	const boundary = new Date(now);
	boundary.setHours(hh, mm, 0, 0);
	if (boundary > now) {
		boundary.setDate(boundary.getDate() - 1);
	}
	return boundary;
}

function getPeriodBoundary(period = 'day') {
	const now = new Date();
	const boundary = new Date(now);
	switch (period) {
		case 'day':
			boundary.setDate(now.getDate() - 1);
			break;
		case 'week':
			boundary.setDate(now.getDate() - 7);
			break;
		case 'month':
			boundary.setMonth(now.getMonth() - 1);
			break;
		case 'year':
			boundary.setFullYear(now.getFullYear() - 1);
			break;
		default:
			boundary.setDate(now.getDate() - 1);
	}
	return boundary;
}

function startOfTodayLocal() {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d;
}

function getPeriodRange(period = 'day', resetTime = '00:00') {
	const now = new Date();
	const startToday = startOfTodayLocal();
	switch (period) {
		case 'day': {
			const start = getLastWaterResetBoundary(resetTime);
			const end = new Date(start);
			end.setDate(end.getDate() + 1);
			return { start, end };
		}
		case 'week': {
			const end = new Date(startToday);
			end.setDate(end.getDate() + 1); // до начала завтрашнего
			const start = new Date(end);
			start.setDate(start.getDate() - 7);
			return { start, end };
		}
		case 'month': {
			const start = new Date(startToday.getFullYear(), startToday.getMonth(), 1);
			const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
			return { start, end };
		}
		case 'year': {
			const start = new Date(startToday.getFullYear(), 0, 1);
			const end = new Date(startToday.getFullYear() + 1, 0, 1);
			return { start, end };
		}
		default: {
			const start = getLastWaterResetBoundary(resetTime);
			const end = new Date(start);
			end.setDate(end.getDate() + 1);
			return { start, end };
		}
	}
}

function buildWaterSeries(period, logs, resetTime = '00:00') {
	const { start, end } = getPeriodRange(period, resetTime);
	const filtered = logs
		.map(l => ({ ...l, ts: normalizeTimestamp(l.logged_at) }))
		.filter(l => l.ts >= start && l.ts < end);

	const series = [];
	if (period === 'day') {
		// Возвращаем как есть, но отсортировано
		return filtered.sort((a, b) => a.ts - b.ts).map(l => ({ label: formatLocalDateTime(l.ts, { hour: '2-digit', minute: '2-digit' }), amount: l.amount, raw: l }));
	}

	if (period === 'week') {
		for (let i = 0; i < 7; i++) {
			const dayStart = new Date(start);
			dayStart.setDate(start.getDate() + i);
			const dayEnd = new Date(dayStart);
			dayEnd.setDate(dayStart.getDate() + 1);
			const total = filtered
				.filter(l => l.ts >= dayStart && l.ts < dayEnd)
				.reduce((s, l) => s + l.amount, 0);
			series.push({ label: formatLocalDateTime(dayStart, { weekday: 'short' }), amount: total, date: dayStart });
		}
		return series;
	}

	if (period === 'month') {
		let d = new Date(start);
		while (d < end) {
			const dayStart = new Date(d);
			const dayEnd = new Date(dayStart);
			dayEnd.setDate(dayStart.getDate() + 1);
			const total = filtered
				.filter(l => l.ts >= dayStart && l.ts < dayEnd)
				.reduce((s, l) => s + l.amount, 0);
			series.push({ label: formatLocalDateTime(dayStart, { day: '2-digit', month: 'short' }), amount: total, date: dayStart });
			d.setDate(d.getDate() + 1);
		}
		return series;
	}

	// year
	for (let m = 0; m < 12; m++) {
		const monthStart = new Date(start.getFullYear(), m, 1);
		const monthEnd = new Date(start.getFullYear(), m + 1, 1);
		const total = filtered
			.filter(l => l.ts >= monthStart && l.ts < monthEnd)
			.reduce((s, l) => s + l.amount, 0);
		series.push({ label: formatLocalDateTime(monthStart, { month: 'short' }), amount: total, date: monthStart });
	}
	return series;
}

function normalizeCardVisibility(visibility = {}) {
	const merged = { ...defaultCardVisibility(), ...(visibility || {}) };
	return {
		form: merged.form === true,
		history: merged.history === true,
		chart: merged.chart === true,
		waterTracker: merged.waterTracker === true,
		waterChart: merged.waterChart === true
	};
}

function normalizeCardOrder(order = []) {
	const base = defaultCardOrder();
	const filtered = (order || []).filter((key) => base.includes(key));
	const missing = base.filter((key) => !filtered.includes(key));
	return [...filtered, ...missing];
}

const CARD_LAYOUT_KEY = 'cardLayoutMode';

function getStoredCardLayout() {
	const stored = localStorage.getItem(CARD_LAYOUT_KEY);
	return stored === 'grid' ? 'grid' : 'stack';
}

function setStoredCardLayout(layout) {
	try {
		localStorage.setItem(CARD_LAYOUT_KEY, layout === 'grid' ? 'grid' : 'stack');
	} catch (e) {
		console.error('Не удалось сохранить раскладку карточек:', e);
	}
}

function applyCardLayout(layout) {
	const container = document.getElementById('cardsContainer');
	if (!container) return;
	const isGrid = layout === 'grid';
	container.classList.toggle('grid-layout', isGrid);
	if (cardLayoutToggle) {
		cardLayoutToggle.checked = isGrid;
	}
}

const cardOrderNames = {
	form: 'Форма расчёта',
	history: 'История прогресса',
	chart: 'График жира',
	waterTracker: 'Трекер воды',
	waterChart: 'График воды'
};

function toggleCardElement(el, visible) {
	if (!el) return;
	el.classList.toggle('hidden-by-pref', !visible);
}

function applyCardVisibility() {
	const vis = normalizeCardVisibility(userSettings.card_visibility);
	toggleCardElement(document.getElementById('form-card'), vis.form);
	toggleCardElement(document.getElementById('history-card'), vis.history);
	toggleCardElement(document.getElementById('chart-section'), vis.chart);
	toggleCardElement(document.getElementById('waterSection'), vis.waterTracker);
	toggleCardElement(document.getElementById('waterChartSection'), vis.waterChart);
	applyCardOrder();
}

function syncCardVisibilityUI() {
	const vis = normalizeCardVisibility(userSettings.card_visibility);
	const map = {
		toggleFormCard: 'form',
		toggleHistoryCard: 'history',
		toggleChartCard: 'chart',
		toggleWaterCard: 'waterTracker',
		toggleWaterChartCard: 'waterChart'
	};
	Object.entries(map).forEach(([id, key]) => {
		const el = document.getElementById(id);
		if (el) el.checked = !!vis[key];
	});
	renderCardOrderEditor();
}

function applyCardOrder() {
	const container = document.getElementById('cardsContainer');
	if (!container) return;

	const order = normalizeCardOrder(userSettings.card_order);
	const vis = normalizeCardVisibility(userSettings.card_visibility);
	const idMap = {
		form: 'form-card',
		history: 'history-card',
		chart: 'chart-section',
		waterTracker: 'waterSection',
		waterChart: 'waterChartSection'
	};

	order.forEach((key) => {
		const elId = idMap[key];
		if (!elId) return;
		const el = document.getElementById(elId);
		if (!el) return;
		el.classList.toggle('hidden-by-pref', !vis[key]);
		// Реальное перемещение элемента, чтобы порядок менялся в гриде
		container.appendChild(el);
	});
}

function renderCardOrderEditor() {
	const list = document.getElementById('cardOrderList');
	if (!list) return;
	const order = normalizeCardOrder(userSettings.card_order);
	const vis = normalizeCardVisibility(userSettings.card_visibility);
	const visibleOrder = order.filter(key => vis[key]);
	list.innerHTML = '';
	visibleOrder.forEach((key, idx) => {
		const li = document.createElement('li');
		li.style.display = 'flex';
		li.style.alignItems = 'center';
		li.style.justifyContent = 'space-between';
		li.style.gap = '8px';
		li.style.padding = '8px 10px';
		li.style.border = '1px solid rgba(99, 102, 241, 0.2)';
		li.style.borderRadius = '10px';
		li.style.background = 'rgba(99, 102, 241, 0.05)';

		const label = document.createElement('span');
		label.textContent = cardOrderNames[key] || key;
		label.style.fontWeight = '600';
		label.style.color = 'var(--text-dark)';

		const controls = document.createElement('div');
		controls.style.display = 'flex';
		controls.style.gap = '6px';

		const upBtn = document.createElement('button');
		upBtn.type = 'button';
		upBtn.textContent = '↑';
		upBtn.style.padding = '6px 10px';
		upBtn.style.borderRadius = '8px';
		upBtn.style.border = '1px solid rgba(99, 102, 241, 0.25)';
		upBtn.style.background = 'rgba(99, 102, 241, 0.12)';
		upBtn.style.color = '#a5b4fc';
		upBtn.style.cursor = idx === 0 ? 'not-allowed' : 'pointer';
		upBtn.disabled = idx === 0;
		upBtn.addEventListener('click', () => moveCardOrder(key, -1));

		const downBtn = document.createElement('button');
		downBtn.type = 'button';
		downBtn.textContent = '↓';
		downBtn.style.padding = '6px 10px';
		downBtn.style.borderRadius = '8px';
		downBtn.style.border = '1px solid rgba(99, 102, 241, 0.25)';
		downBtn.style.background = 'rgba(99, 102, 241, 0.12)';
		downBtn.style.color = '#a5b4fc';
		downBtn.style.cursor = idx === visibleOrder.length - 1 ? 'not-allowed' : 'pointer';
		downBtn.disabled = idx === visibleOrder.length - 1;
		downBtn.addEventListener('click', () => moveCardOrder(key, 1));

		controls.appendChild(upBtn);
		controls.appendChild(downBtn);
		li.appendChild(label);
		li.appendChild(controls);
		list.appendChild(li);
	});
}

async function moveCardOrder(key, direction) {
	const order = normalizeCardOrder(userSettings.card_order);
	const vis = normalizeCardVisibility(userSettings.card_visibility);
	const visibleOrder = order.filter(k => vis[k]);
	const visibleIdx = visibleOrder.indexOf(key);
	const target = visibleIdx + direction;
	if (visibleIdx === -1 || target < 0 || target >= visibleOrder.length) return;
	
	// Swap in visible order
	[visibleOrder[visibleIdx], visibleOrder[target]] = [visibleOrder[target], visibleOrder[visibleIdx]];
	
	// Rebuild full order: visible first (in new order), then hidden
	const newOrder = [...visibleOrder, ...order.filter(k => !vis[k])];
	userSettings.card_order = newOrder;
	applyCardOrder();
	await saveUserSettings({}, newOrder);
	renderCardOrderEditor();
}

function setCardVisibilityStatus(message, tone = 'muted') {
	const el = document.getElementById('cardVisibilityStatus');
	if (!el) return;
	el.textContent = message || '';
	el.style.color = tone === 'error' ? '#ef4444' : '#a5b4fc';
}

async function loadUserSettings() {
	try {
		const settings = await apiCall('/api/user-settings');
		console.log('📥 ПОЛУЧЕНО с сервера при загрузке:', JSON.stringify(settings));
		console.log('📦 card_visibility от сервера:', settings.card_visibility);
		const loadedVis = normalizeCardVisibility(settings.card_visibility);
		console.log('✓ После нормализации:', loadedVis);
		userSettings.card_visibility = loadedVis;
		userSettings.card_order = normalizeCardOrder(settings.card_order);
		// Сохраняем для сравнения при синхронизации
		lastCardVisibility = { ...loadedVis };
		lastCardOrder = [...userSettings.card_order ];
		setCardVisibilityStatus('Настройки карточек загружены');
		saveCache(CACHE_KEYS.userSettings, userSettings);
	} catch (err) {
		console.error('Не удалось загрузить настройки пользователя:', err.message);
		const cached = loadCache(CACHE_KEYS.userSettings);
		if (!navigator.onLine && cached) {
			userSettings = {
				card_visibility: normalizeCardVisibility(cached.card_visibility),
				card_order: normalizeCardOrder(cached.card_order)
			};
			lastCardVisibility = { ...userSettings.card_visibility };
			lastCardOrder = [...userSettings.card_order ];
			setCardVisibilityStatus('Оффлайн: применены сохранённые настройки');
		} else {
			userSettings.card_visibility = defaultCardVisibility();
			userSettings.card_order = defaultCardOrder();
			lastCardVisibility = { ...userSettings.card_visibility };
			lastCardOrder = [...userSettings.card_order ];
			setCardVisibilityStatus('Не удалось загрузить настройки, показаны все карточки', 'error');
		}
	}
	applyCardVisibility();
	syncCardVisibilityUI();
	applyCardOrder();
}

// Синхронизация настроек между устройствами в реальном времени
async function syncCardSettingsFromServer() {
	if (!authenticated || !navigator.onLine) return;
	
	try {
		const now = Date.now();
		// Проверяем не чаще чем раз в 1 секунду
		if (now - lastSyncTime < 1000) return;
		lastSyncTime = now;
		
		const settings = await apiCall('/api/user-settings');
		if (!settings) return;
		
	// Нормализуем данные с сервера
	const serverVisibility = settings.card_visibility || {};
	const serverOrder = Array.isArray(settings.card_order) ? settings.card_order : defaultCardOrder();
	
	// Проверяем изменилась ли видимость карточек
	const visibilityChanged = JSON.stringify(serverVisibility) !== JSON.stringify(lastCardVisibility);
	const orderChanged = JSON.stringify(serverOrder) !== JSON.stringify(lastCardOrder);
	
	if (visibilityChanged || orderChanged) {
		lastCardVisibility = { ...serverVisibility };
		lastCardOrder = [...serverOrder];
		
		userSettings.card_visibility = serverVisibility;
		userSettings.card_order = serverOrder;
			applyCardOrder();
			
			// Показываем краткое уведомление
			const el = document.getElementById('cardVisibilityStatus');
			if (el) {
				el.textContent = 'Обновлено на другом устройстве';
				el.style.color = '#74c0fc';
				setTimeout(() => {
					el.textContent = '';
				}, 2000);
			}
		}
	} catch (err) {
		console.error('Ошибка синхронизации настроек:', err.message);
	}
}


async function saveUserSettings(partialVisibility = {}, newOrder = null) {
	const mergedVisibility = normalizeCardVisibility({ ...userSettings.card_visibility, ...partialVisibility });
	const mergedOrder = normalizeCardOrder(newOrder ?? userSettings.card_order);
	console.log('💾 saveUserSettings:', { partialVisibility, mergedVisibility, mergedOrder });
	console.log('📤 ОТПРАВЛЯЮ на сервер:', JSON.stringify({ card_visibility: mergedVisibility, card_order: mergedOrder }));
	userSettings.card_visibility = mergedVisibility;
	userSettings.card_order = mergedOrder;
	// Сохраняем для сравнения при синхронизации
	lastCardVisibility = { ...mergedVisibility };
	lastCardOrder = [...mergedOrder ];
	applyCardVisibility();
	syncCardVisibilityUI();
	applyCardOrder();
	setCardVisibilityStatus('Сохраняю...');
	try {
		const response = await apiCall('/api/user-settings', {
			method: 'POST',
			body: JSON.stringify({ card_visibility: mergedVisibility, card_order: mergedOrder })
		});
		console.log('📥 ПОЛУЧЕНО с сервера:', response);
		console.log('✓ Настройки сохранены на сервер');
		setCardVisibilityStatus('✓ Сохранено');
	} catch (err) {
		console.error('Не удалось сохранить настройки карточек:', err.message);
		setCardVisibilityStatus('Не удалось сохранить', 'error');
	}
}

// ===== API ФУНКЦИИ =====
async function apiCall(endpoint, options = {}) {
	try {
		const fullUrl = new URL(endpoint, window.location.origin).href;
		const response = await fetch(fullUrl, {
			credentials: 'include',
			...options,
			headers: {
				'Content-Type': 'application/json',
				...options.headers
			}
		});
		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'API ошибка');
		}
		const data = await response.json();
		return data;
	} catch (err) {
		console.error('API ошибка:', err);
		
		// Если это POST/PUT/DELETE запрос и мы оффлайн - добавляем в очередь
		if (!navigator.onLine && options.method && ['POST', 'PUT', 'DELETE'].includes(options.method)) {
			console.log('📴 Оффлайн - добавляю запрос в очередь:', endpoint);
			offlineQueue.push({
				endpoint,
				options,
				timestamp: Date.now()
			});
			saveOfflineQueue();
			throw new Error('Данные сохранены. Будут отправлены при подключении к сети.');
		}
		
		throw err;
	}
}

// ===== WebSocket для реал-тайма =====
function connectWebSocket(userId) {
	const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	const wsUrl = `${protocol}//${window.location.host}`;
	
	console.log('WebSocket: подключаемся к', wsUrl);
	ws = new WebSocket(wsUrl);
	
	ws.onopen = () => {
		console.log('WebSocket: подключены');
		// Отправляем userId для идентификации
		ws.send(JSON.stringify({ type: 'auth', userId }));
	};
	
	ws.onmessage = (event) => {
		try {
			const msg = JSON.parse(event.data);
			console.log('WebSocket сообщение:', msg);
			
			if (msg.type === 'update') {
				if (msg.updateType === 'entryAdded') {
					// Новая запись добавлена другим устройством
					const newEntry = {
						id: msg.data.id,
						sex: msg.data.sex,
						height: msg.data.height,
						neck: msg.data.neck,
						waist: msg.data.waist,
						hip: msg.data.hip,
						bf: msg.data.bf,
						group: msg.data.group,
						timestamp: new Date(msg.data.timestamp).getTime()
					};
					history.push(newEntry);
					console.log('📊 Новая запись получена в реал-тайме:', newEntry);
					renderHistory();
					drawChart();
				} else if (msg.updateType === 'entryDeleted') {
					// Запись удалена другим устройством
					const idx = history.findIndex(e => e.id === msg.data.id);
					if (idx >= 0) {
						history.splice(idx, 1);
						console.log('🗑️ Запись удалена в реал-тайме. ID:', msg.data.id);
						renderHistory();
						drawChart();
					}
				} else if (msg.updateType === 'waterAdded' || msg.updateType === 'waterDeleted') {
					console.log('💧 Обновление воды в реал-тайме:', msg.updateType, msg.data);
					loadWaterLogs();
					loadWaterChartData(currentWaterChartPeriod || 'day');
				}
			}
		} catch (e) {
			console.error('WebSocket обработка сообщения:', e);
		}
	};
	
	ws.onerror = (err) => {
		console.error('WebSocket ошибка:', err);
	};
	
	ws.onclose = () => {
		console.log('WebSocket: отключены');
		// Попытаемся переподключиться через 3 сек
		setTimeout(() => {
			if (authenticated && userId) {
				connectWebSocket(userId);
			}
		}, 3000);
	};
}


async function loadUserData() {
	try {
		const user = await apiCall('/api/me');
		currentUser = user.username;
		userId = user.id;
		authenticated = true;
		
		// Устанавливаем пол пользователя с сервера
		sexState.current = user.gender || 'male';
		hipWrap.style.display = sexState.current === 'female' ? 'block' : 'none';
		
		// Проверяем права администратора и показываем/скрываем кнопку админ-панели
		const adminPanelBtn = document.getElementById('adminPanelBtn');
		if (adminPanelBtn) {
			adminPanelBtn.style.display = user.isAdmin ? 'block' : 'none';
		}
		
		const entries = await apiCall('/api/history');
		console.log('✓ Загруженные данные с сервера:', entries);
		history = entries.map(e => ({
			id: e.id,
			sex: e.sex,
			height: e.height,
			neck: e.neck,
			waist: e.waist,
			hip: e.hip,
			bf: e.bf,
			group: e.group,
			timestamp: new Date(e.timestamp).getTime()
		}));
		console.log('✓ Обработанная история:', history);
		saveCache(CACHE_KEYS.user, { id: userId, username: currentUser });
		saveCache(CACHE_KEYS.history, history);
		
		// Подключаемся к WebSocket для реал-тайма
		connectWebSocket(userId);
		
		return true;
	} catch (err) {
		console.error('✗ Ошибка loadUserData:', err);
		// Fallback to cached user/history if offline
		const cachedUser = loadCache(CACHE_KEYS.user);
		const cachedHistory = loadCache(CACHE_KEYS.history, []);
		if (!navigator.onLine && cachedUser) {
			console.warn('Используем оффлайн-кэш пользователя и истории');
			currentUser = cachedUser.username;
			userId = cachedUser.id || null;
			authenticated = true;
			history = cachedHistory;
			return true;
		}
		const warnEl = document.getElementById('authStatus');
		if (warnEl) {
			warnEl.textContent = '⚠️ Не удалось обновить данные. Повтори позже.';
			warnEl.classList.add('status-warn');
		}
		authenticated = false;
		currentUser = null;
		userId = null;
		return false;
	}
}

// ===== DOM ЭЛЕМЕНТЫ =====
const authModal = document.getElementById('authModal');
const openAuthModal = document.getElementById('openAuthModal');
const closeAuthModal = document.getElementById('closeAuthModal');
const installPromptTrigger = document.getElementById('installPromptTrigger');

// Новые модали
const accountModal = document.getElementById('accountModal');
const closeAccountModal = document.getElementById('closeAccountModal');
const userAccountBtn = document.getElementById('userAccountBtn');
const accountLogoutBtn = document.getElementById('accountLogoutBtn');

const settingsModal = document.getElementById('settingsModal');
const closeSettingsModal = document.getElementById('closeSettingsModal');
const settingsBtn = document.getElementById('settingsBtn');

const hipWrap = document.getElementById('hip-wrap');
const calcBtn = document.getElementById('calcBtn');
const clearBtn = document.getElementById('clearBtn');
const historyList = document.getElementById('history');
const historyCount = document.getElementById('history-count');
const currentResult = document.getElementById('current-result');
const currentNote = document.getElementById('current-note');
const chart = document.getElementById('chart');
const ctx = chart.getContext('2d');
const userSelect = document.getElementById('userSelect');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const authStatus = document.getElementById('authStatus');

// Регистрация элементы
const signupForm = document.getElementById('signupForm');
const signupUsernameInput = document.getElementById('signupUsername');
const signupEmailInput = document.getElementById('signupEmail');
const signupPasswordInput = document.getElementById('signupPassword');
const signupBtn = document.getElementById('signupBtn');
const toggleSignupBtn = document.getElementById('toggleSignup');
const backToLoginBtn = document.getElementById('backToLogin');
const cardLayoutToggle = document.getElementById('cardLayoutToggle');

// Применяем сохранённую раскладку карточек сразу при загрузке скрипта
applyCardLayout(getStoredCardLayout());

let viewW = 0;
let viewH = 0;
const maxPoints = 24;
const chartHeight = 320;

// ===== ФУНКЦИИ ДЛЯ МОДАЛЕЙ =====
const MODAL_ANIM_MS = 240;

function openModal() {
	authModal.classList.remove('closing');
	authModal.classList.add('active');
	document.body.style.overflow = 'hidden';
	// Очищаем ошибки при открытии модалки
	const authStatus = document.getElementById('authStatus');
	if (authStatus) {
		authStatus.textContent = 'Твои данные защищены и хранятся на сервере.';
		authStatus.classList.remove('status-warn');
	}
}

function closeModal() {
	// Добавляем класс closing для плавного исчезновения
	authModal.classList.add('closing');
	setTimeout(() => {
		authModal.classList.remove('active');
		authModal.classList.remove('closing');
		document.body.style.overflow = '';
	}, MODAL_ANIM_MS);
}

openAuthModal?.addEventListener('click', openModal);
closeAuthModal?.addEventListener('click', closeModal);
installPromptTrigger?.addEventListener('click', showInstallPrompt);

// Отслеживаем, был ли mousedown на самом overlay (не на содержимом)
let authModalMouseDownTarget = null;
authModal?.addEventListener('mousedown', (e) => {
	authModalMouseDownTarget = e.target;
});
authModal?.addEventListener('click', (e) => {
	if (e.target === authModal && authModalMouseDownTarget === authModal) closeModal();
});

// Обработчики для модали записи
document.getElementById('closeEntryModal')?.addEventListener('click', closeEntryModal);

// Отслеживаем mousedown для модали записи
let entryModalMouseDownTarget = null;
document.getElementById('entryDetailModal')?.addEventListener('mousedown', (e) => {
	entryModalMouseDownTarget = e.target;
});
document.getElementById('entryDetailModal')?.addEventListener('click', (e) => {
	if (e.target === document.getElementById('entryDetailModal') && entryModalMouseDownTarget === document.getElementById('entryDetailModal')) closeEntryModal();
});

// ===== ФУНКЦИИ ЛОГИКИ =====
function updateUserBadge() {
	try {
		const loginForm = document.getElementById('loginForm');
		const modalTitle = document.getElementById('modalTitle');
		const landingPage = document.getElementById('landingPage');
		const appContent = document.getElementById('appContent');
		const mainHeader = document.getElementById('mainHeader');
		const userAccountBtn = document.getElementById('userAccountBtn');
		const settingsBtn = document.getElementById('settingsBtn');
		const logoutBtn = document.getElementById('logoutBtn');
		const openAuthModal = document.getElementById('openAuthModal');
		const accountDisplayName = document.getElementById('accountDisplayName');
		const adminPanelBtn = document.getElementById('adminPanelBtn');
		
		console.log('updateUserBadge: authenticated=', authenticated, 'currentUser=', currentUser);
		
		if (authenticated && currentUser) {
			// Скрываем landing page, показываем приложение
			landingPage.style.display = 'none';
			appContent.style.display = 'block';
			mainHeader.style.display = 'flex';
			
			// Показываем кнопки аккаунта и настроек
		userAccountBtn.textContent = '👤 ' + currentUser;
		userAccountBtn.style.display = 'inline-flex';
		settingsBtn.style.display = 'inline-flex';
		logoutBtn.style.display = 'inline-flex';
		openAuthModal.style.display = 'none';
		
		// Обновляем имя в модале аккаунта
		if (accountDisplayName) {
			accountDisplayName.textContent = currentUser;
		}
		
		// Устанавливаем текущий пол в селекторе
		const accountGenderSelect = document.getElementById('accountGender');
		if (accountGenderSelect) {
			accountGenderSelect.value = sexState.current || 'male';
		}
		
		// Показываем админ-панель если пользователь админ
			if (adminPanelBtn && currentUserData?.is_admin) {
				adminPanelBtn.style.display = '';
			} else if (adminPanelBtn) {
				adminPanelBtn.style.display = 'none';
			}
			
			loginBtn.style.display = 'none';
			toggleSignupBtn.style.display = 'none';
		} else {
			// Показываем landing page, скрываем приложение
			landingPage.style.display = 'block';
			appContent.style.display = 'none';
			mainHeader.style.display = 'none';
			
			userAccountBtn.style.display = 'none';
			settingsBtn.style.display = 'none';
			logoutBtn.style.display = 'none';
			openAuthModal.style.display = '';
			loginForm.style.display = 'block';
			signupForm.style.display = 'none';
			loginBtn.style.display = '';
			toggleSignupBtn.style.display = '';
		}
	} catch (err) {
		console.error('❌ Ошибка в updateUserBadge:', err);
	}


function calcBodyFat(sex, height, neck, waist, hip) {
	if (sex === 'male') {
		return 86.010 * Math.log10(waist - neck) - 70.041 * Math.log10(height) + 36.76;
	}
	return 163.205 * Math.log10(waist + hip - neck) - 97.684 * Math.log10(height) - 78.387;
}

function classify(bf, sex) {
	const ranges = sex === 'male'
		? [ { max: 6, label: 'Соревновательный', tone: 'sharp' },
				{ max: 13, label: 'Атлет', tone: 'good' },
				{ max: 17, label: 'Фитнес', tone: 'good' },
				{ max: 24, label: 'Норма', tone: 'ok' },
				{ max: 100, label: 'Высокий', tone: 'warn' } ]
		: [ { max: 14, label: 'Соревновательный', tone: 'sharp' },
				{ max: 20, label: 'Атлет', tone: 'good' },
				{ max: 24, label: 'Фитнес', tone: 'good' },
				{ max: 31, label: 'Норма', tone: 'ok' },
				{ max: 100, label: 'Высокий', tone: 'warn' } ];
	return ranges.find(r => bf <= r.max);
}
// ===== АВТОРИЗАЦИЯ =====
async function handleSignup() {
	const username = signupUsernameInput.value.trim();
	const email = signupEmailInput.value.trim();
	const password = signupPasswordInput.value.trim();
	const gender = document.getElementById('signupGender').value;
	console.log('📝 handleSignup: gender value:', gender, 'type:', typeof gender);
	const status = document.getElementById('signupStatus');
	
	if (!username) {
		status.textContent = '❌ Логин обязателен';
		status.style.color = '#ef4444';
		return;
	}
	
	if (username.length < 3) {
		status.textContent = '❌ Логин должен быть минимум 3 символа';
		status.style.color = '#ef4444';
		return;
	}
	
	if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
		status.textContent = '❌ Логин может содержать только латиницу, цифры, подчеркивание и дефис';
		status.style.color = '#ef4444';
		return;
	}
	
	if (!password) {
		status.textContent = '❌ Пароль обязателен';
		status.style.color = '#ef4444';
		return;
	}
	
	if (password.length < 8) {
		status.textContent = '❌ Пароль должен быть минимум 8 символов';
		status.style.color = '#ef4444';
		return;
	}
	
	const digitCount = (password.match(/\d/g) || []).length;
	if (digitCount < 2) {
		status.textContent = '❌ Пароль должен содержать минимум 2 цифры';
		status.style.color = '#ef4444';
		return;
	}
	
	if (!gender) {
		status.textContent = '❌ Пожалуйста, укажи свой пол';
		status.style.color = '#ef4444';
		return;
	}
	
	try {
		status.textContent = '⏳ Создаю аккаунт...';
		status.style.color = '#a5b4fc';
		
		const result = await apiCall('/api/signup', {
			method: 'POST',
			body: JSON.stringify({ username, email: email || null, password, gender })
		});
		
		// Даём браузеру время обработать cookies
		await new Promise(resolve => setTimeout(resolve, 300));
		
		// Загружаем данные пользователя
		const loaded = await loadUserData();
		if (!loaded) {
			status.textContent = '❌ Ошибка загрузки данных';
			status.style.color = '#ef4444';
			return;
		}

		await loadUserSettings();
		
		status.textContent = '✓ Аккаунт создан! Добро пожаловать!';
		status.style.color = '#86efac';
		
		// Сохраняем пароль в localStorage если нужно запомнить
		if (document.getElementById('rememberMeCheckbox')?.checked) {
			localStorage.setItem('rememberMe_username', username);
			localStorage.setItem('rememberMe_password', password);
		}
		
		signupUsernameInput.value = '';
		signupEmailInput.value = '';
		signupPasswordInput.value = '';
		document.getElementById('signupGender').value = 'male';
		
		updateUserBadge();
		renderHistory();
		drawChart();
		
		// Загружаем воду если пользователь авторизован
		await loadWaterSettings();
		await loadWaterLogs();
		
		// Закрываем модаль и форму signup, автоматически логиним
		setTimeout(() => {
			toggleSignupForm();
			closeModal();
		}, 1500);
	} catch (err) {
		status.textContent = '❌ ' + err.message;
		status.style.color = '#ef4444';
	}
}

async function autoLogin(username, password) {
	try {
		console.log('⏳ Проверяю данные...'); 
		
		const result = await apiCall('/api/login', {
			method: 'POST',
			body: JSON.stringify({ username, password })
		});
		
		// Даём браузеру время обработать cookies
		await new Promise(resolve => setTimeout(resolve, 200));
		
		// Загружаем данные пользователя
		const loaded = await loadUserData();
		if (!loaded) {
			console.error('❌ Ошибка загрузки данных');
			return false;
		}
		await loadUserSettings();
		
		console.log('✓ Автоматический вход успешен:', currentUser);
		updateUserBadge();
		return true;
	} catch (err) {
		console.error('❌ Ошибка автоматического входа:', err.message);
		// Удаляем неверные сохраненные данные
		localStorage.removeItem('rememberMe_username');
		localStorage.removeItem('rememberMe_password');
		return false;
	}
}

async function handleLogin() {
	const username = userSelect.value.trim();
	const password = passwordInput.value.trim();
	const rememberMe = document.getElementById('rememberMeCheckbox')?.checked || false;
	
	if (!username || !password) {
		authStatus.textContent = '❌ Заполни username и пароль';
		authStatus.classList.add('status-warn');
		return;
	}
	
	try {
		authStatus.textContent = '⏳ Проверяю данные...';
		authStatus.classList.remove('status-warn');
		
		const result = await apiCall('/api/login', {
			method: 'POST',
			body: JSON.stringify({ username, password })
		});
		
		// Сохраняем логин и пароль если выбран "Запомнить меня"
		if (rememberMe) {
			localStorage.setItem('rememberMe_username', username);
			localStorage.setItem('rememberMe_password', password);
		} else {
			localStorage.removeItem('rememberMe_username');
			localStorage.removeItem('rememberMe_password');
		}
		
		// Даём браузеру время обработать cookies
		await new Promise(resolve => setTimeout(resolve, 200));
		
		// Загружаем данные пользователя
		const loaded = await loadUserData();
		if (!loaded) {
			authStatus.textContent = '❌ Ошибка загрузки данных';
			authStatus.classList.add('status-warn');
			return;
		}

		await loadUserSettings();
		
		authStatus.textContent = '✓ Привет, ' + currentUser + '! Твои данные загружены.';
		authStatus.classList.remove('status-warn');
		passwordInput.value = '';
		updateUserBadge();
		
		// Даём браузеру время на перерендер DOM перед инициализацией canvas
		await new Promise(resolve => setTimeout(resolve, 100));
		
		// Инициализируем canvas размеры перед отрисовкой
		initCanvasSize();
		
		// Рендерим все элементы
		renderHistory();
		drawChart();
		
		// Загружаем настройки воды и логи
		await loadWaterSettings();
		await loadWaterLogs();
		
		// Запускаем периодическую синхронизацию настроек карточек
		if (!window.cardSyncInterval) {
			window.cardSyncInterval = setInterval(syncCardSettingsFromServer, 1500);
		}
		
		// Закрываем модаль после успешного входа
		setTimeout(() => {
			closeModal();
			// После закрытия модали пересчитываем размеры
			setTimeout(() => {
				initCanvasSize();
				drawChart();
			}, 200);
		}, 500);
	} catch (err) {
		authStatus.textContent = '❌ ' + err.message;
		authStatus.classList.add('status-warn');
		updateUserBadge();
	}
}

async function handleLogout() {
	try {
		// Закрываем WebSocket перед выходом
		if (ws) {
			ws.close();
			ws = null;
		}
		
		// Удаляем сохраненные данные входа
		localStorage.removeItem('rememberMe_username');
		localStorage.removeItem('rememberMe_password');
		document.getElementById('rememberMeCheckbox').checked = false;
		
		await apiCall('/api/logout', { method: 'POST' });
		authenticated = false;
		currentUser = null;
		userId = null;
		history = [];
		waterLogs = [];
		userSettings.card_visibility = defaultCardVisibility();
		userSelect.value = '';
		passwordInput.value = '';
		authStatus.textContent = 'До свидания! Ты вышел.';
		authStatus.classList.add('status-warn');
		updateUserBadge();
		renderHistory();
		drawChart();
		applyCardVisibility();
		syncCardVisibilityUI();
	// Убираем сообщение через 0.5 секунды с плавным исчезновением
	setTimeout(() => {
		authStatus.classList.add('status-fade-out');
		setTimeout(() => {
			authStatus.textContent = '';
			authStatus.classList.remove('status-warn', 'status-fade-out');
		}, 300);
	}, 200);

	// Закрываем модалку через 1 секунду после выхода
	setTimeout(closeModal, 1000);
	} catch (err) {
		authStatus.textContent = '❌ Ошибка выхода';
		authStatus.classList.add('status-warn');
	}
}

async function handleDeleteAccount() {
	// Запрашиваем подтверждение
	const confirmDelete = confirm('Ты уверен? Это действие невозможно отменить. Все твои данные будут удалены.');
	if (!confirmDelete) return;
	
	// Второе подтверждение для безопасности
	const confirmSecond = prompt('Введи название аккаунта чтобы подтвердить удаление:');
	if (confirmSecond !== currentUser) {
		alert('❌ Неверное название аккаунта');
		return;
	}
	
	try {
		const authStatus = document.getElementById('authStatus');
		authStatus.textContent = '⏳ Удаляю аккаунт...';
		authStatus.classList.remove('status-warn');
		
		// Закрываем WebSocket перед удалением
		if (ws) {
			ws.close();
			ws = null;
		}
		
		// Удаляем аккаунт на сервере
		await apiCall('/api/delete-account', { method: 'POST' });
		
		// Очищаем localStorage
		localStorage.removeItem('rememberMe_username');
		localStorage.removeItem('rememberMe_password');
		
		// Обнуляем данные
		authenticated = false;
		currentUser = null;
		userId = null;
		history = [];
		waterLogs = [];
		userSettings.card_visibility = defaultCardVisibility();
		userSelect.value = '';
		passwordInput.value = '';
		
		authStatus.textContent = '✓ Аккаунт удален. До встречи!';
		authStatus.classList.add('status-warn');
		updateUserBadge();
		renderHistory();
		drawChart();
		applyCardVisibility();
		syncCardVisibilityUI();
		
		// Закрываем модалку через 1.5 секунды
		setTimeout(() => {
			closeModal();
		}, 1500);
	} catch (err) {
		const authStatus = document.getElementById('authStatus');
		authStatus.textContent = '❌ Ошибка удаления: ' + err.message;
		authStatus.classList.add('status-warn');
	}
}

function toggleSignupForm() {
	const loginForm = document.getElementById('loginForm');
	const isSignupShown = signupForm.style.display === 'block';
	
	signupForm.style.display = isSignupShown ? 'none' : 'block';
	loginForm.style.display = isSignupShown ? 'block' : 'none';
	
	// Показываем/скрываем правильные кнопки
	if (!isSignupShown) {
		// Переходим на форму регистрации
		loginBtn.style.display = 'none';
		toggleSignupBtn.style.display = 'none';
		signupBtn.style.display = '';
		backToLoginBtn.style.display = 'block';
	} else {
		// Возвращаемся на форму входа
		loginBtn.style.display = '';
		toggleSignupBtn.style.display = 'block';
		signupBtn.style.display = 'none';
		backToLoginBtn.style.display = 'none';
	}
}

// ===== ФУНКЦИИ ДЛЯ МОДАЛИ ЗАПИСИ =====
function getBodyFatAssessment(bf, sex) {
	// Возрастная граница (в реальном приложении можно добавить поле возраста)
	const age = 30; // Условный возраст для оценки
	
	if (sex === 'male') {
		if (bf < 6) return { category: '🏆 Очень низко', color: '#ff6b6b', status: 'ВНИМАНИЕ' };
		if (bf < 13) return { category: '💪 Спортивное', color: '#51cf66', status: 'Отлично' };
		if (bf < 18) return { category: '✅ Норма', color: '#74c0fc', status: 'Здорово' };
		if (bf < 25) return { category: '⚠️ Повышенно', color: '#ffd93d', status: 'Нужно работать' };
		return { category: '🚨 Высоко', color: '#ff8787', status: 'Требует действий' };
	} else {
		if (bf < 13) return { category: '🏆 Очень низко', color: '#ff6b6b', status: 'ВНИМАНИЕ' };
		if (bf < 20) return { category: '💪 Спортивное', color: '#51cf66', status: 'Отлично' };
		if (bf < 26) return { category: '✅ Норма', color: '#74c0fc', status: 'Здорово' };
		if (bf < 32) return { category: '⚠️ Повышенно', color: '#ffd93d', status: 'Нужно работать' };
		return { category: '🚨 Высоко', color: '#ff8787', status: 'Требует действий' };
	}
}

function getRecommendations(bf, sex) {
	const assessment = getBodyFatAssessment(bf, sex);
	let tips = [];
	
	if (assessment.status === 'ВНИМАНИЕ') {
		tips = [
			'⚠️ Процент жира критически низкий!',
			'🍎 Увеличь калорийность питания',
			'🥗 Добавь больше углеводов и жиров',
			'😴 Достаточно отдыхай и спи 8+ часов',
			'💪 Уменьши интенсивность тренировок'
		];
	} else if (assessment.status === 'Отлично') {
		tips = [
			'🎯 Ты на спортивном уровне!',
			'🏋️ Продолжай регулярные тренировки',
			'🥗 Поддерживай сбалансированное питание',
			'📊 Отслеживай изменения еженедельно',
			'⭐ Поздравляем с отличной формой!'
		];
	} else if (assessment.status === 'Здорово') {
		tips = [
			'✅ Процент жира в норме',
			'🏃 Поддерживай регулярные тренировки',
			'🥗 Ешь достаточно белка (1.6-2.0г на кг веса)',
			'💧 Пей достаточно воды (2-3л в день)',
			'🛏️ Спи 7-9 часов каждую ночь'
		];
	} else if (assessment.status === 'Нужно работать') {
		tips = [
			'🎯 Немного жира выше нормы',
			'💪 Добавь кардио 3-4 раза в неделю',
			'🥗 Уменьши калории на 300-500 ккал в день',
			'🚶 Больше гуляй и двигайся в течение дня',
			'📉 Ожидай снижения на 0.5-1% в месяц'
		];
	} else {
		tips = [
			'🚨 Жир существенно выше нормы',
			'⏱️ Начни с 30-40 мин кардио 4-5 раз в неделю',
			'🥗 Уменьши калории на 500 ккал, ешь белок',
			'📊 Отслеживай прогресс еженедельно',
			'🎯 Реалистичная цель: 0.5-1кг жира в месяц'
		];
	}
	
	return tips;
}

function renderEntryDetailContent(entry) {
		const assessment = getBodyFatAssessment(entry.bf, entry.sex);
		const recommendations = getRecommendations(entry.bf, entry.sex);
		const date = formatLocalDateTime(entry.timestamp, {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});

	return `
		<div style="display:flex; justify-content: space-between; align-items:center; gap:12px; flex-wrap: wrap;">
			<div class="meta">${date}</div>
		</div>
		<div class="headline">
			<div class="value" style="color:${assessment.color};">${entry.bf.toFixed(1)}%</div>
			<div>
				<div style="font-size:14px; font-weight:600; color:${assessment.color};">${assessment.category}</div>
				<div class="status">${assessment.status}</div>
			</div>
		</div>

		<div style="background: rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.2); border-radius:12px; padding:16px; margin-bottom:16px;">
			<h3>📋 Твои измерения</h3>
			<div class="grid">
				<div><div class="chip">Пол</div><div class="chip-value">${entry.sex === 'male' ? 'Мужчина' : 'Женщина'}</div></div>
				<div><div class="chip">Рост</div><div class="chip-value">${entry.height} см</div></div>
				<div><div class="chip">Обхват шеи</div><div class="chip-value">${entry.neck} см</div></div>
				<div><div class="chip">Обхват талии</div><div class="chip-value">${entry.waist} см</div></div>
				${entry.sex === 'female' ? `<div><div class="chip">Обхват бёдер</div><div class="chip-value">${entry.hip} см</div></div>` : ''}
			</div>
		</div>

		<div style="background: rgba(76,175,80,0.08); border:1px solid rgba(76,175,80,0.2); border-radius:12px; padding:16px;">
			<h3 style="color:#81c784;">💡 Рекомендации</h3>
			<div class="tips">
				${recommendations.map(tip => `<div class="tip">${tip}</div>`).join('')}
			</div>
		</div>
	`;
}

function closeAllEntryDetails() {
	document.querySelectorAll('.entry-detail-inline').forEach(panel => {
		panel.style.display = 'none';
	});
	document.querySelectorAll('.toggle-detail').forEach(btn => {
		btn.textContent = '▼';
		btn.setAttribute('aria-expanded', 'false');
	});
}

function showEntryDetail(entry, detailPanel, toggleBtn) {
	try {
		const isOpen = detailPanel.style.display === 'block';
		closeAllEntryDetails();
		if (!isOpen) {
			detailPanel.innerHTML = renderEntryDetailContent(entry);
			detailPanel.style.display = 'block';
			toggleBtn.textContent = '▲';
			toggleBtn.setAttribute('aria-expanded', 'true');
			// плавный скролл к раскрытой записи
			detailPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	} catch (err) {
		console.error('❌ Ошибка в showEntryDetail:', err);
	}
}

function closeEntryModal() {
	closeAllEntryDetails();
}

// ===== ФУНКЦИИ ДЛЯ ОТСЛЕЖИВАНИЯ ВОДЫ =====
function calculateDailyWaterGoal(weight, activity) {
	let baseGoal = weight * 30; // 30мл на 1кг веса
	
	if (activity === 'low') baseGoal *= 0.9;
	else if (activity === 'moderate') baseGoal *= 1;
	else if (activity === 'high') baseGoal *= 1.3;
	
	return Math.round(baseGoal); // Без округления, точный расчет
}

async function loadWaterSettings() {
	try {
		const settings = await apiCall('/api/water-settings');
		waterSettings = settings;
		console.log('✓ Загружены настройки воды:', waterSettings);
		saveCache(CACHE_KEYS.waterSettings, waterSettings);
		
		// Показываем секцию воды только если вес установлен
		const waterSection = document.getElementById('waterSection');
		if (waterSettings.weight && waterSettings.weight > 0) {
			waterSection.style.display = 'block';
			renderWaterQuickButtons();
		} else {
			waterSection.style.display = 'none';
		}
	} catch (err) {
		console.error('✗ Ошибка загрузки настроек воды:', err);
		const cached = loadCache(CACHE_KEYS.waterSettings);
		if (!navigator.onLine && cached) {
			waterSettings = cached;
			renderWaterQuickButtons();
			const waterSection = document.getElementById('waterSection');
			if (waterSettings.weight && waterSettings.weight > 0) waterSection.style.display = 'block';
		}
	}
}

async function loadWaterLogs() {
	try {
		const logs = await apiCall('/api/water-logs');
		waterLogs = logs;
		console.log('✓ Загружены логи воды:', waterLogs);
		saveCache(CACHE_KEYS.waterLogs, waterLogs);
		renderWaterProgress();
		renderWaterLogs();
	} catch (err) {
		console.error('✗ Ошибка загрузки логов воды:', err);
		const cached = loadCache(CACHE_KEYS.waterLogs, []);
		if (!navigator.onLine && cached.length) {
			waterLogs = cached;
			renderWaterProgress();
			renderWaterLogs();
		}
	}
}

async function loadWaterChartData(period = 'day') {
	try {
		const logs = await apiCall(`/api/water-logs/period?period=${period}`);
		waterChartData = logs.slice().reverse(); // в хронологическом порядке
		currentWaterChartPeriod = period;
		console.log('✓ Загружены данные для графика воды:', waterChartData);
		renderWaterChart();
	} catch (err) {
		console.error('✗ Ошибка загрузки данных для графика воды:', err);
		const cached = loadCache(CACHE_KEYS.waterLogs, []);
		if (!navigator.onLine && cached.length) {
			waterChartData = cached.slice().reverse();
			currentWaterChartPeriod = period;
			renderWaterChart();
		}
	}
}

function renderWaterQuickButtons() {
	const container = document.getElementById('waterQuickButtons');
	if (!container) return;
	
	container.innerHTML = '';
	
	if (!waterSettings.quick_buttons || waterSettings.quick_buttons.length === 0) {
		container.innerHTML = '<p class="muted" style="grid-column: 1/-1; text-align: center; font-size: 12px;">Добавь кнопки в настройках</p>';
		return;
	}
	
	waterSettings.quick_buttons.forEach(btn => {
		const button = document.createElement('button');
		button.className = 'water-quick-btn';
		const parts = btn.name.split(' ');
		const emoji = parts[0];
		const label = parts[1]; // Только название, без количества
		button.innerHTML = `
			<div style="font-size: 16px; margin-bottom: 4px;">${emoji}</div>
			<div style="font-size: 13px; color: var(--text); font-weight: 600;">${label}</div>
			<div style="font-size: 11px; color: var(--text-muted);">${btn.amount}мл</div>
		`;
		button.addEventListener('click', () => addWaterLog(btn.amount, label));
		container.appendChild(button);
	});
}

function renderWaterProgress() {
	const boundary = getLastWaterResetBoundary(waterSettings.reset_time);
	const totalToday = waterLogs
		.filter(log => normalizeTimestamp(log.logged_at) >= boundary)
		.reduce((sum, log) => sum + log.amount, 0);
	const goal = waterSettings.daily_goal || 2000;
	const percentage = Math.min((totalToday / goal) * 100, 100);
	
	document.getElementById('waterProgress').textContent = `${totalToday} / ${goal} мл`;
	document.getElementById('waterBarFill').style.width = percentage + '%';
	
	// Цвет шкалы в зависимости от процента
	const barFill = document.getElementById('waterBarFill');
	if (percentage < 50) {
		barFill.style.background = 'linear-gradient(90deg, #5dade2, #74c0fc)';
	} else if (percentage < 100) {
		barFill.style.background = 'linear-gradient(90deg, #51cf66, #82c91e)';
	} else {
		barFill.style.background = 'linear-gradient(90deg, #51cf66, #37b24d)';
	}
}

function renderWaterLogs() {
	const container = document.getElementById('waterLogsList');
	if (!container) return;
	
	if (waterLogs.length === 0) {
		container.innerHTML = '<p class="muted" style="font-size: 12px;">Добавляй воду и напитки</p>';
		return;
	}
	
	container.innerHTML = '';

	const boundary = getLastWaterResetBoundary(waterSettings.reset_time);

	// Сортируем от новых к старым (учитываем нормализацию таймзоны) и фильтруем по границе дня
	const sorted = [...waterLogs]
		.sort((a, b) => normalizeTimestamp(b.logged_at) - normalizeTimestamp(a.logged_at))
		.filter(log => normalizeTimestamp(log.logged_at) >= boundary);

	sorted.forEach(log => {
		const time = formatLocalDateTime(normalizeTimestamp(log.logged_at), { hour: '2-digit', minute: '2-digit' });
		const logEl = document.createElement('div');
		logEl.className = 'water-log-item';
		logEl.innerHTML = `
			<div>
				<strong>${log.amount}мл</strong> ${log.drink_type}
				<div style="font-size: 11px; color: var(--text-muted);">${time}</div>
			</div>
			<button style="background: none; border: none; color: #ff8787; cursor: pointer; font-size: 14px;">×</button>
		`;
		logEl.querySelector('button').addEventListener('click', () => deleteWaterLog(log.id));
		container.appendChild(logEl);
	});
}

async function addWaterLog(amount, drinkType = 'вода') {
	try {
		await apiCall('/api/water-logs', {
			method: 'POST',
			body: JSON.stringify({ amount, drink_type: drinkType })
		});
		
		// Обновляем локальный список
		await loadWaterLogs();
		
		// Вибрация при успешном добавлении
		try {
			if ('vibrate' in navigator) {
				navigator.vibrate(100);
				console.log('✓ Вибрация выполнена');
			} else if ('webkitVibrate' in navigator) {
				navigator.webkitVibrate(100);
				console.log('✓ WebKit вибрация выполнена');
			} else {
				console.log('❌ Vibration API не поддерживается');
			}
		} catch (e) {
			console.log('❌ Ошибка вибрации:', e);
		}
		
		// Показываем короткое уведомление
		showWaterNotification(`✅ Добавлено ${amount}мл`);
	} catch (err) {
		console.error('✗ Ошибка добавления воды:', err);
		// Если оффлайн — добавляем локально и покажем, что уйдет в очередь
		if (!navigator.onLine) {
			const tempLog = {
				id: `temp-${Date.now()}`,
				amount,
				drink_type: drinkType,
				logged_at: new Date().toISOString()
			};
			waterLogs = [tempLog, ...waterLogs];
			renderWaterProgress();
			renderWaterLogs();
			showWaterNotification(`📴 Оффлайн: сохранено ${amount}мл, синхронизация при сети`);
			return;
		}
	}
}

async function deleteWaterLog(id) {
	try {
		await apiCall(`/api/water-logs/${id}`, { method: 'DELETE' });
		await loadWaterLogs();
		
		// Вибрация при удалении (две короткие)
		try {
			if ('vibrate' in navigator) {
				navigator.vibrate([50, 100, 50]);
				console.log('✓ Вибрация удаления выполнена');
			} else if ('webkitVibrate' in navigator) {
				navigator.webkitVibrate([50, 100, 50]);
				console.log('✓ WebKit вибрация удаления выполнена');
			} else {
				console.log('❌ Vibration API не поддерживается');
			}
		} catch (e) {
			console.log('❌ Ошибка вибрации:', e);
		}
		
		showWaterNotification('✅ Удалено');
	} catch (err) {
		console.error('✗ Ошибка удаления:', err);
	}
}

function showWaterNotification(message) {
	const notif = document.createElement('div');
	notif.className = 'water-notification';
	notif.textContent = message;
	document.body.appendChild(notif);
	
	setTimeout(() => {
		notif.classList.add('show');
	}, 10);
	
	setTimeout(() => {
		notif.classList.remove('show');
		setTimeout(() => notif.remove(), 300);
	}, 2000);
}

function renderWaterChart() {
	const chartSection = document.getElementById('waterChartSection');
	if (!chartSection) return;
	
	const canvas = document.getElementById('waterChart');
	if (!canvas) return;
	
	const series = buildWaterSeries(currentWaterChartPeriod, waterChartData, waterSettings.reset_time);
	const ctx = canvas.getContext('2d');
	const dpr = window.devicePixelRatio || 1;
	const rect = canvas.getBoundingClientRect();
	canvas.width = rect.width * dpr;
	canvas.height = 320 * dpr;
	canvas.style.width = '100%';
	canvas.style.height = '320px';
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.scale(dpr, dpr);

	ctx.clearRect(0, 0, canvas.width, canvas.height);

	const width = canvas.width / dpr;
	const height = canvas.height / dpr;
	const padding = 52;

	// Фон
	const bg = ctx.createLinearGradient(0, 0, 0, height);
	bg.addColorStop(0, '#0f172a');
	bg.addColorStop(1, '#0b1224');
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, width, height);

	if (series.length === 0) {
		ctx.fillStyle = '#9aa7bd';
		ctx.font = '16px "Space Grotesk", system-ui';
		ctx.fillText('Нет данных для отображения', 20, 40);
		return;
	}

	const maxAmount = Math.max(...series.map(p => p.amount), 1);
	const totalAmount = series.reduce((s, p) => s + p.amount, 0);
	const scaleY = (amount) => height - padding - (amount / maxAmount) * (height - padding * 2);
	const scaleX = (i) => padding + (i / Math.max(series.length - 1, 1)) * (width - padding * 2);

	// Сетка
	const ySteps = 5;
	ctx.strokeStyle = 'rgba(255,255,255,0.04)';
	ctx.lineWidth = 1;
	ctx.font = '11px "Space Grotesk", system-ui';
	ctx.fillStyle = '#a5b4fc';
	for (let i = 0; i <= ySteps; i++) {
		const yVal = (i / ySteps) * maxAmount;
		const y = scaleY(yVal);
		ctx.beginPath();
		ctx.moveTo(padding, y);
		ctx.lineTo(width - padding, y);
		ctx.stroke();
		ctx.fillText(Math.round(yVal) + ' мл', 12, y + 4);
	}

	// Подпись суммы за период
	ctx.fillStyle = '#e2e8f0';
	ctx.font = '13px "Space Grotesk", system-ui';
	ctx.fillText(`Всего за период: ${totalAmount} мл`, padding, padding - 14);

	// Линия и заливка
	const accent = '#34d399';
	const area = ctx.createLinearGradient(0, padding, 0, height - padding);
	area.addColorStop(0, 'rgba(52, 211, 153, 0.35)');
	area.addColorStop(1, 'rgba(52, 211, 153, 0.05)');

	ctx.beginPath();
	series.forEach((point, index) => {
		const x = scaleX(index);
		const y = scaleY(point.amount);
		if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
	});
	ctx.save();
	ctx.shadowColor = 'rgba(52, 211, 153, 0.35)';
	ctx.shadowBlur = 12;
	ctx.strokeStyle = accent;
	ctx.lineWidth = 3;
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	ctx.stroke();
	ctx.restore();

	ctx.lineTo(scaleX(series.length - 1), height - padding);
	ctx.lineTo(scaleX(0), height - padding);
	ctx.closePath();
	ctx.fillStyle = area;
	ctx.fill();

	// Точки и подписи
	series.forEach((point, index) => {
		const x = scaleX(index);
		const y = scaleY(point.amount);
		ctx.beginPath();
		ctx.fillStyle = '#22c55e';
		ctx.strokeStyle = '#ecfeff';
		ctx.lineWidth = 2;
		ctx.arc(x, y, 6.5, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();

		// подпись над точкой
		ctx.font = '12px "Space Grotesk", system-ui';
		ctx.fillStyle = '#e2e8f0';
		ctx.strokeStyle = 'rgba(0,0,0,0.35)';
		ctx.lineWidth = 3;
		ctx.strokeText(`${point.amount} мл`, x - 18, y - 10);
		ctx.fillText(`${point.amount} мл`, x - 18, y - 10);
	});

	// Подписи оси X
	ctx.fillStyle = '#cbd5e1';
	ctx.font = '11px "Space Grotesk", system-ui';
	const step = Math.max(1, Math.floor(series.length / 6));
	for (let i = 0; i < series.length; i += step) {
		const x = scaleX(i);
		ctx.fillText(series[i].label, x - 22, height - padding + 18);
	}
}

function openWaterSettingsModal() {
	const modal = document.getElementById('waterSettingsModal');
	const weightInput = document.getElementById('waterWeight');
	const activityInput = document.getElementById('waterActivity');
	const goalInput = document.getElementById('waterGoal');
	
	weightInput.value = waterSettings.weight || '';
	activityInput.value = waterSettings.activity || 'moderate';
	document.getElementById('waterResetTime').value = waterSettings.reset_time || '00:00';
	goalInput.value = waterSettings.daily_goal || '';
	
	// Функция для автоматического расчета нормы
	const updateGoal = () => {
		const weight = parseFloat(weightInput.value);
		const activity = activityInput.value;
		
		if (weight && weight > 0) {
			const calculated = calculateDailyWaterGoal(weight, activity);
			goalInput.value = calculated;
			goalInput.placeholder = `Рассчитано: ${calculated}мл`;
		} else {
			goalInput.value = '';
			goalInput.placeholder = 'Сначала введи вес';
		}
	};
	
	// При изменении веса или активности, пересчитываем норму
	weightInput.addEventListener('input', updateGoal);
	activityInput.addEventListener('change', updateGoal);
	
	// Если вес уже введен, показываем рассчитанное значение
	if (!goalInput.value) {
		updateGoal();
	}
	
	renderQuickButtonsList();
	
	modal.classList.add('active');
	document.body.style.overflow = 'hidden';
}

function closeWaterSettingsModal() {
	const modal = document.getElementById('waterSettingsModal');
	modal.classList.remove('active');
	document.body.style.overflow = '';
}

function renderQuickButtonsList() {
	const container = document.getElementById('quickButtonsList');
	if (!container) return;
	
	container.innerHTML = '';
	
	(waterSettings.quick_buttons || []).forEach((btn, idx) => {
		const div = document.createElement('div');
		div.style.cssText = 'display: flex; gap: 8px; align-items: center; padding: 8px; background: rgba(99, 102, 241, 0.08); border-radius: 8px;';
		div.innerHTML = `
			<input type="text" value="${btn.name}" placeholder="Название" style="flex: 1; padding: 6px 8px; border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 6px; background: rgba(99, 102, 241, 0.05); color: var(--text); font-size: 12px;" />
			<input type="number" value="${btn.amount}" placeholder="Мл" min="1" style="width: 60px; padding: 6px 8px; border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 6px; background: rgba(99, 102, 241, 0.05); color: var(--text); font-size: 12px;" />
			<button style="padding: 6px 10px; background: rgba(239, 68, 68, 0.2); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; cursor: pointer; font-weight: 600;">×</button>
		`;
		
		const nameInput = div.querySelector('input[type="text"]');
		const amountInput = div.querySelector('input[type="number"]');
		const deleteBtn = div.querySelector('button');
		
		deleteBtn.addEventListener('click', async () => {
			waterSettings.quick_buttons.splice(idx, 1);
			renderQuickButtonsList();
			await saveWaterSettings();
		});
		
		nameInput.addEventListener('change', async () => {
			waterSettings.quick_buttons[idx].name = nameInput.value;
			await saveWaterSettings();
		});
		
		amountInput.addEventListener('change', async () => {
			waterSettings.quick_buttons[idx].amount = parseInt(amountInput.value);
			await saveWaterSettings();
		});
		
		container.appendChild(div);
	});
}

// Toggle change-password form visibility inside the account modal
function toggleChangePasswordForm() {
	const changeForm = document.getElementById('changePasswordForm');
	const accountInfo = document.getElementById('accountInfo');
	const accountActions = document.getElementById('accountActions');
	if (!changeForm || !accountInfo || !accountActions) return;

	const isHidden = changeForm.style.display === 'none' || changeForm.style.display === '';
	changeForm.style.display = isHidden ? 'block' : 'none';
	accountInfo.style.display = isHidden ? 'none' : 'block';
	accountActions.style.display = isHidden ? 'none' : 'block';
}

// Handle password change inside account modal
async function handleChangePassword() {
	const currentPassword = document.getElementById('currentPassword')?.value.trim();
	const newPassword = document.getElementById('newPassword')?.value.trim();
	const confirmPassword = document.getElementById('confirmPassword')?.value.trim();
	const statusEl = document.getElementById('passwordChangeStatus');

	if (!statusEl) return;

	if (!currentPassword || !newPassword || !confirmPassword) {
		statusEl.textContent = '❌ Заполни все поля';
		statusEl.style.color = '#ef4444';
		return;
	}

	if (newPassword.length < 8) {
		statusEl.textContent = '❌ Пароль должен быть минимум 8 символов';
		statusEl.style.color = '#ef4444';
		return;
	}
	
	const digitCount = (newPassword.match(/\d/g) || []).length;
	if (digitCount < 2) {
		statusEl.textContent = '❌ Пароль должен содержать минимум 2 цифры';
		statusEl.style.color = '#ef4444';
		return;
	}

	if (newPassword !== confirmPassword) {
		statusEl.textContent = '❌ Пароли не совпадают';
		statusEl.style.color = '#ef4444';
		return;
	}

	try {
		statusEl.textContent = '⏳ Обновляю пароль...';
		statusEl.style.color = '#a5b4fc';

		await apiCall('/api/change-password', {
			method: 'POST',
			body: JSON.stringify({ currentPassword, newPassword })
		});

		statusEl.textContent = '✓ Пароль успешно изменён!';
		statusEl.style.color = '#86efac';

		setTimeout(() => {
			document.getElementById('currentPassword').value = '';
			document.getElementById('newPassword').value = '';
			document.getElementById('confirmPassword').value = '';
			toggleChangePasswordForm();
		}, 1500);
	} catch (err) {
		console.error('🔐 Ошибка смены пароля:', err);
		statusEl.textContent = '❌ ' + err.message;
		statusEl.style.color = '#ef4444';
	}
}

// Handle gender change in account settings
async function handleGenderChange() {
	const gender = document.getElementById('accountGender')?.value;
	const statusEl = document.getElementById('genderChangeStatus');

	if (!statusEl) return;

	if (!gender || (gender !== 'male' && gender !== 'female')) {
		statusEl.textContent = '❌ Выбери пол';
		statusEl.style.color = '#ef4444';
		return;
	}

	try {
		statusEl.textContent = '⏳ Сохраняю...';
		statusEl.style.color = '#a5b4fc';

		await apiCall('/api/change-gender', {
			method: 'POST',
			body: JSON.stringify({ gender })
		});

		// Обновляем пол в состоянии приложения
		sexState.current = gender;
		hipWrap.style.display = gender === 'female' ? 'block' : 'none';

		statusEl.textContent = '✓ Пол обновлён';
		statusEl.style.color = '#86efac';

		// Перезагружаем настройки воды (т.к. норма зависит от пола)
		await loadWaterSettings();
		
		setTimeout(() => {
			statusEl.textContent = '';
		}, 2000);
	} catch (err) {
		console.error('⚧️ Ошибка смены пола:', err);
		statusEl.textContent = '❌ ' + err.message;
		statusEl.style.color = '#ef4444';
	}
}

async function saveWaterSettings() {
	const weight = parseFloat(document.getElementById('waterWeight').value);
	const activity = document.getElementById('waterActivity').value;
	const resetTime = document.getElementById('waterResetTime').value;
	let dailyGoal = parseInt(document.getElementById('waterGoal').value);
	
	if (!weight || weight <= 0) {
		return;
	}
	
	// Если дневная норма не указана, рассчитываем
	if (!dailyGoal || dailyGoal <= 0) {
		dailyGoal = calculateDailyWaterGoal(weight, activity);
	}
	
	try {
		await apiCall('/api/water-settings', {
			method: 'POST',
			body: JSON.stringify({
				weight,
				activity,
				daily_goal: dailyGoal,
				reset_time: resetTime,
				quick_buttons: waterSettings.quick_buttons
			})
		});
		
		await loadWaterSettings();
		await loadWaterLogs();
	} catch (err) {
		console.error('✗ Ошибка сохранения:', err);
	}
}

async function autoSaveWaterSettings() {
	const weight = parseFloat(document.getElementById('waterWeight').value);
	const activity = document.getElementById('waterActivity').value;
	const resetTime = document.getElementById('waterResetTime').value;
	let dailyGoal = parseInt(document.getElementById('waterGoal').value);
	
	if (!weight || weight <= 0) {
		return;
	}
	
	// Если дневная норма не указана, рассчитываем
	if (!dailyGoal || dailyGoal <= 0) {
		dailyGoal = calculateDailyWaterGoal(weight, activity);
	}
	
	try {
		await apiCall('/api/water-settings', {
			method: 'POST',
			body: JSON.stringify({
				weight,
				activity,
				daily_goal: dailyGoal,
				reset_time: resetTime,
				quick_buttons: waterSettings.quick_buttons
			})
		});
		
		await loadWaterSettings();
		await loadWaterLogs();
	} catch (err) {
		console.error('✗ Ошибка автосохранения:', err);
	}
}

// ===== РАСЧЁТ И СОХРАНЕНИЕ =====
async function handleCalculate() {
	if (!authenticated || !currentUser) {
		currentResult.textContent = '—';
		currentNote.textContent = 'Нужно войти, чтобы сохранить результат';
		return;
	}

	const h = parseFloat(document.getElementById('height').value);
	const n = parseFloat(document.getElementById('neck').value);
	const w = parseFloat(document.getElementById('waist').value);
	const hip = parseFloat(document.getElementById('hip').value);

	if (!h || !n || !w || h <= 0 || n <= 0 || w <= 0 || (sexState.current === 'female' && (!hip || hip <= 0))) {
		currentResult.textContent = '—';
		currentNote.textContent = 'Заполни все поля корректно';
		return;
	}

	const bf = parseFloat(calcBodyFat(sexState.current, h, n, w, hip).toFixed(1));
	const group = classify(bf, sexState.current);
	currentResult.textContent = bf + ' %';
	currentNote.textContent = group ? group.label : '';

	try {
		const result = await apiCall('/api/history', {
			method: 'POST',
			body: JSON.stringify({
				sex: sexState.current,
				height: h,
				neck: n,
				waist: w,
				hip: sexState.current === 'female' ? hip : null,
				bf,
				group: group ? group.label : ''
			})
		});
		
		// Не добавляем локально, дождёмся уведомления от WebSocket
		// которое добавит запись и обновит интерфейс
		console.log('✓ Запись отправлена на сервер, ждём WebSocket обновления');
	} catch (err) {
		if (!navigator.onLine) {
			// Оффлайн: добавляем временную запись локально
			const temp = {
				id: `temp-${Date.now()}`,
				sex: sexState.current,
				height: h,
				neck: n,
				waist: w,
				hip: sexState.current === 'female' ? hip : null,
				bf,
				group: group ? group.label : '',
				timestamp: Date.now()
			};
			history.push(temp);
			renderHistory();
			drawChart();
			saveCache(CACHE_KEYS.history, history);
			currentNote.textContent = '📴 Оффлайн: запись сохранена локально, синхронизируется при сети';
		} else {
			currentNote.textContent = '❌ Ошибка сохранения: ' + err.message;
		}
	}
}

async function deleteEntry(id) {
	try {
		await apiCall(`/api/history/${id}`, { method: 'DELETE' });
		const idx = history.findIndex(e => e.id === id);
		if (idx >= 0) {
			history.splice(idx, 1);
		}
		renderHistory();
		drawChart();
		saveCache(CACHE_KEYS.history, history);
	} catch (err) {
		console.error('Ошибка удаления:', err);
		if (!navigator.onLine) {
			history = history.filter((item) => item.id !== id);
			renderHistory();
			drawChart();
			saveCache(CACHE_KEYS.history, history);
			alert('📴 Оффлайн: запись удалена локально, синхронизация при сети');
		} else {
			alert('Ошибка удаления: ' + err.message);
		}
	}
}

function renderHistory() {
	console.log('🎨 Рендерим историю. Authenticated:', authenticated, 'User:', currentUser, 'История:', history);
	if (!authenticated || !currentUser) {
		historyList.innerHTML = '<p class="muted">Войди, чтобы увидеть свой прогресс</p>';
		historyCount.textContent = '0 записей';
		return;
	}

	historyList.innerHTML = '';
	const sorted = [...history].sort((a, b) => b.timestamp - a.timestamp);
	historyCount.textContent = sorted.length + ' ' + plural(sorted.length, ['запись', 'записи', 'записей']);

	if (!sorted.length) {
		historyList.innerHTML = '<p class="muted">Пока ничего. Считай и сохраняй!</p>';
		return;
	}

	sorted.forEach(item => {
		const row = document.createElement('div');
		row.className = 'history-item';
		row.style.cursor = 'pointer';
		const dateStr = formatLocalDateTime(item.timestamp, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
		row.innerHTML = `
			<div style="display:flex; align-items:center; gap:10px; flex:1;">
				<div style="flex:1;">
					<strong>${item.bf}%</strong> <small>${item.group}</small><br />
					<small>${item.sex === 'male' ? '♂' : '♀'} ${item.height} см</small>
				</div>
				<button type="button" class="toggle-detail" aria-label="Показать детали" aria-expanded="false" style="background:none; border:1px solid rgba(255,255,255,0.12); color:var(--muted); padding:6px 10px; border-radius:10px; cursor:pointer;">▼</button>
			</div>
			<div style="text-align:right;">
				<small>${dateStr}</small>
				<button aria-label="Удалить" style="margin-top:6px; background:none; border:1px solid rgba(255,255,255,0.08); color:var(--muted); padding:6px 10px; border-radius:10px; cursor:pointer;">×</button>
			</div>`;

		const detailPanel = document.createElement('div');
		detailPanel.className = 'entry-detail-inline';
		detailPanel.style.display = 'none';

		// Клик по строке или стрелке раскрывает детали, кроме кнопки удаления
		const toggleBtn = row.querySelector('.toggle-detail');
		row.addEventListener('click', (e) => {
			const isDelete = e.target.tagName === 'BUTTON' && !e.target.classList.contains('toggle-detail');
			if (isDelete) return;
			console.log('🖱️ Клик на history-item, target:', e.target.tagName);
			showEntryDetail(item, detailPanel, toggleBtn);
		});

		// Кнопка удаления
		row.querySelector('button[aria-label="Удалить"]').addEventListener('click', (e) => {
			e.stopPropagation();
			deleteEntry(item.id);
		});

		historyList.appendChild(row);
		historyList.appendChild(detailPanel);
	});
}

function plural(n, forms) {
	const mod10 = n % 10;
	const mod100 = n % 100;
	if (mod10 === 1 && mod100 !== 11) return forms[0];
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
	return forms[2];
}

async function clearHistory() {
	if (!authenticated || !currentUser) {
		currentNote.textContent = 'Войди сначала, чтобы очистить историю';
		return;
	}
	
	if (!confirm('Вы уверены? Это действие необратимо.')) return;

	if (!navigator.onLine) {
		const now = Date.now();
		history.forEach((item, idx) => {
			offlineQueue.push({
				endpoint: `/api/history/${item.id}`,
				options: { method: 'DELETE' },
				timestamp: now + idx
			});
		});
		saveOfflineQueue();
		history = [];
		renderHistory();
		drawChart();
		saveCache(CACHE_KEYS.history, history);
		currentResult.textContent = '—';
		currentNote.textContent = '📴 Оффлайн: история очищена локально, синхронизируется при сети';
		return;
	}
	
	try {
		for (let i = history.length - 1; i >= 0; i--) {
			await apiCall(`/api/history/${history[i].id}`, { method: 'DELETE' });
		}
		history = [];
		renderHistory();
		drawChart();
		saveCache(CACHE_KEYS.history, history);
		currentResult.textContent = '—';
		currentNote.textContent = 'История очищена';
	} catch (err) {
		currentNote.textContent = '❌ Ошибка: ' + err.message;
	}
}

// ===== ГРАФИК =====
function resizeCanvas() {
	const dpr = window.devicePixelRatio || 1;
	const { width } = chart.getBoundingClientRect();
	chart.width = Math.max(320, Math.round(width * dpr));
	chart.height = Math.round(chartHeight * dpr);
	chart.style.width = '100%';
	chart.style.height = chartHeight + 'px';
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.scale(dpr, dpr);
	viewW = chart.width / dpr;
	viewH = chart.height / dpr;
}

function initCanvasSize() {
	resizeCanvas();
}

function drawChart() {
	const ordered = [...history].sort((a, b) => a.timestamp - b.timestamp);
	const entries = ordered.slice(Math.max(0, ordered.length - maxPoints));
	ctx.clearRect(0, 0, viewW, viewH);

	// Фон с мягким градиентом
	const bg = ctx.createLinearGradient(0, 0, 0, viewH);
	bg.addColorStop(0, '#0f172a');
	bg.addColorStop(1, '#0b1224');
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, viewW, viewH);

	if (!authenticated || !currentUser) {
		ctx.fillStyle = '#9aa7bd';
		ctx.font = '16px "SF Pro Display"';
		ctx.fillText('Войди, чтобы увидеть график прогресса', 20, 40);
		return;
	}

	if (entries.length < 2) {
		ctx.fillStyle = '#9aa7bd';
		ctx.font = '16px "SF Pro Display"';
		ctx.fillText('Добавь две записи, чтобы увидеть тренд', 20, 40);
		return;
	}

	const padding = 64;
	const ys = entries.map(e => e.bf);
	const minYRaw = Math.min(...ys);
	const maxYRaw = Math.max(...ys);
	const span = Math.max(4, maxYRaw - minYRaw);
	const padY = span * 0.22;
	const minY = Math.max(0, minYRaw - padY);
	const maxY = Math.min(60, maxYRaw + padY);

	const count = entries.length;
	const usableW = viewW - padding * 2;
	const stepX = count > 1 ? usableW / (count - 1) : 0;
	const scaleX = i => padding + i * stepX;
	const scaleY = v => viewH - padding - ((v - minY) / (maxY - minY || 1)) * (viewH - padding * 2);

	ctx.strokeStyle = 'rgba(255,255,255,0.08)';
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(padding, padding - 10);
	ctx.lineTo(padding, viewH - padding);
	ctx.lineTo(viewW - padding + 10, viewH - padding);
	ctx.stroke();

	const ySteps = 5;
	ctx.fillStyle = '#8f9bb2';
	ctx.font = '11px "SF Pro Display"';
	for (let i = 0; i <= ySteps; i++) {
		const yVal = minY + (i / ySteps) * (maxY - minY);
		const y = scaleY(yVal);
		ctx.strokeStyle = 'rgba(255,255,255,0.05)';
		ctx.beginPath();
		ctx.moveTo(padding, y);
		ctx.lineTo(viewW - padding, y);
		ctx.stroke();
		ctx.fillText(yVal.toFixed(0) + ' %', 14, y + 4);
	}

	const xStepShow = Math.max(1, Math.floor(count / 6));
	ctx.strokeStyle = 'rgba(255,255,255,0.04)';
	for (let i = 0; i < count; i += xStepShow) {
		const x = scaleX(i);
		ctx.beginPath();
		ctx.moveTo(x, padding);
		ctx.lineTo(x, viewH - padding + 6);
		ctx.stroke();
	}

	const accent = 'rgba(10, 132, 255, 0.9)';
	const area = ctx.createLinearGradient(0, padding, 0, viewH - padding);
	area.addColorStop(0, 'rgba(10,132,255,0.24)');
	area.addColorStop(1, 'rgba(10,132,255,0.05)');

	ctx.beginPath();
	entries.forEach((e, i) => {
		const x = scaleX(i);
		const y = scaleY(e.bf);
		if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
	});
	ctx.strokeStyle = accent;
	ctx.lineWidth = 3;
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	ctx.stroke();

	ctx.lineTo(scaleX(entries.length - 1), viewH - padding);
	ctx.lineTo(scaleX(0), viewH - padding);
	ctx.closePath();
	ctx.fillStyle = area;
	ctx.fill();

	entries.forEach((e, i) => {
		const x = scaleX(i);
		const y = scaleY(e.bf);
		const grad = ctx.createRadialGradient(x, y, 0, x, y, 14);
		grad.addColorStop(0, 'rgba(10,132,255,0.95)');
		grad.addColorStop(1, 'rgba(10,132,255,0.12)');
		ctx.fillStyle = grad;
		ctx.beginPath();
		const padding = 52;
		ctx.fill();
	});

	ctx.fillStyle = '#8f9bb2';
	ctx.font = '11px "SF Pro Display"';
	for (let i = 0; i < entries.length; i += xStepShow) {

		// Сетка
		const ySteps = 5;
		ctx.strokeStyle = 'rgba(255,255,255,0.04)';
		ctx.lineWidth = 1;
		ctx.font = '11px "Space Grotesk", "SF Pro Display", system-ui';
		ctx.fillStyle = '#a5b4fc';
		for (let i = 0; i <= ySteps; i++) {
			const yVal = minY + (i / ySteps) * (maxY - minY);
			const y = scaleY(yVal);
			ctx.beginPath();
			ctx.moveTo(padding, y);
			ctx.lineTo(viewW - padding, y);
			ctx.stroke();
			ctx.fillText(yVal.toFixed(0) + ' %', 12, y + 4);
		}

		const xStepShow = Math.max(1, Math.floor(count / 6));
		ctx.strokeStyle = 'rgba(255,255,255,0.03)';
		for (let i = 0; i < count; i += xStepShow) {
			const x = scaleX(i);
			ctx.beginPath();
			ctx.moveTo(x, padding);
			ctx.lineTo(x, viewH - padding + 8);
			ctx.stroke();
		}

		// Линия и заливка
		const accent = '#5ad7ff';
		const area = ctx.createLinearGradient(0, padding, 0, viewH - padding);
		area.addColorStop(0, 'rgba(90, 215, 255, 0.35)');
		area.addColorStop(1, 'rgba(90, 215, 255, 0.05)');

		ctx.beginPath();
		entries.forEach((e, i) => {
			const x = scaleX(i);
			const y = scaleY(e.bf);
			if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
		});
		ctx.save();
		ctx.shadowColor = 'rgba(90, 215, 255, 0.4)';
		ctx.shadowBlur = 14;
		ctx.strokeStyle = accent;
		ctx.lineWidth = 3;
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';
		ctx.stroke();
		ctx.restore();

		ctx.lineTo(scaleX(entries.length - 1), viewH - padding);
		ctx.lineTo(scaleX(0), viewH - padding);
		ctx.closePath();
		ctx.fillStyle = area;
		ctx.fill();

		// Точки
		entries.forEach((e, i) => {
			const x = scaleX(i);
			const y = scaleY(e.bf);
			ctx.beginPath();
			ctx.fillStyle = '#0ea5e9';
			ctx.strokeStyle = '#e0f2fe';
			ctx.lineWidth = 2;
			ctx.arc(x, y, 7, 0, Math.PI * 2);
			ctx.fill();
			ctx.stroke();
		});

		// Подписи по оси X
		ctx.fillStyle = '#cbd5e1';
		ctx.font = '11px "Space Grotesk", "SF Pro Display", system-ui';
		for (let i = 0; i < entries.length; i += xStepShow) {
			const x = scaleX(i);
			const label = formatLocalDateTime(entries[i].timestamp, { month: 'short', day: 'numeric' });
			ctx.fillText(label, x - 18, viewH - padding + 18);
		}

		// Последняя точка
		ctx.fillStyle = '#e2e8f0';
		ctx.font = '12px "Space Grotesk", "SF Pro Display", system-ui';
		const last = entries[entries.length - 1];
		ctx.fillText('Последнее: ' + last.bf + ' %', scaleX(entries.length - 1) - 36, scaleY(last.bf) - 14);
		accountInfo.style.display = 'block';
		accountActions.style.display = 'block';
	}
}

// ===== EVENT LISTENERS =====
calcBtn.addEventListener('click', handleCalculate);
clearBtn.addEventListener('click', clearHistory);
loginBtn.addEventListener('click', () => {
	handleLogin();
});
signupBtn?.addEventListener('click', handleSignup);
toggleSignupBtn?.addEventListener('click', toggleSignupForm);
backToLoginBtn?.addEventListener('click', toggleSignupForm);

// Real-time validation for signup username
document.getElementById('signupUsername')?.addEventListener('input', (e) => {
	const username = e.target.value.trim();
	const status = document.getElementById('signupStatus');
	
	if (!username) {
		status.textContent = '';
		status.style.color = '#ef4444';
		return;
	}
	
	if (username.length < 3) {
		status.textContent = '❌ Логин должен быть минимум 3 символа';
		status.style.color = '#ef4444';
		return;
	}
	
	if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
		status.textContent = '❌ Логин может содержать только латиницу, цифры, подчеркивание и дефис';
		status.style.color = '#ef4444';
		return;
	}
	
	// Clear error if validation passes
	status.textContent = '';
});

// Real-time validation for signup password
document.getElementById('signupPassword')?.addEventListener('input', (e) => {
	const password = e.target.value;
	const status = document.getElementById('signupStatus');
	
	if (!password) {
		status.textContent = '';
		status.style.color = '#ef4444';
		return;
	}
	
	if (password.length < 8) {
		status.textContent = '❌ Пароль должен быть минимум 8 символов';
		status.style.color = '#ef4444';
		return;
	}
	
	const digitCount = (password.match(/\d/g) || []).length;
	if (digitCount < 2) {
		status.textContent = '❌ Пароль должен содержать минимум 2 цифры';
		status.style.color = '#ef4444';
		return;
	}
	
	// Clear error if validation passes
	status.textContent = '';
});

document.getElementById('toggleChangePassword')?.addEventListener('click', toggleChangePasswordForm);
document.getElementById('saveNewPassword')?.addEventListener('click', handleChangePassword);
document.getElementById('cancelChangePassword')?.addEventListener('click', toggleChangePasswordForm);
document.getElementById('accountGender')?.addEventListener('change', handleGenderChange);
document.getElementById('deleteAccountBtn')?.addEventListener('click', handleDeleteAccount);
document.getElementById('adminPanelBtn')?.addEventListener('click', () => {
	window.location.href = '/admin.html';
});
document.getElementById('landingLoginBtn')?.addEventListener('click', openModal);

const cardToggleMap = {
	toggleFormCard: 'form',
	toggleHistoryCard: 'history',
	toggleChartCard: 'chart',
	toggleWaterCard: 'waterTracker',
	toggleWaterChartCard: 'waterChart'
};

Object.entries(cardToggleMap).forEach(([id, key]) => {
	const el = document.getElementById(id);
	if (!el) return;
	el.addEventListener('change', (e) => {
		const fullVisibility = { ...userSettings.card_visibility, [key]: e.target.checked };
		saveUserSettings(fullVisibility);
	});
});

cardLayoutToggle?.addEventListener('change', (e) => {
	const layout = e.target.checked ? 'grid' : 'stack';
	setStoredCardLayout(layout);
	applyCardLayout(layout);
});

// Обработчики для воды
document.getElementById('waterSettingsBtn')?.addEventListener('click', openWaterSettingsModal);
document.getElementById('closeWaterSettingsModal')?.addEventListener('click', closeWaterSettingsModal);
document.getElementById('closeWaterSettingsBtn')?.addEventListener('click', closeWaterSettingsModal);
document.getElementById('waterWeight')?.addEventListener('change', autoSaveWaterSettings);
document.getElementById('waterActivity')?.addEventListener('change', autoSaveWaterSettings);
document.getElementById('waterResetTime')?.addEventListener('change', autoSaveWaterSettings);
document.getElementById('waterGoal')?.addEventListener('change', autoSaveWaterSettings);
document.getElementById('recalculateWaterBtn')?.addEventListener('click', () => {
	const weight = parseFloat(document.getElementById('waterWeight').value);
	const activity = document.getElementById('waterActivity').value;
	
	if (!weight || weight <= 0) {
		alert('Сначала введи вес');
		return;
	}
	
	const calculated = calculateDailyWaterGoal(weight, activity);
	document.getElementById('waterGoal').value = calculated;
	showWaterNotification(`✅ Норма пересчитана: ${calculated}мл`);
});
document.getElementById('addQuickButtonBtn')?.addEventListener('click', async () => {
	if (!waterSettings.quick_buttons) waterSettings.quick_buttons = [];
	waterSettings.quick_buttons.push({ name: '💧 Вода', amount: 500 });
	renderQuickButtonsList();
	await saveWaterSettings();
});

// Отслеживаем mousedown для модали настроек воды
let waterSettingsModalMouseDownTarget = null;
document.getElementById('waterSettingsModal')?.addEventListener('mousedown', (e) => {
	waterSettingsModalMouseDownTarget = e.target;
});
document.getElementById('waterSettingsModal')?.addEventListener('click', (e) => {
	if (e.target === document.getElementById('waterSettingsModal') && waterSettingsModalMouseDownTarget === document.getElementById('waterSettingsModal')) closeWaterSettingsModal();
});

// Обработчики для графика воды
document.getElementById('waterPeriodDay')?.addEventListener('click', () => {
	currentWaterPeriod = 'day';
	loadWaterChartData('day');
	document.getElementById('waterPeriodDay').classList.add('active');
	document.getElementById('waterPeriodWeek').classList.remove('active');
	document.getElementById('waterPeriodMonth').classList.remove('active');
	document.getElementById('waterPeriodYear').classList.remove('active');
});

document.getElementById('waterPeriodWeek')?.addEventListener('click', () => {
	currentWaterPeriod = 'week';
	loadWaterChartData('week');
	document.getElementById('waterPeriodDay').classList.remove('active');
	document.getElementById('waterPeriodWeek').classList.add('active');
	document.getElementById('waterPeriodMonth').classList.remove('active');
	document.getElementById('waterPeriodYear').classList.remove('active');
});

document.getElementById('waterPeriodMonth')?.addEventListener('click', () => {
	currentWaterPeriod = 'month';
	loadWaterChartData('month');
	document.getElementById('waterPeriodDay').classList.remove('active');
	document.getElementById('waterPeriodWeek').classList.remove('active');
	document.getElementById('waterPeriodMonth').classList.add('active');
	document.getElementById('waterPeriodYear').classList.remove('active');
});

document.getElementById('waterPeriodYear')?.addEventListener('click', () => {
	currentWaterPeriod = 'year';
	loadWaterChartData('year');
	document.getElementById('waterPeriodDay').classList.remove('active');
	document.getElementById('waterPeriodWeek').classList.remove('active');
	document.getElementById('waterPeriodMonth').classList.remove('active');
	document.getElementById('waterPeriodYear').classList.add('active');
});

// ===== ИНИЦИАЛИЗАЦИЯ =====
(async () => {
	try {
		console.log('🚀 Инициализация приложения...');
		console.log('✓ DOM элементы загружены');
		applyCardVisibility();
		syncCardVisibilityUI();
		
		// Проверяем есть ли сохраненные данные входа
		const savedUsername = localStorage.getItem('rememberMe_username');
		const savedPassword = localStorage.getItem('rememberMe_password');
		
		if (savedUsername && savedPassword) {
			console.log('🔄 Найдены сохраненные данные входа, попытка автоматического входа...');
			const autoLoginSuccess = await autoLogin(savedUsername, savedPassword);
			if (autoLoginSuccess) {
				await loadWaterSettings();
				await loadWaterLogs();
			}
		} else {
			// Обычная загрузка данных пользователя (через cookies если есть)
			await loadUserData();
			if (authenticated) {
				await loadUserSettings();
			}
		}
		
		console.log('✓ После loadUserData - authenticated:', authenticated, 'currentUser:', currentUser, 'история:', history.length);
		updateUserBadge();
		console.log('✓ updateUserBadge завершен');
		
		renderHistory();
		console.log('✓ renderHistory завершен');
		
		resizeCanvas();
		console.log('✓ resizeCanvas завершен');
		
		drawChart();
		console.log('✓ drawChart завершен');
		
		// Загружаем воду если пользователь авторизован
		if (authenticated) {
			await loadWaterSettings();
			await loadWaterLogs();
			
			// Показываем секцию графика воды
			const waterChartSection = document.getElementById('waterChartSection');
			if (waterChartSection) {
				waterChartSection.style.display = 'block';
			}
			
			// Загружаем данные для графика воды
			await loadWaterChartData('day');
		}
		
		// Проверяем оффлайн-очередь при старте (если были данные до перезагрузки)
		if (navigator.onLine && offlineQueue.length > 0) {
			console.log('🌐 Онлайн при старте, обрабатываю очередь...');
			await processOfflineQueue();
		}
		
		console.log('✓ Инициализация завершена');
		
		// Периодическая синхронизация настроек карточек между устройствами
		if (authenticated && !window.cardSyncInterval) {
			window.cardSyncInterval = setInterval(syncCardSettingsFromServer, 1500);
		}
		
		window.addEventListener('resize', () => {
			resizeCanvas();
			drawChart();
		});

		if ('serviceWorker' in navigator) {
			window.addEventListener('load', () => {
				navigator.serviceWorker.register('./service-worker.js').catch(() => {});
			});
		}

	} catch (err) {
		console.error('❌ КРИТИЧЕСКАЯ ОШИБКА при инициализации:', err);
		console.error(err.stack);
	} finally {
		// Гарантируем показ интерфейса даже при ошибке и анимированный вход
			window.requestAnimationFrame(() => {
				document.body.classList.add('page-ready');
				if (!authenticated) {
					const landing = document.getElementById('landingPage');
					const appContent = document.getElementById('appContent');
					const mainHeader = document.getElementById('mainHeader');
					landing && (landing.style.display = 'block');
					appContent && (appContent.style.display = 'none');
					mainHeader && (mainHeader.style.display = 'none');
				}
			});
		}
})();

// ===== ОБРАБОТЧИКИ МОДАЛЬНЫХ ОКОН =====
// Модаль аккаунта
userAccountBtn?.addEventListener('click', () => {
	accountModal.classList.add('active');
	document.body.style.overflow = 'hidden';
});

closeAccountModal?.addEventListener('click', () => {
	accountModal.classList.remove('active');
	document.body.style.overflow = '';
});

accountModal?.addEventListener('click', (e) => {
	if (e.target === accountModal) {
		accountModal.classList.remove('active');
		document.body.style.overflow = '';
	}
});

accountLogoutBtn?.addEventListener('click', async () => {
	if (!confirm('Точно выйти?')) return;
	try {
		// Закрываем модаль аккаунта
		const accountModal = document.getElementById('accountModal');
		if (accountModal) {
			accountModal.classList.remove('active');
		}
		
		// Выполняем logout на сервере
		await apiCall('/api/logout', { method: 'POST' });
		
		// Очищаем состояние приложения
		authenticated = false;
		currentUser = null;
		userId = null;
		history = [];
		waterLogs = [];
		
		// Очищаем сохраненные данные входа
		localStorage.removeItem('rememberMe_username');
		localStorage.removeItem('rememberMe_password');
		
		// Обновляем интерфейс
		updateUserBadge();
		renderHistory();
		
		// Перезагружаем страницу для полного обновления
		setTimeout(() => {
			window.location.reload();
		}, 300);
	} catch (err) {
		console.error('Ошибка выхода:', err.message);
		alert('Ошибка выхода: ' + err.message);
	}
});

// Модаль настроек
settingsBtn?.addEventListener('click', () => {
	settingsModal.classList.add('active');
	document.body.style.overflow = 'hidden';
});

// Кнопка выйти в хедере
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
	try {
		await fetch('/api/logout', { method: 'POST' });
		authenticated = false;
		currentUser = null;
		currentUserData = null;
		localStorage.removeItem('rememberMe_username');
		localStorage.removeItem('rememberMe_password');
		updateUserBadge();
		location.reload();
	} catch (err) {
		console.error('Ошибка выхода:', err);
	}
});

closeSettingsModal?.addEventListener('click', () => {
	settingsModal.classList.remove('active');
	document.body.style.overflow = '';
});

settingsModal?.addEventListener('click', (e) => {
	if (e.target === settingsModal) {
		settingsModal.classList.remove('active');
		document.body.style.overflow = '';
	}
});

// Резерв: если DOM уже готов, добавим класс для анимации входа
document.addEventListener('DOMContentLoaded', () => {
	if (!document.body.classList.contains('page-ready')) {
		window.requestAnimationFrame(() => {
			document.body.classList.add('page-ready');
		});
	}
});
}