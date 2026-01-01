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

// ===== API ФУНКЦИИ =====
async function apiCall(endpoint, options = {}) {
	try {
		const fullUrl = new URL(endpoint, window.location.origin).href;
		console.log('📡 API запрос к:', fullUrl);
		const response = await fetch(fullUrl, {
			credentials: 'include',
			...options,
			headers: {
				'Content-Type': 'application/json',
				...options.headers
			}
		});
		console.log('📡 Ответ:', response.status, response.statusText);
		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'API ошибка');
		}
		const data = await response.json();
		console.log('📡 Данные:', data);
		return data;
	} catch (err) {
		console.error('API ошибка:', err);
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
					updateLast(newEntry);
				} else if (msg.updateType === 'entryDeleted') {
					// Запись удалена другим устройством
					const idx = history.findIndex(e => e.id === msg.data.id);
					if (idx >= 0) {
						history.splice(idx, 1);
						console.log('🗑️ Запись удалена в реал-тайме. ID:', msg.data.id);
						renderHistory();
						drawChart();
						updateLast(history[history.length - 1]);
					}
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
		
		// Подключаемся к WebSocket для реал-тайма
		connectWebSocket(userId);
		
		return true;
	} catch (err) {
		console.error('✗ Ошибка loadUserData:', err);
		// Пробуем еще раз через 500ms
		await new Promise(resolve => setTimeout(resolve, 500));
		try {
			const user = await apiCall('/api/me');
			currentUser = user.username;
			userId = user.id;
			authenticated = true;
			const entries = await apiCall('/api/history');
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
			connectWebSocket(userId);
			return true;
		} catch (retryErr) {
			console.error('✗ Ошибка повторной попытки loadUserData:', retryErr);
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
}

// ===== DOM ЭЛЕМЕНТЫ =====
const authModal = document.getElementById('authModal');
const openAuthModal = document.getElementById('openAuthModal');
const closeAuthModal = document.getElementById('closeAuthModal');

const maleBtn = document.getElementById('maleBtn');
const femaleBtn = document.getElementById('femaleBtn');
const hipWrap = document.getElementById('hip-wrap');
const calcBtn = document.getElementById('calcBtn');
const clearBtn = document.getElementById('clearBtn');
const historyList = document.getElementById('history');
const historyCount = document.getElementById('history-count');
const currentResult = document.getElementById('current-result');
const currentNote = document.getElementById('current-note');
const lastResult = document.getElementById('last-result');
const lastMeta = document.getElementById('last-meta');
const chart = document.getElementById('chart');
const ctx = chart.getContext('2d');
const userSelect = document.getElementById('userSelect');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const authStatus = document.getElementById('authStatus');
const currentUserPill = document.getElementById('current-user-pill');

// Регистрация элементы
const signupForm = document.getElementById('signupForm');
const signupUsernameInput = document.getElementById('signupUsername');
const signupEmailInput = document.getElementById('signupEmail');
const signupPasswordInput = document.getElementById('signupPassword');
const signupBtn = document.getElementById('signupBtn');
const toggleSignupBtn = document.getElementById('toggleSignup');
const backToLoginBtn = document.getElementById('backToLogin');

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
currentUserPill?.addEventListener('click', openModal);
authModal?.addEventListener('click', (e) => {
	if (e.target === authModal) closeModal();
});

// Обработчики для модали записи
document.getElementById('closeEntryModal')?.addEventListener('click', closeEntryModal);
document.getElementById('entryDetailModal')?.addEventListener('click', (e) => {
	if (e.target === document.getElementById('entryDetailModal')) closeEntryModal();
});

// ===== ФУНКЦИИ ЛОГИКИ =====
function setSex(sex) {
	sexState.current = sex;
	maleBtn.classList.toggle('active', sex === 'male');
	femaleBtn.classList.toggle('active', sex === 'female');
	hipWrap.style.display = sex === 'female' ? 'block' : 'none';
	// Не показываем формулу по умолчанию, только результат после расчёта
	if (!authenticated && currentResult.textContent === '—') {
		currentNote.textContent = '';
	}
}

function updateUserBadge() {
	const loginForm = document.getElementById('loginForm');
	const logoutForm = document.getElementById('logoutForm');
	const modalTitle = document.getElementById('modalTitle');
	const userDisplayName = document.getElementById('userDisplayName');
	const landingPage = document.getElementById('landingPage');
	const appContent = document.getElementById('appContent');
	const mainHeader = document.getElementById('mainHeader');
	
	if (authenticated && currentUser) {
		// Скрываем landing page, показываем приложение
		landingPage.style.display = 'none';
		appContent.style.display = 'block';
		mainHeader.style.display = 'flex';
		
		currentUserPill.textContent = '✓ Ты: ' + currentUser;
		currentUserPill.classList.remove('status-warn');
		currentUserPill.classList.add('status-ok');
		currentUserPill.style.display = 'inline-block';
		openAuthModal.style.display = 'none';
		loginForm.style.display = 'none';
		logoutForm.style.display = 'block';
		modalTitle.textContent = 'Аккаунт';
		userDisplayName.textContent = currentUser;
		logoutBtn.style.display = '';
		loginBtn.style.display = 'none';
		toggleSignupBtn.style.display = 'none';
	} else {
		// Показываем landing page, скрываем приложение
		landingPage.style.display = 'block';
		appContent.style.display = 'none';
		mainHeader.style.display = 'none';
		
		currentUserPill.style.display = 'none';
		currentUserPill.classList.remove('status-ok');
		currentUserPill.classList.add('status-warn');
		openAuthModal.style.display = '';
		loginForm.style.display = 'block';
		logoutForm.style.display = 'none';
		signupForm.style.display = 'none';
		logoutBtn.style.display = 'none';
		loginBtn.style.display = '';
		toggleSignupBtn.style.display = '';
	}
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
	const status = document.getElementById('signupStatus');
	
	if (!username || !password) {
		status.textContent = '❌ Username и пароль обязательны';
		status.style.color = '#ef4444';
		return;
	}
	
	try {
		status.textContent = '⏳ Создаю аккаунт...';
		status.style.color = '#a5b4fc';
		
		const result = await apiCall('/api/signup', {
			method: 'POST',
			body: JSON.stringify({ username, email: email || null, password })
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
		
		status.textContent = '✓ Аккаунт создан! Добро пожаловать!';
		status.style.color = '#86efac';
		
		signupUsernameInput.value = '';
		signupEmailInput.value = '';
		signupPasswordInput.value = '';
		
		updateUserBadge();
		renderHistory();
		drawChart();
		updateLast(history[history.length - 1]);
		
		setTimeout(() => {
			toggleSignupForm();
		}, 1500);
	} catch (err) {
		status.textContent = '❌ ' + err.message;
		status.style.color = '#ef4444';
	}
}

async function handleLogin() {
	const username = userSelect.value.trim();
	const password = passwordInput.value.trim();
	
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
		
		// Даём браузеру время обработать cookies
		await new Promise(resolve => setTimeout(resolve, 200));
		
		// Загружаем данные пользователя
		const loaded = await loadUserData();
		if (!loaded) {
			authStatus.textContent = '❌ Ошибка загрузки данных';
			authStatus.classList.add('status-warn');
			return;
		}
		
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
		updateLast(history[history.length - 1]);
		
		// Загружаем настройки воды и логи
		await loadWaterSettings();
		await loadWaterLogs();
		
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
		
		await apiCall('/api/logout', { method: 'POST' });
		authenticated = false;
		currentUser = null;
		userId = null;
		history = [];
		waterLogs = [];
		userSelect.value = '';
		passwordInput.value = '';
		authStatus.textContent = 'До свидания! Ты вышел.';
		authStatus.classList.add('status-warn');
		updateUserBadge();
		renderHistory();
		drawChart();
		updateLast();
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

function showEntryDetail(entry) {
	const assessment = getBodyFatAssessment(entry.bf, entry.sex);
	const recommendations = getRecommendations(entry.bf, entry.sex);
	const date = new Date(entry.timestamp).toLocaleDateString('ru-RU', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
	
	const detailContent = document.getElementById('entryDetailContent');
	detailContent.innerHTML = `
		<div style="margin-bottom: 24px;">
			<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">${date}</div>
			<div style="display: flex; align-items: baseline; gap: 12px; margin-bottom: 8px;">
				<div style="font-size: 48px; font-weight: 700; color: ${assessment.color};">${entry.bf.toFixed(1)}%</div>
				<div>
					<div style="font-size: 14px; font-weight: 600; color: ${assessment.color};">${assessment.category}</div>
					<div style="font-size: 12px; color: var(--text-muted);">${assessment.status}</div>
				</div>
			</div>
		</div>
		
		<div style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 12px; padding: 16px; margin-bottom: 20px;">
			<h3 style="margin: 0 0 12px; font-size: 14px; color: #a5b4fc;">📋 Твои измерения</h3>
			<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 14px;">
				<div>
					<span style="color: var(--text-muted);">Пол:</span>
					<div style="font-weight: 600;">${entry.sex === 'male' ? 'Мужчина' : 'Женщина'}</div>
				</div>
				<div>
					<span style="color: var(--text-muted);">Рост:</span>
					<div style="font-weight: 600;">${entry.height} см</div>
				</div>
				<div>
					<span style="color: var(--text-muted);">Обхват шеи:</span>
					<div style="font-weight: 600;">${entry.neck} см</div>
				</div>
				<div>
					<span style="color: var(--text-muted);">Обхват талии:</span>
					<div style="font-weight: 600;">${entry.waist} см</div>
				</div>
				${entry.sex === 'female' ? `
				<div>
					<span style="color: var(--text-muted);">Обхват бёдер:</span>
					<div style="font-weight: 600;">${entry.hip} см</div>
				</div>
				` : ''}
			</div>
		</div>
		
		<div style="background: rgba(76, 175, 80, 0.08); border: 1px solid rgba(76, 175, 80, 0.2); border-radius: 12px; padding: 16px;">
			<h3 style="margin: 0 0 12px; font-size: 14px; color: #81c784;">💡 Рекомендации</h3>
			<div style="display: flex; flex-direction: column; gap: 8px;">
				${recommendations.map(tip => `<div style="font-size: 14px; line-height: 1.4; color: var(--text);">${tip}</div>`).join('')}
			</div>
		</div>
	`;
	
	const modal = document.getElementById('entryDetailModal');
		modal.classList.add('active');
}

function closeEntryModal() {
	const modal = document.getElementById('entryDetailModal');
	modal.classList.remove('active');
	document.body.style.overflow = '';
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
	}
}

async function loadWaterLogs() {
	try {
		const logs = await apiCall('/api/water-logs');
		waterLogs = logs;
		console.log('✓ Загружены логи воды:', waterLogs);
		renderWaterProgress();
		renderWaterLogs();
	} catch (err) {
		console.error('✗ Ошибка загрузки логов воды:', err);
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
	const totalToday = waterLogs.reduce((sum, log) => sum + log.amount, 0);
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
	
	// Сортируем от новых к старым
	const sorted = [...waterLogs].sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at));
	
	sorted.forEach(log => {
		const time = new Date(log.logged_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
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
		
		// Показываем короткое уведомление
		showWaterNotification(`✅ Добавлено ${amount}мл`);
	} catch (err) {
		console.error('✗ Ошибка добавления воды:', err);
	}
}

async function deleteWaterLog(id) {
	try {
		await apiCall(`/api/water-logs/${id}`, { method: 'DELETE' });
		await loadWaterLogs();
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
		
		deleteBtn.addEventListener('click', () => {
			waterSettings.quick_buttons.splice(idx, 1);
			renderQuickButtonsList();
		});
		
		nameInput.addEventListener('change', () => {
			waterSettings.quick_buttons[idx].name = nameInput.value;
		});
		
		amountInput.addEventListener('change', () => {
			waterSettings.quick_buttons[idx].amount = parseInt(amountInput.value);
		});
		
		container.appendChild(div);
	});
}

async function saveWaterSettings() {
	const weight = parseFloat(document.getElementById('waterWeight').value);
	const activity = document.getElementById('waterActivity').value;
	const resetTime = document.getElementById('waterResetTime').value;
	let dailyGoal = parseInt(document.getElementById('waterGoal').value);
	
	if (!weight || weight <= 0) {
		alert('Укажи вес');
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
		closeWaterSettingsModal();
		showWaterNotification('✅ Настройки сохранены');
	} catch (err) {
		console.error('✗ Ошибка сохранения:', err);
		alert('Ошибка при сохранении');
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
		currentNote.textContent = '❌ Ошибка сохранения: ' + err.message;
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
		updateLast(history[history.length - 1]);
	} catch (err) {
		console.error('Ошибка удаления:', err);
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
		const date = new Date(item.timestamp);
		const dateStr = date.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
		row.innerHTML = `
			<div style="flex: 1; cursor: pointer;">
				<strong>${item.bf}%</strong> <small>${item.group}</small><br />
				<small>${item.sex === 'male' ? '♂' : '♀'} ${item.height} см</small>
			</div>
			<div style="text-align:right;">
				<small>${dateStr}</small>
				<button aria-label="Удалить" style="margin-top:6px; background:none; border:1px solid rgba(255,255,255,0.08); color:var(--muted); padding:6px 10px; border-radius:10px; cursor:pointer;">×</button>
			</div>`;
		
		// Клик на информацию открывает модаль
		row.querySelector('div').addEventListener('click', () => showEntryDetail(item));
		
		// Клик на кнопку удаления
		row.querySelector('button').addEventListener('click', (e) => {
			e.stopPropagation();
			deleteEntry(item.id);
		});
		
		historyList.appendChild(row);
	});
}

function plural(n, forms) {
	const mod10 = n % 10;
	const mod100 = n % 100;
	if (mod10 === 1 && mod100 !== 11) return forms[0];
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
	return forms[2];
}

function updateLast(entry) {
	if (!entry) {
		lastResult.textContent = '—';
		lastMeta.textContent = 'Нет данных';
		return;
	}
	const dateStr = new Date(entry.timestamp).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
	lastResult.textContent = entry.bf + ' %';
	lastMeta.textContent = `${entry.sex === 'male' ? 'Муж' : 'Жен'}, ${entry.group || ''} • ${dateStr}`;
}

async function clearHistory() {
	if (!authenticated || !currentUser) {
		currentNote.textContent = 'Войди сначала, чтобы очистить историю';
		return;
	}
	
	if (!confirm('Вы уверены? Это действие необратимо.')) return;
	
	try {
		for (let i = history.length - 1; i >= 0; i--) {
			await apiCall(`/api/history/${history[i].id}`, { method: 'DELETE' });
		}
		history = [];
		renderHistory();
		drawChart();
		updateLast();
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

	ctx.fillStyle = '#0b0e16';
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
		ctx.arc(x, y, 8, 0, Math.PI * 2);
		ctx.fill();
	});

	ctx.fillStyle = '#8f9bb2';
	ctx.font = '11px "SF Pro Display"';
	for (let i = 0; i < entries.length; i += xStepShow) {
		const x = scaleX(i);
		const label = new Date(entries[i].timestamp).toLocaleDateString('ru-RU', { month: 'short', day: 'numeric' });
		ctx.fillText(label, x - 18, viewH - padding + 18);
	}

	ctx.fillStyle = '#9aa7bd';
	ctx.font = '12px "SF Pro Display"';
	const last = entries[entries.length - 1];
	ctx.fillText('Последнее: ' + last.bf + ' %', scaleX(entries.length - 1) - 30, scaleY(last.bf) - 14);
}

// ===== СМЕНА ПАРОЛЯ =====
async function handleChangePassword() {
	const currentPassword = document.getElementById('currentPassword').value;
	const newPassword = document.getElementById('newPassword').value;
	const confirmPassword = document.getElementById('confirmPassword').value;
	const statusEl = document.getElementById('passwordChangeStatus');
	
	if (!currentPassword || !newPassword || !confirmPassword) {
		statusEl.textContent = '❌ Заполни все поля';
		statusEl.style.color = '#ef4444';
		return;
	}
	
	if (newPassword.length < 4) {
		statusEl.textContent = '❌ Пароль должен быть не менее 4 символов';
		statusEl.style.color = '#ef4444';
		return;
	}
	
	if (newPassword !== confirmPassword) {
		statusEl.textContent = '❌ Пароли не совпадают';
		statusEl.style.color = '#ef4444';
		return;
	}
	
	try {
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
		statusEl.textContent = '❌ ' + err.message;
		statusEl.style.color = '#ef4444';
	}
}

function toggleChangePasswordForm() {
	const changeForm = document.getElementById('changePasswordForm');
	const accountInfo = document.getElementById('accountInfo');
	const accountActions = document.getElementById('accountActions');
	
	if (changeForm.style.display === 'none') {
		changeForm.style.display = 'block';
		accountInfo.style.display = 'none';
		accountActions.style.display = 'none';
	} else {
		changeForm.style.display = 'none';
		accountInfo.style.display = 'block';
		accountActions.style.display = 'block';
	}
}

// ===== EVENT LISTENERS =====
maleBtn.addEventListener('click', () => setSex('male'));
femaleBtn.addEventListener('click', () => setSex('female'));
calcBtn.addEventListener('click', handleCalculate);
clearBtn.addEventListener('click', clearHistory);
loginBtn.addEventListener('click', () => {
	handleLogin();
});
logoutBtn.addEventListener('click', handleLogout);
signupBtn?.addEventListener('click', handleSignup);
toggleSignupBtn?.addEventListener('click', toggleSignupForm);
backToLoginBtn?.addEventListener('click', toggleSignupForm);

document.getElementById('toggleChangePassword')?.addEventListener('click', toggleChangePasswordForm);
document.getElementById('saveNewPassword')?.addEventListener('click', handleChangePassword);
document.getElementById('cancelChangePassword')?.addEventListener('click', toggleChangePasswordForm);
document.getElementById('landingLoginBtn')?.addEventListener('click', openModal);

// Обработчики для воды
document.getElementById('waterSettingsBtn')?.addEventListener('click', openWaterSettingsModal);
document.getElementById('closeWaterSettingsModal')?.addEventListener('click', closeWaterSettingsModal);
document.getElementById('closeWaterSettingsBtn')?.addEventListener('click', closeWaterSettingsModal);
document.getElementById('saveWaterSettingsBtn')?.addEventListener('click', saveWaterSettings);
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
document.getElementById('addQuickButtonBtn')?.addEventListener('click', () => {
	if (!waterSettings.quick_buttons) waterSettings.quick_buttons = [];
	waterSettings.quick_buttons.push({ name: '💧 Вода', amount: 500 });
	renderQuickButtonsList();
});

document.getElementById('waterSettingsModal')?.addEventListener('click', (e) => {
	if (e.target === document.getElementById('waterSettingsModal')) closeWaterSettingsModal();
});

// ===== ИНИЦИАЛИЗАЦИЯ =====
(async () => {
	console.log('🚀 Инициализация приложения...');
	await loadUserData();
	console.log('✓ После loadUserData - authenticated:', authenticated, 'currentUser:', currentUser, 'история:', history.length);
	setSex('male');
	updateUserBadge();
	renderHistory();
	resizeCanvas();
	drawChart();
	updateLast(authenticated ? history[history.length - 1] : null);
	
	// Загружаем воду если пользователь авторизован
	if (authenticated) {
		await loadWaterSettings();
		await loadWaterLogs();
	}
	
	console.log('✓ Инициализация завершена');
	
	window.addEventListener('resize', () => {
		resizeCanvas();
		drawChart();
	});

	if ('serviceWorker' in navigator) {
		window.addEventListener('load', () => {
			navigator.serviceWorker.register('./service-worker.js').catch(() => {});
		});
	}
})();
