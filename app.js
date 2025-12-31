const accounts = [
	{ id: 'bohdan', label: 'Bohdan', password: '1234' },
	{ id: 'konstantin', label: 'Konstantin', password: '1234' },
	{ id: 'izabella', label: 'Izabella', password: '1234' }
];
const sexState = { current: 'male' };
const historyKey = 'bf-history-v1';
const currentUserKey = 'bf-current-user';
let currentUser = loadCurrentUser();
let authenticated = Boolean(currentUser);
let history = loadHistory(currentUser);

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
let viewW = 0;
let viewH = 0;
const maxPoints = 24;
const chartHeight = 320;

function loadCurrentUser() {
	try {
		return localStorage.getItem(currentUserKey) || '';
	} catch (e) {
		return '';
	}
}

function loadHistory(userId) {
	if (!userId) return [];
	try {
		const raw = localStorage.getItem(`${historyKey}-${userId}`) || localStorage.getItem(historyKey);
		return raw ? JSON.parse(raw) : [];
	} catch (e) {
		return [];
	}
}

function saveHistory(list, userId) {
	if (!userId) return;
	localStorage.setItem(`${historyKey}-${userId}`, JSON.stringify(list));
}

function getUserName(userId) {
	const acc = accounts.find(a => a.id === userId);
	return acc ? acc.label : 'Неизвестно';
}

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
	if (authenticated && currentUser) {
		currentUserPill.textContent = '👤 ' + getUserName(currentUser);
		currentUserPill.classList.remove('status-warn');
		currentUserPill.classList.add('status-ok');
		currentUserPill.style.display = 'inline-block';
	} else {
		currentUserPill.style.display = 'none';
		currentUserPill.classList.remove('status-ok');
		currentUserPill.classList.add('status-warn');
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

function handleLogin() {
	const selectedId = userSelect.value;
	const account = accounts.find(a => a.id === selectedId);
	if (!account) return;
	if (passwordInput.value.trim() !== account.password) {
		authenticated = false;
		currentUser = '';
		authStatus.textContent = '❌ Пароль неверный. Попробуй 1234.';
		authStatus.classList.add('status-warn');
		updateUserBadge();
		return;
	}

	authenticated = true;
	currentUser = account.id;
	localStorage.setItem(currentUserKey, currentUser);
	history = loadHistory(currentUser);
	authStatus.textContent = '✓ Привет, ' + account.label + '! Твои данные сохранятся здесь.';
	authStatus.classList.remove('status-warn');
	passwordInput.value = '';
	updateUserBadge();
	renderHistory();
	drawChart();
	updateLast(history[history.length - 1]);
}

function handleLogout() {
	authenticated = false;
	currentUser = '';
	localStorage.removeItem(currentUserKey);
	history = [];
	authStatus.textContent = 'До свидания! Ты вышел.';
	authStatus.classList.add('status-warn');
	updateUserBadge();
	renderHistory();
	drawChart();
	updateLast();
}

function handleCalculate() {
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

	const entry = {
		id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
		sex: sexState.current,
		height: h,
		neck: n,
		waist: w,
		hip: sexState.current === 'female' ? hip : null,
		bf,
		group: group ? group.label : '',
		timestamp: Date.now()
	};

	history.push(entry);
	saveHistory(history, currentUser);
	renderHistory();
	drawChart();
	updateLast(entry);
}

function renderHistory() {
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

function deleteEntry(id) {
	const idx = history.findIndex(e => e.id === id);
	if (idx >= 0) {
		history.splice(idx, 1);
		saveHistory(history, currentUser);
		renderHistory();
		drawChart();
		updateLast(history[history.length - 1]);
	}
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

function clearHistory() {
	if (!authenticated || !currentUser) {
		currentNote.textContent = 'Войди сначала, чтобы очистить историю';
		return;
	}
	history.splice(0, history.length);
	saveHistory(history, currentUser);
	renderHistory();
	drawChart();
	updateLast();
	currentResult.textContent = '—';
	currentNote.textContent = 'История очищена';
}

maleBtn.addEventListener('click', () => setSex('male'));
femaleBtn.addEventListener('click', () => setSex('female'));
calcBtn.addEventListener('click', handleCalculate);
clearBtn.addEventListener('click', clearHistory);
loginBtn.addEventListener('click', handleLogin);
logoutBtn.addEventListener('click', handleLogout);

userSelect.value = currentUser || accounts[0].id;
if (authenticated && currentUser) {
	authStatus.textContent = 'Вошли как ' + getUserName(currentUser) + '. История сохранится отдельно.';
	authStatus.classList.remove('status-warn');
} else {
	authStatus.textContent = 'Войдите, чтобы сохранить личную историю.';
	authStatus.classList.add('status-warn');
}
updateUserBadge();

setSex('male');
renderHistory();
resizeCanvas();
drawChart();
updateLast(authenticated ? history[history.length - 1] : null);

window.addEventListener('resize', () => {
	resizeCanvas();
	drawChart();
});

if ('serviceWorker' in navigator) {
	window.addEventListener('load', () => {
		navigator.serviceWorker.register('./service-worker.js').catch(() => {});
	});
}
