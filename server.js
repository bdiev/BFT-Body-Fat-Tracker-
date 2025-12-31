const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.use(cookieParser());
app.use(cors({
  origin: function (origin, callback) {
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type']
}));

// Инициализация БД
const db = new sqlite3.Database(path.join(__dirname, 'database.db'), (err) => {
  if (err) console.error('Ошибка БД:', err);
  else console.log('SQLite БД подключена');
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
  `);
  
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
  `);
});

// Middleware проверки токена
function authenticateToken(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Требуется вход' });
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Невалидный токен' });
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
  
  const hashedPassword = await bcrypt.hash(password, 10);
  
  db.run(
    'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
    [username, email || null, hashedPassword],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(409).json({ error: 'Пользователь уже существует' });
        }
        return res.status(500).json({ error: 'Ошибка БД' });
      }
      
      const token = jwt.sign({ id: this.lastID, username }, JWT_SECRET, { expiresIn: '30d' });
      res.cookie('token', token, {
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
        maxAge: 30 * 24 * 60 * 60 * 1000
      });
      
      res.json({
        message: 'Аккаунт создан!',
        user: { id: this.lastID, username }
      });
    }
  );
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
        maxAge: 30 * 24 * 60 * 60 * 1000
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
  res.clearCookie('token');
  res.json({ message: 'До свидания!' });
});

// Получить текущего пользователя
app.get('/api/me', authenticateToken, (req, res) => {
  res.json({ id: req.userId, username: req.username });
});

// Получить историю пользователя
app.get('/api/history', authenticateToken, (req, res) => {
  db.all(
    'SELECT id, sex, height, neck, waist, hip, bf, \`group\`, timestamp FROM entries WHERE user_id = ? ORDER BY timestamp DESC',
    [req.userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Ошибка БД' });
      res.json(rows || []);
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
      res.json({
        id: this.lastID,
        sex, height, neck, waist, hip, bf, group,
        timestamp: new Date().toISOString()
      });
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
    }
  );
});

// Смена пароля
app.post('/api/change-password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Все поля обязательны' });
  }
  
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'Новый пароль должен быть не менее 4 символов' });
  }
  
  db.get(
    'SELECT password_hash FROM users WHERE id = ?',
    [req.userId],
    async (err, user) => {
      if (err || !user) return res.status(500).json({ error: 'Ошибка БД' });
      
      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Текущий пароль неверный' });
      
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      db.run(
        'UPDATE users SET password_hash = ? WHERE id = ?',
        [hashedPassword, req.userId],
        (err) => {
          if (err) return res.status(500).json({ error: 'Ошибка БД' });
          res.json({ message: 'Пароль изменён!' });
        }
      );
    }
  );
});

// Возвращаем фронт
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Сервер слушает http://localhost:${PORT}`);
});
