// ===== WebSocket для реал-тайма =====
let ws = null;

function connectAdminWebSocket(userId) {
	const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	const wsUrl = `${protocol}//${window.location.host}`;
	
	console.log('Admin WebSocket: подключаемся к', wsUrl);
	ws = new WebSocket(wsUrl);
	
	ws.onopen = () => {
		console.log('Admin WebSocket: подключены');
		ws.send(JSON.stringify({ type: 'auth', userId, isAdmin: true }));
	};
	
	ws.onmessage = async (event) => {
		try {
			const msg = JSON.parse(event.data);
			console.log('Admin WebSocket сообщение:', msg);
			
			if (msg.type === 'adminUpdate') {
				// Обновления для админов
				switch (msg.updateType) {
					case 'userRegistered':
						console.log('📢 Новый пользователь зарегистрирован:', msg.data);
						await loadStats();
						await loadUsers();
						break;
						
					case 'userDeleted':
						console.log('📢 Пользователь удален:', msg.data);
						await loadStats();
						await loadUsers();
						break;
						
					case 'adminToggled':
						console.log('📢 Права администратора изменены:', msg.data);
						await loadStats();
						await loadUsers();
						break;
						
					case 'entryAdded':
					case 'waterAdded':
						console.log('📢 Данные обновлены у пользователя:', msg.userId);
						await loadStats();
						// Обновляем только статистику, не всех пользователей
						break;
				}
			}
		} catch (e) {
			console.error('Admin WebSocket ошибка обработки сообщения:', e);
		}
	};
	
	ws.onerror = (err) => {
		console.error('Admin WebSocket ошибка:', err);
	};
	
	ws.onclose = () => {
		console.log('Admin WebSocket: отключены. Переподключение через 3 сек...');
		setTimeout(() => connectAdminWebSocket(userId), 3000);
	};
}

// ===== API ФУНКЦИИ =====
async function apiCall(endpoint, options = {}) {
	try {
		const response = await fetch(endpoint, {
			credentials: 'include',
			headers: {
				'Content-Type': 'application/json',
				...options.headers
			},
			...options
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Ошибка запроса');
		}

		return await response.json();
	} catch (err) {
		console.error('API Error:', err);
		throw err;
	}
}

// ===== ПРОВЕРКА ПРАВ =====
async function checkAdminAccess() {
	try {
		const data = await apiCall('/api/admin/check');
		if (!data.isAdmin) {
			alert('У вас нет прав администратора!');
			window.location.href = '/';
			return false;
		}
		return true;
	} catch (err) {
		alert('Ошибка проверки прав доступа');
		window.location.href = '/';
		return false;
	}
}

// ===== ЗАГРУЗКА ДАННЫХ =====
let allUsers = [];
let currentResetUserId = null;

async function loadStats() {
	try {
		const stats = await apiCall('/api/admin/stats');
		document.getElementById('totalUsers').textContent = stats.totalUsers || 0;
		document.getElementById('adminCount').textContent = stats.adminCount || 0;
		document.getElementById('totalEntries').textContent = stats.totalEntries || 0;
		document.getElementById('totalWaterLogs').textContent = stats.totalWaterLogs || 0;

		// Отображаем недавних пользователей
		const recentList = document.getElementById('recentUsersList');
		recentList.innerHTML = stats.recentUsers.map(user => `
			<div class="recent-user-item">
				<span class="recent-user-name">${escapeHtml(user.username)}</span>
				<span class="recent-user-date">${formatDate(user.created_at)}</span>
			</div>
		`).join('');
	} catch (err) {
		console.error('Ошибка загрузки статистики:', err);
	}
}

async function loadUsers() {
	try {
		const users = await apiCall('/api/admin/users');
		allUsers = users;
		renderUsersTable(users);
	} catch (err) {
		console.error('Ошибка загрузки пользователей:', err);
		document.getElementById('usersTableBody').innerHTML = `
			<tr><td colspan="8" style="text-align: center; color: var(--danger);">
				Ошибка загрузки: ${escapeHtml(err.message)}
			</td></tr>
		`;
	}
}

async function loadUserDetails(userId) {
	try {
		const user = await apiCall(`/api/admin/users/${userId}`);
		showUserDetailsModal(user);
	} catch (err) {
		alert('Ошибка загрузки деталей пользователя: ' + err.message);
	}
}

// ===== ОТОБРАЖЕНИЕ ТАБЛИЦЫ =====
function renderUsersTable(users) {
	const tbody = document.getElementById('usersTableBody');
	
	if (!users || users.length === 0) {
		tbody.innerHTML = `
			<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">
				Пользователи не найдены
			</td></tr>
		`;
		return;
	}

	tbody.innerHTML = users.map(user => `
		<tr>
			<td>${user.id}</td>
			<td><strong>${escapeHtml(user.username)}</strong></td>
			<td>${user.email || '<span style="color: var(--text-muted);">нет</span>'}</td>
			<td>${formatDate(user.created_at)}</td>
			<td>${user.entries_count || 0}</td>
			<td>${user.water_logs_count || 0}</td>
			<td>
				<span class="user-role ${user.is_admin ? 'admin' : 'user'}">
					${user.is_admin ? 'Админ' : 'Пользователь'}
				</span>
			</td>
			<td>
				<div class="action-buttons">
					<button class="btn-action view" onclick="loadUserDetails(${user.id})">
						👁️ Детали
					</button>
					<button class="btn-action toggle" onclick="toggleAdmin(${user.id})">
						🔐 ${user.is_admin ? 'Снять админа' : 'Сделать админом'}
					</button>
					<button class="btn-action reset" onclick="showResetPasswordModal(${user.id}, '${escapeHtml(user.username)}')">
						🔑 Сбросить пароль
					</button>
					<button class="btn-action delete" onclick="deleteUser(${user.id}, '${escapeHtml(user.username)}')">
						🗑️ Удалить
					</button>
				</div>
			</td>
		</tr>
	`).join('');
}

// ===== ДЕЙСТВИЯ С ПОЛЬЗОВАТЕЛЯМИ =====
async function toggleAdmin(userId) {
	if (!confirm('Вы уверены, что хотите изменить права администратора?')) return;

	try {
		const result = await apiCall(`/api/admin/users/${userId}/toggle-admin`, {
			method: 'POST'
		});
		alert(result.message);
		await loadUsers();
		await loadStats();
	} catch (err) {
		alert('Ошибка: ' + err.message);
	}
}

async function deleteUser(userId, username) {
	if (!confirm(`Вы уверены, что хотите удалить пользователя "${username}"?\n\nВСЕ его данные будут удалены БЕЗВОЗВРАТНО!`)) return;

	try {
		const result = await apiCall(`/api/admin/users/${userId}`, {
			method: 'DELETE'
		});
		alert(result.message);
		await loadUsers();
		await loadStats();
	} catch (err) {
		alert('Ошибка: ' + err.message);
	}
}

function showResetPasswordModal(userId, username) {
	currentResetUserId = userId;
	document.getElementById('resetPasswordUsername').textContent = username;
	document.getElementById('newPasswordInput').value = '';
	document.getElementById('resetPasswordModal').style.display = 'flex';
}

async function resetPassword() {
	const newPassword = document.getElementById('newPasswordInput').value;
	
	if (!newPassword || newPassword.length < 4) {
		alert('Пароль должен быть не менее 4 символов');
		return;
	}

	try {
		const result = await apiCall(`/api/admin/users/${currentResetUserId}/reset-password`, {
			method: 'POST',
			body: JSON.stringify({ newPassword })
		});
		alert(result.message);
		document.getElementById('resetPasswordModal').style.display = 'none';
	} catch (err) {
		alert('Ошибка: ' + err.message);
	}
}

// ===== МОДАЛЬНЫЕ ОКНА =====
function showUserDetailsModal(user) {
	const content = document.getElementById('userDetailsContent');
	content.innerHTML = `
		<div class="detail-row">
			<span class="detail-label">ID:</span>
			<span class="detail-value">${user.id}</span>
		</div>
		<div class="detail-row">
			<span class="detail-label">Логин:</span>
			<span class="detail-value">${escapeHtml(user.username)}</span>
		</div>
		<div class="detail-row">
			<span class="detail-label">Email:</span>
			<span class="detail-value">${user.email || 'не указан'}</span>
		</div>
		<div class="detail-row">
			<span class="detail-label">Роль:</span>
			<span class="detail-value">
				<span class="user-role ${user.is_admin ? 'admin' : 'user'}">
					${user.is_admin ? 'Администратор' : 'Пользователь'}
				</span>
			</span>
		</div>
		<div class="detail-row">
			<span class="detail-label">Дата регистрации:</span>
			<span class="detail-value">${formatDate(user.created_at)}</span>
		</div>
		<div class="detail-row">
			<span class="detail-label">Всего записей:</span>
			<span class="detail-value">${user.entries_count || 0}</span>
		</div>
		<div class="detail-row">
			<span class="detail-label">Логов воды:</span>
			<span class="detail-value">${user.water_logs_count || 0}</span>
		</div>
		<div class="detail-row">
			<span class="detail-label">Последняя запись:</span>
			<span class="detail-value">${user.last_entry ? formatDate(user.last_entry) : 'нет записей'}</span>
		</div>
		<div class="detail-row">
			<span class="detail-label">Последний лог воды:</span>
			<span class="detail-value">${user.last_water_log ? formatDate(user.last_water_log) : 'нет логов'}</span>
		</div>
	`;
	document.getElementById('userDetailsModal').style.display = 'flex';
}

// ===== ПОИСК =====
function setupSearch() {
	const searchInput = document.getElementById('searchUsers');
	searchInput.addEventListener('input', (e) => {
		const query = e.target.value.toLowerCase().trim();
		
		if (!query) {
			renderUsersTable(allUsers);
			return;
		}

		const filtered = allUsers.filter(user => {
			return user.username.toLowerCase().includes(query) ||
			       (user.email && user.email.toLowerCase().includes(query)) ||
			       user.id.toString().includes(query);
		});

		renderUsersTable(filtered);
	});
}

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====
function escapeHtml(text) {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

function formatDate(dateString) {
	if (!dateString) return 'н/д';
	
	// Нормализация временной метки: если сервер вернул строку без таймзоны ("YYYY-MM-DD HH:mm:ss"),
	// добавляем 'Z', чтобы трактовать её как UTC и затем показать в локальном времени пользователя.
	let date;
	if (typeof dateString === 'string') {
		const hasTZ = /[zZ]|[+-]\d\d:?\d\d/.test(dateString);
		date = new Date(hasTZ ? dateString : `${dateString}Z`);
	} else {
		date = new Date(dateString);
	}
	
	// Получаем локальный часовой пояс пользователя
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	
	return date.toLocaleString('ru-RU', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit'
	});
}

// ===== ИНИЦИАЛИЗАЦИЯ =====
async function init() {
	// Проверка прав доступа
	const hasAccess = await checkAdminAccess();
	if (!hasAccess) return;

	// Загружаем информацию о текущем пользователе
	let currentUserId = null;
	try {
		const me = await apiCall('/api/me');
		document.getElementById('currentAdminName').textContent = me.username;
		currentUserId = me.id;
		
		// Подключаемся к WebSocket для реал-тайм обновлений
		connectAdminWebSocket(currentUserId);
	} catch (err) {
		console.error('Ошибка получения текущего пользователя:', err);
	}

	// Загружаем данные
	await Promise.all([
		loadStats(),
		loadUsers()
	]);

	// Настраиваем поиск
	setupSearch();

	// Обработчики кнопок
	document.getElementById('logoutBtn').addEventListener('click', async () => {
		try {
			await apiCall('/api/logout', { method: 'POST' });
			window.location.href = '/';
		} catch (err) {
			alert('Ошибка выхода: ' + err.message);
		}
	});

	// Модальные окна
	document.getElementById('closeUserDetailsModal').addEventListener('click', () => {
		document.getElementById('userDetailsModal').style.display = 'none';
	});

	document.getElementById('closeResetPasswordModal').addEventListener('click', () => {
		document.getElementById('resetPasswordModal').style.display = 'none';
	});

	document.getElementById('confirmResetPasswordBtn').addEventListener('click', resetPassword);

	document.getElementById('cancelResetPasswordBtn').addEventListener('click', () => {
		document.getElementById('resetPasswordModal').style.display = 'none';
	});

	// Закрытие модального окна по клику на overlay
	document.getElementById('userDetailsModal').addEventListener('click', (e) => {
		if (e.target.id === 'userDetailsModal') {
			e.target.style.display = 'none';
		}
	});

	document.getElementById('resetPasswordModal').addEventListener('click', (e) => {
		if (e.target.id === 'resetPasswordModal') {
			e.target.style.display = 'none';
		}
	});
}

// Запуск после загрузки DOM
document.addEventListener('DOMContentLoaded', init);
