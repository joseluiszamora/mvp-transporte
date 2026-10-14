# Escenarios de aceptación
Preparar fixtures sin datos reales: tenant A con empresas A1/A2 y dos sucursales; tenant B con B1; usuario compartido A/B; admin, supervisor, operador y visor.
1. Instalar desde clon limpio con comandos documentados; migrar y seed dev; ningún secret versionado.
2. Plataforma crea tenant y administrador; activar desde buzón local; empresa maneja sucursales.
3. User compartido selecciona tenant; membresía A desactivada conserva B.
4. Login en navegador B invalida navegador A inmediatamente; tabs del mismo navegador renuevan sin logout espurio.
5. Contraseña cambiada/recuperada invalida refresh y access de sesión anterior.
6. Operador sucursal A1-1 no lee/escribe A1-2, A2 ni B1 manipulando IDs, filtros, enlaces o API.
7. Rol personalizado sin users.create no crea usuarios; no asigna privilegios mayores que los propios.
8. Supervisor ve datos laborales pero no CI/domicilio/documentos; visor explícito solo consulta.
9. Archivo privado no tiene URL pública; MIME/tamaño/path traversal rechazados; limpieza no elimina archivo vinculado.
10. Catálogo global protegido y estado interno no editables; numeraciones concurrentes sin colisión; preferencias empresa diferenciadas.
11. Mutaciones auditadas sin password/token/SMTP secret; auditoría de tenant ajeno inaccesible.
12. SMTP inválido muestra fallo sanitizado; reintento al restaurar; eventos no duplican outbox; límite de exactly-once documentado.
13. Backup BD y volumen archivos; restaurar en entorno local separado y abrir archivo vinculado.
14. Checks lint/typecheck/test/build e integración pasan; OpenAPI coincide con API.
Registrar resultado, evidencia y defectos por escenario; no usar datos productivos.
