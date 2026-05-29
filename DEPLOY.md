# Deploy через GitHub

Проект готов к автодеплою через GitHub Actions.

## Secrets в GitHub

В репозитории откройте `Settings -> Secrets and variables -> Actions` и добавьте:

- `SERVER_HOST` - IP или домен сервера.
- `SERVER_USER` - SSH-пользователь.
- `SERVER_PORT` - SSH-порт, обычно `22`.
- `SERVER_SSH_KEY` - приватный SSH-ключ для доступа к серверу.
- `DEPLOY_PATH` - папка проекта на сервере, например `/var/www/demir-reports`.

## Первый запуск на сервере

На сервере должны быть установлены:

- Node.js 18+.
- npm.
- pm2, либо workflow установит его сам.

Создайте папку и `.env`:

```bash
sudo mkdir -p /var/www/demir-reports
sudo chown -R $USER:$USER /var/www/demir-reports
cd /var/www/demir-reports
nano .env
```

Минимальный `.env`:

```env
PORT=3100
VENDOTEK_HOST=https://my.vendotek.com
VENDOTEK_PROJECT_ORG=bank-demir
SESSION_SECRET=change-me
```

Vendotek-доступы сейчас заданы в коде как дефолт. Если нужно переопределить их на сервере, добавьте:

```env
VENDOTEK_EMAIL=
VENDOTEK_PASSWORD=
```

После каждого push в ветку `main` GitHub Actions скопирует файлы на сервер, выполнит `npm ci --omit=dev` и перезапустит приложение через pm2.
