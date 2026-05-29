# Demir Reports Android

Android-клиент для сервиса отчетности Demir.

Приложение работает напрямую с TMS/Vendotek API, без WebView и без локального веб-сервера.

Внутри приложения:

- загружаются карточки ИП только из проекта `bank-demir`;
- наименования берутся из TMS;
- считается количество терминалов;
- можно открыть карточку и сформировать безналичный отчет за период;
- отчет можно отправить как CSV через системное меню Android.

## Сборка

Нужны Android Studio или Android SDK + JDK 8.

Если SDK не найден автоматически, создайте `android/local.properties` по примеру `local.properties.example` и укажите путь к SDK.

```bash
cd android
.\gradlew.bat assembleDebug
```

APK будет здесь:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```
