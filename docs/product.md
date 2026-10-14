# Producto y alcance
## Objetivo
Base compartida independiente de rubro. Cada producto futuro tendrá su propia instalación y BD. El primer consumidor será distribución, una vez aceptados los diez módulos.
## Actores
Administrador de plataforma: crea/activa organizaciones y configura SMTP. Administrador de cliente: empresas y usuarios dentro de su alcance. Supervisor: personal laboral y operaciones autorizadas. Operador: registros limitados a sucursales. Visor: consulta explícita.
## Incluido
ADM-01 empresas/sucursales y organizaciones; ADM-02 usuarios; ADM-03 autenticación; ADM-04 roles/permisos; ADM-05 personal; ADM-06 configuración; ADM-07 auditoría; ADM-08 archivos privados; ADM-09 correo; ADM-10 catálogos. Panel responsive, español, tema claro/oscuro, identidad por empresa, filtros, paginación, formularios validados, estados vacíos/carga/error. Auditoría y permisos se implementan transversalmente desde las primeras escrituras.
## Excluido
Flutter inicial, Google login, 2FA, registro público, autosuscripción, facturación SaaS, pagos, nómina, rutas, clientes de distribución, push/SMS, impersonación y motor de plugins. SMTP configurable a nivel de instalación; SMTP por cliente fuera del MVP.
## Aceptación global
Dos organizaciones, varias empresas y sucursales; usuario en varias organizaciones; roles con alcance; un único login activo; documentos privados; SMTP de prueba; diez módulos funcionales; aislamiento probado; instalación local reproducible; backup/restauración documentados.
Una semana del propietario se reserva para revisar/probar; no constituye promesa de completar diez módulos en siete días.
