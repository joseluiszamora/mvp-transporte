# App móvil del conductor

La app autentica al usuario en mvp-base, conserva el refresh token y el token CSRF en el almacenamiento seguro del sistema, y mantiene el access token solo en memoria. La API de Transporte resuelve el empleado desde la sesión; el cliente móvil nunca envía un `employeeId`.

## Configuración

1. Agrega el origen móvil exacto a `WEB_ORIGINS` de `mvp-base/.env`, por ejemplo `https://mobile.mvp-transporte.local`. La app envía ese valor en `Origin` para login, refresh y logout; no registres un origen que no controles.
2. En mvp-base, registra la integración `transport` y asigna al rol del conductor `transport.driver_trips.read`, `transport.driver_trips.transition` y `transport.audit.write` dentro de la empresa. El empleado también necesita un perfil activo de conductor en Transporte.
3. Instala las dependencias desde esta carpeta con `flutter pub get`.
4. Ejecuta en el emulador Android indicando las URLs de desarrollo:

```powershell
flutter run `
  --dart-define=MVP_BASE_API_URL=http://10.0.2.2:4000/api/v1/ `
  --dart-define=MVP_TRANSPORT_API_URL=http://10.0.2.2:4100/api/v1/transport/ `
  --dart-define=MVP_BASE_MOBILE_ORIGIN=https://mobile.mvp-transporte.local
```

Los proyectos nativos Android e iOS están en `android/` e `ios/`. El manifiesto de debug Android permite HTTP para el emulador; el manifiesto principal conserva el permiso de Internet y no habilita tráfico HTTP en producción. iOS requiere URLs HTTPS accesibles desde el simulador por su política ATS. En dispositivos físicos configura URLs HTTPS alcanzables desde la red del dispositivo. No agregues el secreto `MVP_BASE_INTEGRATION_KEY` a la app.

TASK-016 de mvp-base debe estar integrado en el entorno antes del recorrido completo, porque la API de Transporte usa `GET /api/v1/employees/me` para resolver la identidad del conductor. La dependencia Flutter todavía debe resolverse con `flutter pub get` antes de analizar o compilar la app.
