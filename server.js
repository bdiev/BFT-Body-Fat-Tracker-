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
  
  // Логируем посещение любой страницы сайта (GET запросы, кроме API)
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    console.log('🔔 GET ' + req.path + ' обнаружен - будет залогирован визит');
    setImmediate(() => {
      const token = req.cookies.token;
      console.log('   Token существует:', !!token);
      if (token) {
        jwt.verify(token, JWT_SECRET, (err, user) => {
          if (!err && user) {
            console.log('   Вызываем logVisit с user.id:', user.id);
            logVisit(user.id, 0);
          } else {
            console.log('   JWT ошибка или нет user - вызываем logVisit(null, 1)');
            logVisit(null, 1);
          }
        });
      } else {
        console.log('   Нет токена - вызываем logVisit(null, 1)');
        logVisit(null, 1);
      }
    });
  }
  
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
      gender TEXT DEFAULT 'male',
      is_admin INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) console.error('Ошибка создания таблицы users:', err);
    else {
      console.log('✓ Таблица users готова');
      
      // Проверяем, существует ли поле is_admin и gender (для миграции существующих БД)
      db.all("PRAGMA table_info(users)", (err, columns) => {
        if (err) {
          console.error('Ошибка проверки структуры таблицы users:', err);
          return;
        }
        
        const hasIsAdmin = columns.some(col => col.name === 'is_admin');
        const hasGender = columns.some(col => col.name === 'gender');
        
        let migrationsCompleted = 0;
        let migrationsNeeded = (hasIsAdmin ? 0 : 1) + (hasGender ? 0 : 1);
        
        const checkAndFinalizeMigration = () => {
          migrationsCompleted++;
          if (migrationsCompleted === migrationsNeeded || migrationsNeeded === 0) {
            // Проверяем количество пользователей в БД
            db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
              if (err) console.error('Ошибка при подсчёте пользователей:', err);
              else console.log(`📊 В БД всего пользователей: ${row.count}`);
            });
            
            // Автоматически делаем пользователя "Admin" администратором
            db.run("UPDATE users SET is_admin = 1 WHERE username = 'Admin'", function(err) {
              if (err) console.error('Ошибка при назначении прав администратора:', err);
              else if (this.changes > 0) console.log('✓ Пользователь "Admin" получил права администратора');
            });
          }
        };
        
        if (!hasIsAdmin) {
          console.log('Миграция: добавляем поле is_admin...');
          db.run("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0", (err) => {
            if (err) console.error('Ошибка миграции is_admin:', err);
            else console.log('✓ Поле is_admin добавлено');
            checkAndFinalizeMigration();
          });
        }
        
        if (!hasGender) {
          console.log('Миграция: добавляем поле gender...');
          db.run("ALTER TABLE users ADD COLUMN gender TEXT DEFAULT 'male'", (err) => {
            if (err) console.error('Ошибка миграции gender:', err);
            else console.log('✓ Поле gender добавлено');
            checkAndFinalizeMigration();
          });
        }
        
        if (migrationsNeeded === 0) {
          checkAndFinalizeMigration();
        }
      });
    }
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
      card_visibility TEXT DEFAULT '{"form":1,"history":1,"chart":1,"waterTracker":1,"waterChart":1,"weightTracker":1}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) console.error('Ошибка создания таблицы user_settings:', err);
    else console.log('✓ Таблица user_settings готова');
    
    // Миграция: добавить card_order если его нет
    db.run(`ALTER TABLE user_settings ADD COLUMN card_order TEXT`, (err) => {
      if (err && !err.message.includes('duplicate column')) {
        console.error('Ошибка добавления card_order:', err);
      } else if (!err) {
        console.log('✓ Добавлена колонка card_order');
      }
    });
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

  // Таблица логов веса
  db.run(`
    CREATE TABLE IF NOT EXISTS weight_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      weight REAL NOT NULL,
      logged_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) console.error('Ошибка создания таблицы weight_logs:', err);
    else console.log('✓ Таблица weight_logs готова');
  });

  // Таблица логов посещений
  db.run(`
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      is_anonymous INTEGER DEFAULT 1,
      visited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      user_agent TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) console.error('Ошибка создания таблицы visits:', err);
    else console.log('✓ Таблица visits готова');
  });

  // Проверяем, существует ли таблица visits и её структура
  setTimeout(() => {
    db.all("PRAGMA table_info(visits)", (err, columns) => {
      if (err) {
        console.error('Ошибка проверки структуры visits:', err);
        return;
      }
      
      if (!columns || columns.length === 0) {
        console.warn('⚠️ Таблица visits не существует! Пересоздаём...');
        db.run(`
          CREATE TABLE visits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            is_anonymous INTEGER DEFAULT 1,
            visited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            user_agent TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          )
        `, (err) => {
          if (err) console.error('Ошибка пересоздания таблицы visits:', err);
          else console.log('✓ Таблица visits успешно пересоздана');
        });
      } else {
        console.log('✓ Таблица visits существует с' + columns.length + ' колонками');
      }
    });
  }, 1000);
});

// ===== ФУНКЦИЯ ЛОГИРОВАНИЯ ПОСЕЩЕНИЙ =====
function logVisit(userId = null, isAnonymous = true) {
  try {
    console.log(`📝 logVisit вызвана: userId=${userId}, isAnonymous=${isAnonymous}`);
    const query = `INSERT INTO visits (user_id, is_anonymous) VALUES (?, ?)`;
    const params = [userId || null, isAnonymous ? 1 : 0];
    console.log(`   SQL: ${query}`);
    console.log(`   Параметры: [${params.join(', ')}]`);
    
    db.run(query, params, function(err) {
      if (err) {
        console.error('❌ Ошибка логирования посещения:', err.message);
        console.error('   Полная ошибка:', err);
        // Пытаемся пересоздать таблицу если её нет
        if (err.message.includes('no such table')) {
          console.warn('⚠️ Таблица visits не существует! Создаём её...');
          db.run(`
            CREATE TABLE IF NOT EXISTS visits (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER,
              is_anonymous INTEGER DEFAULT 1,
              visited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              user_agent TEXT,
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
          `, (createErr) => {
            if (createErr) {
              console.error('Ошибка создания таблицы visits:', createErr);
            } else {
              console.log('✓ Таблица visits создана');
              // Повторяем попытку логирования
              db.run(query, params, (retryErr) => {
                if (retryErr) {
                  console.error('❌ Ошибка логирования посещения после пересоздания:', retryErr);
                } else {
                  console.log(`✓ Посещение залогировано (retry): user_id=${userId}, anonymous=${isAnonymous}`);
                }
              });
            }
          });
        }
      } else {
        console.log(`✅ УСПЕШНО! Посещение залогировано: user_id=${userId}, anonymous=${isAnonymous}`);
      }
    });
  } catch (err) {
    console.error('❌ Критическая ошибка в logVisit:', err.message);
    console.error('   Stack:', err.stack);
  }
}

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
  const { username, email, password, gender } = req.body;
  console.log('📝 signup: username:', username, 'gender:', gender, 'gender type:', typeof gender);
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username и пароль обязательны' });
  }
  
  if (password.length < 4) {
    return res.status(400).json({ error: 'Пароль должен быть не менее 4 символов' });
  }
  
  const userGender = gender === 'female' ? 'female' : 'male';
  console.log('✓ userGender установлен:', userGender);
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run(
      'INSERT INTO users (username, email, password_hash, gender) VALUES (?, ?, ?, ?)',
      [username, email || null, hashedPassword, userGender],
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
          user: { id: this.lastID, username, isAdmin: false, gender: userGender }
        });
        
        // Уведомляем админов о новой регистрации
        notifyAdmins('userRegistered', {
          id: this.lastID,
          username,
          email: email || null,
          gender: userGender
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
    'SELECT id, username, password_hash, is_admin, gender FROM users WHERE username = ?',
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
        user: { id: user.id, username: user.username, isAdmin: !!user.is_admin, gender: user.gender }
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
  db.get('SELECT is_admin, gender FROM users WHERE id = ?', [req.userId], (err, row) => {
    if (err) return res.status(500).json({ error: 'Ошибка БД' });
    res.json({ 
      id: req.userId, 
      username: req.username, 
      isAdmin: row ? !!row.is_admin : false, 
      gender: row ? (row.gender || 'male') : 'male'
    });
  });
});

const DEFAULT_CARD_VISIBILITY = {
  form: true,
  history: true,
  chart: true,
  waterTracker: true,
  waterChart: true,
  weightTracker: true,
  lastResult: true,
  restTimer: true
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
      weightTracker: parsed.weightTracker !== false,
      lastResult: parsed.lastResult !== false,
      restTimer: parsed.restTimer !== false
    };
  } catch (e) {
    console.warn('Не удалось распарсить card_visibility, использую дефолт:', e.message);
    return { ...DEFAULT_CARD_VISIBILITY };
  }
}

// Получить настройки пользователя
app.get('/api/user-settings', authenticateToken, (req, res) => {
  db.get('SELECT card_visibility, card_order FROM user_settings WHERE user_id = ?', [req.userId], (err, row) => {
    if (err) {
      console.error('Ошибка чтения user_settings:', err.message);
      return res.status(500).json({ error: 'Ошибка БД' });
    }
    const cardVisibility = row ? parseCardVisibility(row.card_visibility) : { ...DEFAULT_CARD_VISIBILITY };
    const cardOrder = row && row.card_order ? JSON.parse(row.card_order) : null;
    res.json({ card_visibility: cardVisibility, card_order: cardOrder });
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
    weightTracker: incoming.weightTracker !== false,
    lastResult: incoming.lastResult !== false,
    restTimer: incoming.restTimer !== false
  };

  const cardOrder = req.body?.card_order || null;
  const serializedVisibility = JSON.stringify(cardVisibility);
  const serializedOrder = cardOrder ? JSON.stringify(cardOrder) : null;

  db.run(
    `INSERT INTO user_settings (user_id, card_visibility, card_order, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET 
       card_visibility = excluded.card_visibility, 
       card_order = excluded.card_order,
       updated_at = CURRENT_TIMESTAMP`,
    [req.userId, serializedVisibility, serializedOrder],
    function(err) {
      if (err) {
        console.error('Ошибка сохранения user_settings:', err.message);
        return res.status(500).json({ error: 'Ошибка БД' });
      }
      res.json({ card_visibility: cardVisibility, card_order: cardOrder });
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
      
      // Уведомляем админов
      notifyAdmins('entryAdded', { userId: req.userId });
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

// Изменение пола пользователя
app.post('/api/change-gender', authenticateToken, async (req, res) => {
  const { gender } = req.body;
  console.log('⚧️ Смена пола - req.userId:', req.userId, 'новый gender:', gender);
  
  if (!gender || (gender !== 'male' && gender !== 'female')) {
    return res.status(400).json({ error: 'Некорректное значение пола' });
  }
  
  try {
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE users SET gender = ? WHERE id = ?',
        [gender, req.userId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    
    console.log('✓ Пол успешно обновлен на:', gender);
    res.json({ message: 'Пол успешно изменён!', gender });
  } catch (err) {
    console.error('Ошибка смены пола:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ===== ФУНКЦИЯ РАСЧЕТА ДНЕВНОЙ НОРМЫ ВОДЫ =====
// Формула расчета:
// Для мужчин: вес (кг) * 35 мл + 500 мл (базовый минимум)
// Для женщин: вес (кг) * 31 мл + 300 мл (базовый минимум)
function calculateDailyWaterGoal(weight, gender, activity = 'moderate') {
  if (!weight || weight <= 0) return 2000; // Дефолт
  
  let baseAmount = 0;
  if (gender === 'female') {
    baseAmount = Math.round(weight * 31 + 300);
  } else {
    baseAmount = Math.round(weight * 35 + 500);
  }
  
  // Корректируем по уровню активности
  let multiplier = 1;
  switch (activity) {
    case 'sedentary':
      multiplier = 0.9;
      break;
    case 'light':
      multiplier = 1;
      break;
    case 'moderate':
      multiplier = 1.1;
      break;
    case 'active':
      multiplier = 1.2;
      break;
    case 'very_active':
      multiplier = 1.3;
      break;
    default:
      multiplier = 1;
  }
  
  return Math.round(baseAmount * multiplier);
}

// ===== API ВОДА =====
// Получить настройки воды пользователя
app.get('/api/water-settings', authenticateToken, (req, res) => {
  // Сначала получаем пол пользователя
  db.get('SELECT gender FROM users WHERE id = ?', [req.userId], (err, user) => {
    if (err) return res.status(500).json({ error: 'Ошибка БД' });
    
    const userGender = user && user.gender ? user.gender : 'male';
    
    db.get('SELECT * FROM water_settings WHERE user_id = ?', [req.userId], (err, row) => {
      if (err) return res.status(500).json({ error: 'Ошибка БД' });
      if (!row) {
        // Если нет настроек, создаём значения по умолчанию
        const defaultWeight = 70;
        const defaultGoal = calculateDailyWaterGoal(defaultWeight, userGender, 'moderate');
        
        return res.json({
          weight: defaultWeight,
          gender: userGender,
          activity: 'moderate',
          daily_goal: defaultGoal,
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
        gender: userGender,
        quick_buttons: JSON.parse(row.quick_buttons || '[]')
      });
    });
  });
});

// Сохранить настройки воды
app.post('/api/water-settings', authenticateToken, (req, res) => {
  const { weight, activity, daily_goal, reset_time, quick_buttons } = req.body;
  
  // Получаем пол пользователя для автоматического расчета цели если её не предоставили
  db.get('SELECT gender FROM users WHERE id = ?', [req.userId], (err, user) => {
    if (err) return res.status(500).json({ error: 'Ошибка БД' });
    
    const userGender = user && user.gender ? user.gender : 'male';
    // Если дневная цель не предоставлена или равна нулю, рассчитываем её
    const finalDailyGoal = (daily_goal && daily_goal > 0) 
      ? daily_goal 
      : calculateDailyWaterGoal(weight, userGender, activity);
    
    db.run(
      `INSERT INTO water_settings (user_id, weight, activity, daily_goal, reset_time, quick_buttons)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
       weight = ?, activity = ?, daily_goal = ?, reset_time = ?, quick_buttons = ?, updated_at = CURRENT_TIMESTAMP`,
      [
        req.userId, weight, activity, finalDailyGoal, reset_time, JSON.stringify(quick_buttons),
        weight, activity, finalDailyGoal, reset_time, JSON.stringify(quick_buttons)
      ],
      (err) => {
        if (err) return res.status(500).json({ error: 'Ошибка сохранения' });
        res.json({ 
          message: 'Настройки сохранены',
          daily_goal: finalDailyGoal 
        });
      }
    );
  });
});

// Получить логи воды за сегодня
app.get('/api/water-logs', authenticateToken, (req, res) => {
  const query = `
    SELECT id, amount, drink_type, logged_at 
    FROM water_logs 
    WHERE user_id = ?
    ORDER BY logged_at DESC
  `;
  
  db.all(query, [req.userId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Ошибка БД' });
    res.json(rows || []);
  });
});

// Добавить лог воды
app.post('/api/water-logs', authenticateToken, (req, res) => {
  const { amount, drink_type, logged_at } = req.body;
  
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Некорректное количество' });
  }
  
  // Используем время с клиента если передано, иначе серверное
  const finalLoggedAt = logged_at || new Date().toISOString();
  
  db.run(
    'INSERT INTO water_logs (user_id, amount, drink_type, logged_at) VALUES (?, ?, ?, ?)',
    [req.userId, amount, drink_type || 'вода', finalLoggedAt],
    function(err) {
      if (err) return res.status(500).json({ error: 'Ошибка сохранения' });
      const payload = {
        id: this.lastID,
        amount, 
        drink_type: drink_type || 'вода',
        logged_at: finalLoggedAt
      };
      res.json(payload);
      notifyUserUpdate(req.userId, 'waterAdded', payload);
      
      // Уведомляем админов
      notifyAdmins('waterAdded', { userId: req.userId });
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

// ===== МАРШРУТЫ ДЛЯ ТРЕКЕРА ВЕСА =====

// Получить логи веса
app.get('/api/weight-logs', authenticateToken, (req, res) => {
  db.all('SELECT * FROM weight_logs WHERE user_id = ? ORDER BY logged_at DESC LIMIT 100', [req.userId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Ошибка загрузки' });
    res.json(rows || []);
  });
});

// Добавить лог веса
app.post('/api/weight/add', authenticateToken, (req, res) => {
  const { weight } = req.body;
  
  if (!weight || weight <= 0) {
    return res.status(400).json({ error: 'Некорректный вес' });
  }
  
  const now = new Date().toISOString();
  db.run('INSERT INTO weight_logs (user_id, weight, logged_at) VALUES (?, ?, ?)', [req.userId, weight, now], function(err) {
    if (err) return res.status(500).json({ error: 'Ошибка сохранения' });
    
    const result = {
      success: true,
      id: this.lastID,
      weight,
      logged_at: now
    };
    
    res.json(result);
    notifyUserUpdate(req.userId, 'weightAdded', { id: this.lastID, weight, logged_at: now });
  });
});

// Получить логи веса за период
app.get('/api/weight-logs/period', authenticateToken, (req, res) => {
  const period = req.query.period || 'month';
  
  const now = new Date();
  let startDate;
  
  switch(period) {
    case 'week':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'month':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case 'year':
      startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  
  const startISO = startDate.toISOString();
  db.all('SELECT * FROM weight_logs WHERE user_id = ? AND logged_at >= ? ORDER BY logged_at ASC', [req.userId, startISO], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Ошибка загрузки' });
    res.json(rows || []);
  });
});

// Удалить лог веса
app.delete('/api/weight-logs/:id', authenticateToken, (req, res) => {
  db.run('DELETE FROM weight_logs WHERE id = ? AND user_id = ?', [req.params.id, req.userId], function(err) {
    if (err) return res.status(500).json({ error: 'Ошибка удаления' });
    if (this.changes === 0) return res.status(404).json({ error: 'Лог не найден' });
    res.json({ message: 'Удалено' });
    notifyUserUpdate(req.userId, 'weightDeleted', { id: parseInt(req.params.id) });
  });
});


// ===== ЛОГИРОВАНИЕ ПОСЕЩЕНИЙ =====

// Возвращаем фронт
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== АДМИН ПАНЕЛЬ API =====

// Middleware проверки прав администратора
function requireAdmin(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Требуется вход' });
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Невалидный токен' });
    
    db.get('SELECT is_admin FROM users WHERE id = ?', [user.id], (err, row) => {
      if (err || !row) return res.status(500).json({ error: 'Ошибка проверки прав' });
      if (!row.is_admin) return res.status(403).json({ error: 'Требуются права администратора' });
      
      req.userId = user.id;
      req.username = user.username;
      next();
    });
  });
}

// Получить список всех пользователей (только для админов)
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const query = `
    SELECT 
      u.id,
      u.username,
      u.email,
      u.gender,
      u.is_admin,
      u.created_at,
      COUNT(DISTINCT e.id) as entries_count,
      COUNT(DISTINCT w.id) as water_logs_count,
      COUNT(DISTINCT wl.id) as weight_logs_count
    FROM users u
    LEFT JOIN entries e ON u.id = e.user_id
    LEFT JOIN water_logs w ON u.id = w.user_id
    LEFT JOIN weight_logs wl ON u.id = wl.user_id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('Ошибка получения пользователей:', err);
      return res.status(500).json({ error: 'Ошибка БД' });
    }
    res.json(rows || []);
  });
});

// Получить детальную информацию о пользователе (только для админов)
app.get('/api/admin/users/:id', requireAdmin, (req, res) => {
  const userId = req.params.id;
  
  db.get(
    'SELECT id, username, email, gender, is_admin, created_at FROM users WHERE id = ?',
    [userId],
    (err, user) => {
      if (err) return res.status(500).json({ error: 'Ошибка БД' });
      if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
      
      // Получаем статистику
      db.get(
        `SELECT 
          COUNT(DISTINCT e.id) as entries_count,
          COUNT(DISTINCT w.id) as water_logs_count,
          MAX(e.timestamp) as last_entry,
          MAX(w.logged_at) as last_water_log
        FROM users u
        LEFT JOIN entries e ON u.id = e.user_id
        LEFT JOIN water_logs w ON u.id = w.user_id
        WHERE u.id = ?`,
        [userId],
        (err, stats) => {
          if (err) return res.status(500).json({ error: 'Ошибка БД' });
          res.json({ ...user, ...stats });
        }
      );
    }
  );
});

// Переключить статус администратора (только для админов)
app.post('/api/admin/users/:id/toggle-admin', requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  
  // Проверяем, не пытается ли админ отозвать права у самого себя
  if (userId === req.userId) {
    return res.status(400).json({ error: 'Нельзя изменить собственные права администратора' });
  }
  
  db.get('SELECT is_admin FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) return res.status(500).json({ error: 'Ошибка БД' });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    
    const newStatus = user.is_admin ? 0 : 1;
    
    db.run('UPDATE users SET is_admin = ? WHERE id = ?', [newStatus, userId], (err) => {
      if (err) return res.status(500).json({ error: 'Ошибка обновления' });
      res.json({ message: 'Статус обновлен', is_admin: newStatus });
      
      // Уведомляем админов об изменении прав
      notifyAdmins('adminToggled', {
        userId,
        is_admin: newStatus
      });
    });
  });
});

// Удалить пользователя (только для админов)
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  
  // Проверяем, не пытается ли админ удалить самого себя
  if (userId === req.userId) {
    return res.status(400).json({ error: 'Нельзя удалить собственный аккаунт через админ-панель' });
  }
  
  db.serialize(() => {
    db.run('DELETE FROM entries WHERE user_id = ?', [userId]);
    db.run('DELETE FROM water_settings WHERE user_id = ?', [userId]);
    db.run('DELETE FROM user_settings WHERE user_id = ?', [userId]);
    db.run('DELETE FROM water_logs WHERE user_id = ?', [userId]);
    db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
      if (err) return res.status(500).json({ error: 'Ошибка удаления' });
      if (this.changes === 0) return res.status(404).json({ error: 'Пользователь не найден' });
      res.json({ message: 'Пользователь удален' });
      
      // Уведомляем админов об удалении
      notifyAdmins('userDeleted', { userId });
    });
  });
});

// Сбросить пароль пользователя (только для админов)
app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.id);
  const { newPassword } = req.body;
  
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'Пароль должен быть не менее 4 символов' });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashedPassword, userId], function(err) {
      if (err) return res.status(500).json({ error: 'Ошибка обновления' });
      if (this.changes === 0) return res.status(404).json({ error: 'Пользователь не найден' });
      res.json({ message: 'Пароль сброшен' });
    });
  } catch (err) {
    console.error('Ошибка сброса пароля:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ===== ОТЛАДОЧНЫЙ ЭНДПОИНТ =====
app.get('/api/admin/debug-visits', requireAdmin, (req, res) => {
  console.log('🔍 Запрос отладки посещений...');
  
  // Проверяем структуру таблицы
  db.all("PRAGMA table_info(visits)", (err, columns) => {
    if (err) {
      return res.json({
        error: 'Ошибка при проверке структуры таблицы: ' + err.message,
        tableExists: false
      });
    }
    
    if (!columns || columns.length === 0) {
      return res.json({
        error: 'Таблица visits не существует',
        tableExists: false
      });
    }
    
    console.log('✓ Таблица visits существует');
    
    // Получаем все записи
    db.all('SELECT * FROM visits ORDER BY visited_at DESC LIMIT 10', (err, rows) => {
      if (err) {
        return res.json({
          tableExists: true,
          columns: columns,
          error: 'Ошибка при выборке данных: ' + err.message,
          records: []
        });
      }
      
      // Получаем статистику
      db.get('SELECT COUNT(*) as total, SUM(CASE WHEN is_anonymous = 0 THEN 1 ELSE 0 END) as registered, SUM(CASE WHEN is_anonymous = 1 THEN 1 ELSE 0 END) as anonymous FROM visits', (err, stats) => {
        const result = {
          tableExists: true,
          columns: columns,
          totalRecords: stats ? stats.total : 0,
          registeredCount: stats ? stats.registered : 0,
          anonymousCount: stats ? stats.anonymous : 0,
          lastRecords: rows || []
        };
        
        console.log('📊 Отладка посещений:', result);
        res.json(result);
      });
    });
  });
});

// Публичный API для логирования посещения (для PWA и динамических загрузок)
app.post('/api/log-visit', (req, res) => {
  console.log('📍 API запрос на логирование посещения');
  const token = req.cookies.token;
  
  if (token) {
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (!err && user) {
        console.log('   Логируем для user.id:', user.id);
        logVisit(user.id, 0);
      } else {
        console.log('   JWT ошибка - логируем как анонимное');
        logVisit(null, 1);
      }
      res.json({ success: true, message: 'Посещение залогировано' });
    });
  } else {
    console.log('   Нет токена - логируем как анонимное');
    logVisit(null, 1);
    res.json({ success: true, message: 'Посещение залогировано' });
  }
});

// Ручное логирование посещения (для отладки)
app.post('/api/admin/test-visit', requireAdmin, (req, res) => {
  console.log('🧪 Тестовое логирование посещения...');
  logVisit(req.userId, 0);
  
  // Проверяем результат
  setTimeout(() => {
    db.get('SELECT COUNT(*) as count FROM visits', (err, row) => {
      if (err) {
        res.json({
          success: false,
          error: err.message,
          totalRecords: 0
        });
      } else {
        res.json({
          success: true,
          message: 'Посещение залогировано',
          totalRecords: row ? row.count : 0
        });
      }
    });
  }, 100);
});

// Получить активность пользователей (статистика для админов)
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const queries = {
    totalUsers: 'SELECT COUNT(*) as count FROM users',
    totalEntries: 'SELECT COUNT(*) as count FROM entries',
    totalWaterLogs: 'SELECT COUNT(*) as count FROM water_logs',
    totalWeightLogs: 'SELECT COUNT(*) as count FROM weight_logs',
    adminCount: 'SELECT COUNT(*) as count FROM users WHERE is_admin = 1',
    recentUsers: `SELECT id, username, created_at FROM users ORDER BY created_at DESC LIMIT 5`,
  };
  
  const stats = {};
  
  db.get(queries.totalUsers, (err, row) => {
    if (err) return res.status(500).json({ error: 'Ошибка БД' });
    stats.totalUsers = row.count;
    
    db.get(queries.totalEntries, (err, row) => {
      if (err) return res.status(500).json({ error: 'Ошибка БД' });
      stats.totalEntries = row.count;
      
      db.get(queries.totalWaterLogs, (err, row) => {
        if (err) return res.status(500).json({ error: 'Ошибка БД' });
        stats.totalWaterLogs = row.count;
        
        db.get(queries.totalWeightLogs, (err, row) => {
          if (err) return res.status(500).json({ error: 'Ошибка БД' });
          stats.totalWeightLogs = row.count;
          
          db.get(queries.adminCount, (err, row) => {
            if (err) return res.status(500).json({ error: 'Ошибка БД' });
            stats.adminCount = row.count;
            
            db.all(queries.recentUsers, (err, rows) => {
              if (err) return res.status(500).json({ error: 'Ошибка БД' });
              stats.recentUsers = rows || [];
              
              // Получаем статистику по посещениям - ВСЕ В ОДНОМ ЗАПРОСЕ
              db.get(`
                SELECT 
                  COUNT(*) as totalVisits,
                  SUM(CASE WHEN is_anonymous = 0 THEN 1 ELSE 0 END) as registeredVisits,
                  SUM(CASE WHEN is_anonymous = 1 THEN 1 ELSE 0 END) as anonymousVisits
                FROM visits
              `, (err, row) => {
                if (err) {
                  console.error('Ошибка получения статистики посещений:', err);
                  stats.registeredVisits = 0;
                  stats.anonymousVisits = 0;
                  stats.totalVisits = 0;
                } else {
                  stats.totalVisits = (row && row.totalVisits) ? row.totalVisits : 0;
                  stats.registeredVisits = (row && row.registeredVisits) ? row.registeredVisits : 0;
                  stats.anonymousVisits = (row && row.anonymousVisits) ? row.anonymousVisits : 0;
                  console.log('✓ totalVisits:', stats.totalVisits);
                  console.log('✓ registeredVisits:', stats.registeredVisits);
                  console.log('✓ anonymousVisits:', stats.anonymousVisits);
                }
                console.log('📊 Отправляем stats:', stats);
                res.json(stats);
              });
            });
          });
        });
      });
    });
  });
});

// Проверить, является ли текущий пользователь админом
app.get('/api/admin/check', authenticateToken, (req, res) => {
  db.get('SELECT is_admin FROM users WHERE id = ?', [req.userId], (err, row) => {
    if (err) return res.status(500).json({ error: 'Ошибка БД' });
    res.json({ isAdmin: row ? !!row.is_admin : false });
  });
});

// ===== КОНЕЦ АДМИН ПАНЕЛЬ API =====


// ===== WebSocket для реал-тайма =====
// Хранилище активных подключений: { userId: Set<WebSocket> }
const wsConnections = new Map();
// Хранилище админских подключений
const adminConnections = new Set();

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let userId = null;
  let isAdmin = false;

  // При подключении ждём сообщение с userId из JWT
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'auth') {
        // Клиент отправляет userId при подключении
        userId = msg.userId;
        isAdmin = msg.isAdmin || false;
        
        if (!wsConnections.has(userId)) {
          wsConnections.set(userId, new Set());
        }
        wsConnections.get(userId).add(ws);
        
        if (isAdmin) {
          adminConnections.add(ws);
          console.log(`WebSocket: админ ${userId} подключился. Всего админов: ${adminConnections.size}`);
        } else {
          console.log(`WebSocket: пользователь ${userId} подключился. Всего подключений: ${wsConnections.get(userId).size}`);
        }
        
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
    if (isAdmin) {
      adminConnections.delete(ws);
      console.log(`WebSocket: админ отключился. Осталось админов: ${adminConnections.size}`);
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

// Функция для отправки уведомлений всем администраторам
function notifyAdmins(updateType, data) {
  if (adminConnections.size === 0) return;
  
  const message = JSON.stringify({ 
    type: 'adminUpdate', 
    updateType, 
    data,
    userId: data.userId || data.id,
    timestamp: new Date().toISOString()
  });
  
  console.log(`📢 Уведомляем ${adminConnections.size} админов: ${updateType}`);
  
  adminConnections.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
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
  console.log('💡 Консольные команды:');
  console.log('   op <login> - дать права администратора');
  console.log('   deop <login> - забрать права администратора');
});

// ===== КОНСОЛЬНЫЕ КОМАНДЫ =====
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> '
});

rl.on('line', (line) => {
  const input = line.trim();
  const parts = input.split(/\s+/);
  const command = parts[0];
  const username = parts[1];

  if (command === 'op' && username) {
    // Дать права администратора
    db.get('SELECT id, username, is_admin FROM users WHERE username = ?', [username], (err, user) => {
      if (err) {
        console.log('❌ Ошибка БД:', err.message);
        rl.prompt();
        return;
      }
      if (!user) {
        console.log(`❌ Пользователь "${username}" не найден`);
        rl.prompt();
        return;
      }
      if (user.is_admin) {
        console.log(`⚠️  Пользователь "${username}" уже является администратором`);
        rl.prompt();
        return;
      }

      db.run('UPDATE users SET is_admin = 1 WHERE id = ?', [user.id], function(err) {
        if (err) {
          console.log('❌ Ошибка обновления:', err.message);
          rl.prompt();
          return;
        }
        console.log(`✅ Пользователь "${username}" получил права администратора`);
        
        // Отправляем уведомление пользователю в реал-тайме
        notifyUserUpdate(user.id, 'adminRightsGranted', { 
          message: '🎉 Вам предоставлены права администратора!',
          isAdmin: true 
        });
        
        rl.prompt();
      });
    });
  } else if (command === 'deop' && username) {
    // Забрать права администратора
    db.get('SELECT id, username, is_admin FROM users WHERE username = ?', [username], (err, user) => {
      if (err) {
        console.log('❌ Ошибка БД:', err.message);
        rl.prompt();
        return;
      }
      if (!user) {
        console.log(`❌ Пользователь "${username}" не найден`);
        rl.prompt();
        return;
      }
      if (!user.is_admin) {
        console.log(`⚠️  Пользователь "${username}" не является администратором`);
        rl.prompt();
        return;
      }

      db.run('UPDATE users SET is_admin = 0 WHERE id = ?', [user.id], function(err) {
        if (err) {
          console.log('❌ Ошибка обновления:', err.message);
          rl.prompt();
          return;
        }
        console.log(`✅ У пользователя "${username}" забраны права администратора`);
        
        // Отправляем уведомление пользователю в реал-тайме
        notifyUserUpdate(user.id, 'adminRightsRevoked', { 
          message: '⚠️ Ваши права администратора были отозваны',
          isAdmin: false 
        });
        
        rl.prompt();
      });
    });
  } else if (command === 'help' || command === '?') {
    console.log('💡 Доступные команды:');
    console.log('   op <login>   - дать права администратора пользователю');
    console.log('   deop <login> - забрать права администратора у пользователя');
    console.log('   help         - показать эту справку');
    rl.prompt();
  } else if (input) {
    console.log(`❌ Неизвестная команда: "${command}". Используй "help" для справки.`);
    rl.prompt();
  } else {
    rl.prompt();
  }
});

rl.prompt();
