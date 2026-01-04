const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Ошибка подключения к БД:', err.message);
    process.exit(1);
  }
  console.log('✓ БД подключена');
});

// Проверяем структуру таблицы visits
db.all("PRAGMA table_info(visits)", (err, columns) => {
  if (err) {
    console.error('Ошибка проверки структуры:', err);
  } else {
    console.log('\n📋 Структура таблицы visits:');
    columns.forEach(col => {
      console.log(`  - ${col.name} (${col.type}) ${col.notnull ? 'NOT NULL' : ''}`);
    });
  }
  
  // Проверяем количество записей
  db.get('SELECT COUNT(*) as total, SUM(CASE WHEN is_anonymous = 0 THEN 1 ELSE 0 END) as registered, SUM(CASE WHEN is_anonymous = 1 THEN 1 ELSE 0 END) as anonymous FROM visits', (err, row) => {
    if (err) {
      console.error('Ошибка подсчёта:', err);
    } else {
      console.log('\n📊 Статистика посещений:');
      console.log(`  Всего: ${row.total || 0}`);
      console.log(`  Зарегистрированных: ${row.registered || 0}`);
      console.log(`  Анонимных: ${row.anonymous || 0}`);
    }
    
    // Показываем последние 5 посещений
    db.all('SELECT * FROM visits ORDER BY visited_at DESC LIMIT 5', (err, rows) => {
      if (err) {
        console.error('Ошибка выборки:', err);
      } else {
        console.log('\n🔍 Последние 5 посещений:');
        if (rows.length === 0) {
          console.log('  Нет записей');
        } else {
          rows.forEach(row => {
            const userInfo = row.user_id ? `user_id=${row.user_id}` : 'анонимный';
            console.log(`  [${row.visited_at}] ${userInfo} (is_anonymous=${row.is_anonymous})`);
          });
        }
      }
      db.close();
    });
  });
});
