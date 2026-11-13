# App móvil del conductor

La app autentica al usuario en mvp-base, conserva el refresh token y el token CSRF en el almacenamiento seguro del sistema, y mantiene el access token solo en memoria. La API de Transporte resuelve el empleado desde la sesión; el cliente móvil nunca envía un `employeeId`.

## Configuración

1. Agrega el origen móvil exacto a `WEB_ORIGINS` de `mvp-base/.env`, por ejemplo `https://mobile.mvp-transporte.local`. La app envía ese valor en `Origin` para login, refresh y logout; no registres un origen que no controles.
2. En mvp-base, registra la integración `transport` y asigna al rol del conductor `transport.driver_trips.read`, `transport.driver_trips.transition` y `transport.audit.write` dentro de la empresa. El empleado también necesita un perfil activo de conductor en Transporte.
3. Instala las dependencias desde esta carpeta con `flutter pub get`.
4. Ejecuta la app indicando las URLs reales o de simulador:

```powershell
flutter run `
  --dart-define=MVP_BASE_API_URL=http://10.0.2.2:4000/api/v1/ `
  --dart-define=MVP_TRANSPORT_API_URL=http://10.0.2.2:4100/api/v1/transport/ `
  --dart-define=MVP_BASE_MOBILE_ORIGIN=https://mobile.mvp-transporte.local
```

En un simulador iOS, reemplaza `10.0.2.2` por la dirección accesible desde ese simulador. En dispositivos físicos configura URLs HTTPS alcanzables desde la red del dispositivo. No agregues el secreto `MVP_BASE_INTEGRATION_KEY` a la app.

El SDK Flutter disponible en el entorno no pudo generar las carpetas nativas con `flutter create` porque se bloqueó al inicializar su caché. En esta entrega están el cliente, la sesión, las pantallas y el manifiesto Dart; faltan los proyectos nativos Android/iOS y el lockfile de paquetes.
