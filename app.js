// ===== СОСТОЯНИЕ И ПЕРЕМЕННЫЕ =====
const sexState = { current: 'male' };
let currentUser = null;
let authenticated = false;
let history = [];
let userId = null;

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
		return true;
	} catch (err) {
		console.error('✗ Ошибка loadUserData:', err);
		// Не обнуляем данные при временных проблемах сети/API, просто выводим предупреждение
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

// ===== ФУНКЦИИ ЛОГИКИ =====
function setSex(sex) {
	sexState.current = sex;
	maleBtn.classList.toggle('active', sex === 'male');
	femaleBtn.classList.toggle('active', sex === 'female');
	hipWrap.style.display = sex === 'female' ? 'block' : 'none';
	currentNote.textContent = sex === 'female'
		? 'Для девушек: (талия + бёдра − шея)'
		: 'Для парней: (талия − шея)';
}

function updateUserBadge() {
	const loginForm = document.getElementById('loginForm');
	const logoutForm = document.getElementById('logoutForm');
	const modalTitle = document.getElementById('modalTitle');
	const userDisplayName = document.getElementById('userDisplayName');
	
	if (authenticated && currentUser) {
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
		currentUserPill.style.display = 'none';
		currentUserPill.classList.remove('status-ok');
		currentUserPill.classList.add('status-warn');
		openAuthModal.style.display = '';
		loginForm.style.display = 'block';
		logoutForm.style.display = 'none';
		signupForm.style.display = 'none';
		modalTitle.textContent = 'Кто ты?';
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
		await new Promise(resolve => setTimeout(resolve, 100));
		
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
		
		// Инициализируем canvas размеры перед отрисовкой
		initCanvasSize();
		
		// Рендерим все элементы
		renderHistory();
		drawChart();
		updateLast(history[history.length - 1]);
		
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
		await apiCall('/api/logout', { method: 'POST' });
		authenticated = false;
		currentUser = null;
		userId = null;
		history = [];
		userSelect.value = '';
		passwordInput.value = '';
		authStatus.textContent = 'До свидания! Ты вышел.';
		authStatus.classList.add('status-warn');
		updateUserBadge();
		renderHistory();
		drawChart();
		updateLast();
		// Убираем сообщение через 2 секунды
		setTimeout(() => {
			authStatus.textContent = '';
			authStatus.classList.remove('status-warn');
		}, 2000);

		// Закрываем модалку через 3 секунды после выхода
		setTimeout(closeModal, 3000);
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
		
		const entry = {
			id: result.id,
			sex: result.sex,
			height: result.height,
			neck: result.neck,
			waist: result.waist,
			hip: result.hip,
			bf: result.bf,
			group: result.group,
			timestamp: new Date(result.timestamp).getTime()
		};
		
		history.push(entry);
		renderHistory();
		drawChart();
		updateLast(entry);
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
			<div>
				<strong>${item.bf}%</strong> <small>${item.group}</small><br />
				<small>${item.sex === 'male' ? '♂' : '♀'} ${item.height} см</small>
			</div>
			<div style="text-align:right;">
				<small>${dateStr}</small>
				<button aria-label="Удалить" style="margin-top:6px; background:none; border:1px solid rgba(255,255,255,0.08); color:var(--muted); padding:6px 10px; border-radius:10px; cursor:pointer;">×</button>
			</div>`;
		row.querySelector('button').addEventListener('click', () => deleteEntry(item.id));
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
