#!/usr/bin/env node

// Простой тест для проверки работы API
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/admin/stats',
  method: 'GET',
  headers: {
    'Cookie': 'token=invalid' // Попробуем без валидного токена
  }
};

const req = http.request(options, (res) => {
  console.log(`Статус: ${res.statusCode}`);
  console.log('Заголовки:', res.headers);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('\nОтвет API:');
    try {
      const json = JSON.parse(data);
      console.log(JSON.stringify(json, null, 2));
      
      if (json.totalVisits !== undefined) {
        console.log('\n✓ API возвращает поле totalVisits');
      } else {
        console.log('\n❌ API НЕ возвращает поле totalVisits');
        console.log('Имеющиеся поля:', Object.keys(json));
      }
    } catch (e) {
      console.log(data);
      console.error('\n❌ Ошибка парсинга JSON:', e.message);
    }
  });
});

req.on('error', (e) => {
  console.error(`Ошибка запроса: ${e.message}`);
  console.error('Убедитесь что сервер запущен на http://localhost:3000');
});

req.end();
