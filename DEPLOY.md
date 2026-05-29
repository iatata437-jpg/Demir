# Deploy через GitHub

Проект готов к автодеплою через GitHub Actions на сервер.

## Secrets в GitHub

В репозитории откройте `Settings -> Secrets and variables -> Actions` и добавьте:

- `SERVER_HOST` - IP или домен сервера.
- `SERVER_USER` - SSH-пользователь.
- `SERVER_PORT` - SSH-порт.
- `SERVER_PASSWORD` - SSH-пароль.
- `DEPLOY_PATH` - папка проекта на сервере, например `/home/dan/demir-reports`.

На сервере в файле `.env` должны быть реальные доступы Vendotek/TMS:

```env
PORT=8080
VENDOTEK_HOST=https://my.vendotek.com
VENDOTEK_EMAIL=...
VENDOTEK_PASSWORD=...
VENDOTEK_PROJECT_ORG=bank-demir
SESSION_SECRET=change-me
```

После каждого push в ветку `main` GitHub Actions скопирует файлы на сервер, выполнит `npm ci --omit=dev` и перезапустит приложение через `pm2`.

## Первый запуск

На сервере должны быть установлены Node.js 18+, npm и pm2. Если pm2 отсутствует, workflow попробует установить его сам.

Приложение запускается на порту `8080`.
