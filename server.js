const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
// Позволяем вынести БД на volume, чтобы данные не терялись при перезапуске контейнера
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.db');

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.use(cookieParser());

// Логирование всех запросов
app.use((req, res, next) => {
  console.log(`\n📨 ${req.method} ${req.path} from ${req.ip}`);
  console.log('   Cookies:', Object.keys(req.cookies).length ? req.cookies : 'нет');
  next();
});

app.use(cors({
  origin: function (origin, callback) {
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));

// Инициализация БД
// Гарантируем, что директория для файла БД существует (полезно при монтировании volume)
try {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
} catch (e) {
  console.error('Не удалось создать директорию для БД:', path.dirname(DB_PATH), e.message);
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Ошибка БД при подключении:', err.message);
  } else {
    let size = 'unknown';
    try {
      const stat = fs.statSync(DB_PATH);
      size = stat.size + ' bytes';
    } catch (e) {
      size = 'не удалось прочитать размер';
    }
    console.log('✓ SQLite БД подключена. Путь:', DB_PATH, '| Размер:', size);
  }
});

// Создание таблиц
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Ошибка создания таблицы users:', err);
    else console.log('✓ Таблица users готова');
  });
  
  db.run(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      sex TEXT,
      height REAL,
      neck REAL,
      waist REAL,
      hip REAL,
      bf REAL,
      \`group\` TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) console.error('Ошибка создания таблицы entries:', err);
    else console.log('✓ Таблица entries готова');
  });

  // Таблица пользовательских настроек (видимость карточек и др.)
  db.run(`
    CREATE TABLE IF NOT EXISTS user_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      card_visibility TEXT DEFAULT '{"form":1,"history":1,"chart":1,"waterTracker":1,"waterChart":1}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) console.error('Ошибка создания таблицы user_settings:', err);
    else console.log('✓ Таблица user_settings готова');
  });

  // Таблица настроек воды
  db.run(`
    CREATE TABLE IF NOT EXISTS water_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      weight REAL,
      activity TEXT DEFAULT 'moderate',
      daily_goal INTEGER DEFAULT 2000,
      reset_time TEXT DEFAULT '00:00',
      quick_buttons TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) console.error('Ошибка создания таблицы water_settings:', err);
    else console.log('✓ Таблица water_settings готова');
  });

  // Таблица логов воды
  db.run(`
    CREATE TABLE IF NOT EXISTS water_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER,
      drink_type TEXT,
      logged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) console.error('Ошибка создания таблицы water_logs:', err);
    else console.log('✓ Таблица water_logs готова');
  });
  
  // Проверяем количество пользователей в БД
  db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
    if (err) console.error('Ошибка при подсчёте пользователей:', err);
    else console.log(`📊 В БД всего пользователей: ${row.count}`);
  });
});

// Middleware проверки токена
function authenticateToken(req, res, next) {
  const token = req.cookies.token;
  console.log('🔐 authenticateToken - token в cookies:', token ? 'да' : 'нет');
  if (!token) return res.status(401).json({ error: 'Требуется вход' });
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.error('❌ JWT ошибка:', err.message);
      return res.status(403).json({ error: 'Невалидный токен' });
    }
    console.log('✓ JWT успешно декодирован - userId:', user.id);
    req.userId = user.id;
    req.username = user.username;
    next();
  });
}

// Маршруты

// Регистрация
app.post('/api/signup', async (req, res) => {
  const { username, email, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username и пароль обязательны' });
  }
  
  if (password.length < 4) {
    return res.status(400).json({ error: 'Пароль должен быть не менее 4 символов' });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      [username, email || null, hashedPassword],
      function(err) {
        if (err) {
          console.error('DB Error:', err.message);
          if (err.message.includes('UNIQUE')) {
            return res.status(409).json({ error: 'Пользователь уже существует' });
          }
          return res.status(500).json({ error: 'Ошибка при создании пользователя' });
        }
        
        const token = jwt.sign({ id: this.lastID, username }, JWT_SECRET, { expiresIn: '30d' });
        res.cookie('token', token, {
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
          maxAge: 30 * 24 * 60 * 60 * 1000,
          path: '/'
        });
        
        res.json({
          message: 'Аккаунт создан!',
          user: { id: this.lastID, username }
        });
      }
    );
  } catch (err) {
    console.error('Signup Error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Логин
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username и пароль обязательны' });
  }
  
  db.get(
    'SELECT id, username, password_hash FROM users WHERE username = ?',
    [username],
    async (err, user) => {
      if (err || !user) {
        return res.status(401).json({ error: 'Пользователь не найден' });
      }
      
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Неверный пароль' });
      }
      
      const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
      res.cookie('token', token, {
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: '/'
      });
      
      res.json({
        message: 'Вошли успешно!',
        user: { id: user.id, username: user.username }
      });
    }
  );
});

// Выход
app.post('/api/logout', (req, res) => {
  res.clearCookie('token', { path: '/' });
  res.json({ message: 'До свидания!' });
});

// Удалить аккаунт пользователя
app.post('/api/delete-account', authenticateToken, (req, res) => {
  try {
    // Удаляем все записи пользователя
    db.run('DELETE FROM entries WHERE user_id = ?', [req.userId]);
    
    // Удаляем настройки воды
    db.run('DELETE FROM water_settings WHERE user_id = ?', [req.userId]);

    // Удаляем пользовательские настройки
    db.run('DELETE FROM user_settings WHERE user_id = ?', [req.userId]);
    
    // Удаляем логи воды
    db.run('DELETE FROM water_logs WHERE user_id = ?', [req.userId]);
    
    // Удаляем самого пользователя
    db.run('DELETE FROM users WHERE id = ?', [req.userId], (err) => {
      if (err) return res.status(500).json({ error: 'Ошибка удаления' });
      
      // Очищаем cookies
      res.clearCookie('token', { path: '/' });
      res.json({ message: 'Аккаунт удален' });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получить текущего пользователя
app.get('/api/me', authenticateToken, (req, res) => {
  res.json({ id: req.userId, username: req.username });
});

const DEFAULT_CARD_VISIBILITY = {
  form: true,
  history: true,
  chart: true,
  waterTracker: true,
  waterChart: true,
  lastResult: true
};

function parseCardVisibility(raw) {
  if (!raw) return { ...DEFAULT_CARD_VISIBILITY };
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      form: parsed.form !== false,
      history: parsed.history !== false,
      chart: parsed.chart !== false,
      waterTracker: parsed.waterTracker !== false,
      waterChart: parsed.waterChart !== false,
      lastResult: parsed.lastResult !== false
    };
  } catch (e) {
    console.warn('Не удалось распарсить card_visibility, использую дефолт:', e.message);
    return { ...DEFAULT_CARD_VISIBILITY };
  }
}

// Получить настройки пользователя
app.get('/api/user-settings', authenticateToken, (req, res) => {
  db.get('SELECT card_visibility FROM user_settings WHERE user_id = ?', [req.userId], (err, row) => {
    if (err) {
      console.error('Ошибка чтения user_settings:', err.message);
      return res.status(500).json({ error: 'Ошибка БД' });
    }
    const cardVisibility = row ? parseCardVisibility(row.card_visibility) : { ...DEFAULT_CARD_VISIBILITY };
    res.json({ card_visibility: cardVisibility });
  });
});

// Обновить настройки пользователя
app.post('/api/user-settings', authenticateToken, (req, res) => {
  const incoming = req.body?.card_visibility || {};
  const cardVisibility = {
    form: incoming.form !== false,
    history: incoming.history !== false,
    chart: incoming.chart !== false,
    waterTracker: incoming.waterTracker !== false,
    waterChart: incoming.waterChart !== false,
    lastResult: incoming.lastResult !== false
  };

  const serialized = JSON.stringify(cardVisibility);

  db.run(
    `INSERT INTO user_settings (user_id, card_visibility, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET card_visibility = excluded.card_visibility, updated_at = CURRENT_TIMESTAMP`,
    [req.userId, serialized],
    function(err) {
      if (err) {
        console.error('Ошибка сохранения user_settings:', err.message);
        return res.status(500).json({ error: 'Ошибка БД' });
      }
      res.json({ card_visibility: cardVisibility });
    }
  );
});

// Получить историю пользователя
app.get('/api/history', authenticateToken, (req, res) => {
  db.all(
    'SELECT id, sex, height, neck, waist, hip, bf, `group`, timestamp FROM entries WHERE user_id = ? ORDER BY timestamp DESC',
    [req.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Ошибка БД' });

      // SQLite CURRENT_TIMESTAMP возвращает UTC без таймзоны, помечаем как UTC и отдаём ISO
      const normalized = (rows || []).map(r => ({
        ...r,
        timestamp: r.timestamp ? new Date(`${r.timestamp}Z`).toISOString() : new Date().toISOString()
      }));

      res.json(normalized);
    }
  );
});

// Добавить запись
app.post('/api/history', authenticateToken, (req, res) => {
  const { sex, height, neck, waist, hip, bf, group } = req.body;
  
  db.run(
    'INSERT INTO entries (user_id, sex, height, neck, waist, hip, bf, \`group\`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [req.userId, sex, height, neck, waist, hip, bf, group],
    function(err) {
      if (err) return res.status(500).json({ error: 'Ошибка БД' });
      const result = {
        id: this.lastID,
        sex, height, neck, waist, hip, bf, group,
        timestamp: new Date().toISOString()
      };
      res.json(result);
      
      // Отправляем уведомление всем подключённым клиентам этого пользователя
      notifyUserUpdate(req.userId, 'entryAdded', result);
    }
  );
});

// Удалить запись
app.delete('/api/history/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  
  db.run(
    'DELETE FROM entries WHERE id = ? AND user_id = ?',
    [id, req.userId],
    function(err) {
      if (err) return res.status(500).json({ error: 'Ошибка БД' });
      if (this.changes === 0) return res.status(404).json({ error: 'Запись не найдена' });
      res.json({ message: 'Удалено' });
      
      // Отправляем уведомление всем подключённым клиентам этого пользователя
      notifyUserUpdate(req.userId, 'entryDeleted', { id: parseInt(id) });
    }
  );
});

// Смена пароля
app.post('/api/change-password', authenticateToken, async (req, res) => {
  const currentPassword = req.body?.currentPassword?.trim() || '';
  const newPassword = req.body?.newPassword?.trim() || '';
  console.log('🔑 Смена пароля - req.userId:', req.userId, 'req.username:', req.username);
  console.log('🔑 currentPassword длина:', currentPassword.length, 'newPassword длина:', newPassword.length);
  
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Все поля обязательны' });
  }
  
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'Новый пароль должен быть не менее 4 символов' });
  }
  
  try {
    // Получаем текущий хеш пароля
    const user = await new Promise((resolve, reject) => {
      db.get(
        'SELECT password_hash FROM users WHERE id = ?',
        [req.userId],
        (err, row) => {
          console.log('📋 Поиск пользователя по id:', req.userId, '- результат:', row ? 'найден' : 'НЕ найден');
          if (row) console.log('📋 password_hash найден, первые 20 символов:', row.password_hash?.substring(0, 20));
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
    
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    // Проверяем текущий пароль
    console.log('🔐 Сравниваю пароль...');
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    console.log('🔐 Результат bcrypt.compare:', valid);
    if (!valid) {
      console.log('❌ Текущий пароль неверный!');
      return res.status(401).json({ error: 'Текущий пароль неверный' });
    }
    
    // Хешируем новый пароль
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Обновляем пароль
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE users SET password_hash = ? WHERE id = ?',
        [hashedPassword, req.userId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    
    res.json({ message: 'Пароль успешно изменён!' });
  } catch (err) {
    console.error('Ошибка смены пароля:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ===== API ВОДА =====
// Получить настройки воды пользователя
app.get('/api/water-settings', authenticateToken, (req, res) => {
  db.get('SELECT * FROM water_settings WHERE user_id = ?', [req.userId], (err, row) => {
    if (err) return res.status(500).json({ error: 'Ошибка БД' });
    if (!row) {
      // Если нет настроек, создаём значения по умолчанию
      return res.json({
        weight: 70,
        activity: 'moderate',
        daily_goal: 2000,
        reset_time: '00:00',
        quick_buttons: [
          { name: '💧 Вода 500мл', amount: 500 },
          { name: '🥤 Сок 250мл', amount: 250 },
          { name: '☕ Кофе 200мл', amount: 200 }
        ]
      });
    }
    res.json({
      ...row,
      quick_buttons: JSON.parse(row.quick_buttons || '[]')
    });
  });
});

// Сохранить настройки воды
app.post('/api/water-settings', authenticateToken, (req, res) => {
  const { weight, activity, daily_goal, reset_time, quick_buttons } = req.body;
  
  db.run(
    `INSERT INTO water_settings (user_id, weight, activity, daily_goal, reset_time, quick_buttons)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
     weight = ?, activity = ?, daily_goal = ?, reset_time = ?, quick_buttons = ?, updated_at = CURRENT_TIMESTAMP`,
    [
      req.userId, weight, activity, daily_goal, reset_time, JSON.stringify(quick_buttons),
      weight, activity, daily_goal, reset_time, JSON.stringify(quick_buttons)
    ],
    (err) => {
      if (err) return res.status(500).json({ error: 'Ошибка сохранения' });
      res.json({ message: 'Настройки сохранены' });
    }
  );
});

// Получить логи воды за сегодня
app.get('/api/water-logs', authenticateToken, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const query = `
    SELECT id, amount, drink_type, logged_at 
    FROM water_logs 
    WHERE user_id = ? AND DATE(logged_at) = ?
    ORDER BY logged_at DESC
  `;
  
  db.all(query, [req.userId, today], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Ошибка БД' });
    res.json(rows || []);
  });
});

// Добавить лог воды
app.post('/api/water-logs', authenticateToken, (req, res) => {
  const { amount, drink_type } = req.body;
  
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Некорректное количество' });
  }
  
  db.run(
    'INSERT INTO water_logs (user_id, amount, drink_type) VALUES (?, ?, ?)',
    [req.userId, amount, drink_type || 'вода'],
    function(err) {
      if (err) return res.status(500).json({ error: 'Ошибка сохранения' });
      const payload = {
        id: this.lastID,
        amount, 
        drink_type: drink_type || 'вода',
        logged_at: new Date().toISOString()
      };
      res.json(payload);
      notifyUserUpdate(req.userId, 'waterAdded', payload);
    }
  );
});

// Удалить лог воды
app.delete('/api/water-logs/:id', authenticateToken, (req, res) => {
  db.run('DELETE FROM water_logs WHERE id = ? AND user_id = ?', [req.params.id, req.userId], function(err) {
    if (err) return res.status(500).json({ error: 'Ошибка удаления' });
    if (this.changes === 0) return res.status(404).json({ error: 'Лог не найден' });
    res.json({ message: 'Удалено' });
    notifyUserUpdate(req.userId, 'waterDeleted', { id: parseInt(req.params.id) });
  });
});

// Возвращаем фронт
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== WebSocket для реал-тайма =====
// Хранилище активных подключений: { userId: Set<WebSocket> }
const wsConnections = new Map();

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let userId = null;

  // При подключении ждём сообщение с userId из JWT
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'auth') {
        // Клиент отправляет userId при подключении
        userId = msg.userId;
        if (!wsConnections.has(userId)) {
          wsConnections.set(userId, new Set());
        }
        wsConnections.get(userId).add(ws);
        console.log(`WebSocket: пользователь ${userId} подключился. Всего подключений: ${wsConnections.get(userId).size}`);
        ws.send(JSON.stringify({ type: 'auth', status: 'ok' }));
      }
    } catch (e) {
      console.error('WebSocket сообщение:', e.message);
    }
  });

  ws.on('close', () => {
    if (userId && wsConnections.has(userId)) {
      wsConnections.get(userId).delete(ws);
      console.log(`WebSocket: пользователь ${userId} отключился. Осталось подключений: ${wsConnections.get(userId).size}`);
      if (wsConnections.get(userId).size === 0) {
        wsConnections.delete(userId);
      }
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket ошибка:', err.message);
  });
});

// Функция для отправки обновления всем клиентам пользователя
function notifyUserUpdate(userId, updateType, data) {
  if (wsConnections.has(userId)) {
    const message = JSON.stringify({ type: 'update', updateType, data });
    wsConnections.get(userId).forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }
}

// API для получения данных о потреблении воды за разные периоды
app.get('/api/water-logs/period', authenticateToken, (req, res) => {
  const { period } = req.query; // 'day', 'week', 'month', 'year'
  let startDate;
  const now = new Date();

  switch (period) {
    case 'day':
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 1);
      break;
    case 'week':
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 7);
      break;
    case 'month':
      startDate = new Date(now);
      startDate.setMonth(now.getMonth() - 1);
      break;
    case 'year':
      startDate = new Date(now);
      startDate.setFullYear(now.getFullYear() - 1);
      break;
    default:
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 1);
  }

  const query = `
    SELECT id, amount, drink_type, logged_at
    FROM water_logs
    WHERE user_id = ? AND logged_at >= ?
    ORDER BY logged_at DESC
  `;

  db.all(query, [req.userId, startDate.toISOString()], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Ошибка БД' });
    res.json(rows || []);
  });
});

server.listen(PORT, () => {
  console.log(`Сервер слушает http://localhost:${PORT}`);
});
