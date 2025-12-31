# Развёртывание Body Fat Tracker с базой данных на VPS

## 1. Подготовка на локальной машине

### Скопируйте все файлы на VPS через SSH:

```bash
scp -r /path/to/BFT-Body-Fat-Tracker user@your-vps-ip:/path/to/deployment
```

Или используйте SFTP/FTP для загрузки:
- `server.js` - Node.js бэкенд
- `package.json` - зависимости
- `index.html`, `app.js`, `style.css`, `service-worker.js` - фронтенд
- `manifest.json`, `icons/` - PWA файлы

## 2. На VPS (SSH подключение)

### 2.1 Установите Node.js и npm (если не установлены)

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
```

### 2.2 Перейдите в папку проекта

```bash
cd /path/to/deployment
```

### 2.3 Установите зависимости

```bash
npm install
```

Это установит:
- `express` - веб-фреймворк
- `sqlite3` - база данных
- `bcryptjs` - хеширование паролей
- `jsonwebtoken` - токены авторизации
- `cookie-parser` - работа с cookies
- `cors` - кросс-доменные запросы

### 2.4 Создайте `.env` файл (опционально, для безопасности)

```bash
cat > .env << 'EOF'
PORT=3000
JWT_SECRET=your-super-secret-key-change-this-in-production
NODE_ENV=production
EOF
```

## 3. Запуск сервера

### Вариант A: Простой запуск (для тестирования)

```bash
node server.js
```

Сервер запустится на `http://localhost:3000`

### Вариант B: Использование PM2 (для production)

```bash
npm install -g pm2
pm2 start server.js --name "body-fat-tracker"
pm2 save
pm2 startup
```

Проверьте статус:
```bash
pm2 status
pm2 logs body-fat-tracker
```

## 4. Настройка Nginx (reverse proxy)

Отредактируйте конфиг Nginx для вашего домена:

```bash
sudo nano /etc/nginx/sites-available/yourdomain.com
```

Добавьте (или измените существующий блок):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name yourdomain.com www.yourdomain.com;

    # Редирект на HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    # Сертификаты Let's Encrypt
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # Статические файлы (HTML, CSS, JS)
    location / {
        root /path/to/deployment;
        try_files $uri $uri/ /index.html;
    }

    # API (проксируем на Node.js)
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Cookies
        proxy_cookie_path / /;
    }
}
```

Активируйте конфиг:

```bash
sudo ln -s /etc/nginx/sites-available/yourdomain.com /etc/nginx/sites-enabled/yourdomain.com
sudo nginx -t
sudo systemctl reload nginx
```

## 5. HTTPS (Let's Encrypt)

Если ещё не установлены сертификаты:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Certbot автоматически обновится через cron.

## 6. Проверка работы

### Локально на VPS:

```bash
# Проверить API
curl -X POST http://localhost:3000/api/signup \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"1234"}'

# Проверить статический файл
curl https://yourdomain.com/
```

### Через браузер:

1. Откройте `https://yourdomain.com`
2. Нажмите "Создать аккаунт"
3. Введите username, email (опционально) и пароль
4. После регистрации ваши данные будут в БД на VPS
5. История и расчёты сохранятся в БД

## 7. Резервная копия БД

Файл БД находится в `/path/to/deployment/database.db`

Создайте резервную копию:

```bash
cp /path/to/deployment/database.db /path/to/backup/database.db.backup
```

Или автоматизируйте через cron:

```bash
0 2 * * * cp /path/to/deployment/database.db /path/to/backup/database.db.$(date +\%Y\%m\%d)
```

## 8. Проблемы и решения

### Сервер не запускается

```bash
# Проверьте логи
pm2 logs body-fat-tracker

# Или если запускали напрямую - смотрите ошибку в консоли
```

### API не отвечает

```bash
# Проверьте, слушает ли порт 3000
sudo netstat -tlnp | grep 3000

# Проверьте firewall
sudo ufw status
sudo ufw allow 3000/tcp  # если нужно открыть
```

### Cookies не работают

Убедитесь, что используете HTTPS (не HTTP). Cookies с `httpOnly` требуют безопасного соединения.

### БД не создаётся

Проверьте права доступа:

```bash
ls -la /path/to/deployment/
# Должны быть права на запись в этой папке
```

## 9. Обновление кода

Если нужно обновить код:

```bash
# Остановите приложение
pm2 stop body-fat-tracker

# Загрузите новые файлы
# (через scp или другой метод)

# Перезапустите
pm2 restart body-fat-tracker
```

## 10. Мониторинг

Проверяйте логи:

```bash
pm2 logs body-fat-tracker --lines 50
pm2 monit
```

Размер БД:

```bash
du -h /path/to/deployment/database.db
```

## Готово!

Теперь ваше приложение:
- ✅ Работает на вашем домене через HTTPS
- ✅ Хранит все данные в SQLite БД
- ✅ Поддерживает регистрацию новых пользователей
- ✅ Защищает пароли через bcrypt
- ✅ Сохраняет историю для каждого пользователя отдельно

Успехов! 🚀
