# Producto: mvp-transporte

## Objetivo

Dar a una empresa de transporte herramientas para controlar sus vehículos, personal operativo, viajes, documentos, mantenimientos y combustible. El primer mercado es el transporte y distribución de productos.

El producto se apoya en mvp-base para administración y configuración. mvp-transporte no reemplaza ni duplica esos módulos.

## Usuarios

- Administrador de empresa: configura recursos y supervisa la operación.
- Supervisor u operador: registra vehículos, prepara viajes y asigna tripulación según sus permisos.
- Conductor: consulta sus asignaciones y actualiza el estado del viaje desde la app móvil, incorporada después de estabilizar la API.
- Ayudante: participa en el viaje y puede apoyar en carga, descarga o cobros. El arqueo de dinero queda fuera del alcance actual.
- Ayudante proporcionado por el cliente: se registra en la tripulación del viaje con origen CLIENTE y nombre opcional; no necesita ser empleado propio.

Los usuarios, roles y permisos se administran en mvp-base.

## Alcance inicial

- Registro de vehículos y estado operativo.
- Perfiles de conductor y ayudante ligados al personal de mvp-base. Una misma persona puede tener ambos perfiles.
- Viajes y asignaciones de distribución, ruta corta y viaje largo.
- Ayudantes propios y proporcionados por la empresa contratante.
- Relevos de conductor durante viajes largos.
- Documentación de vehículos y personal con archivos, vencimiento y renovación.
- Mantenimiento correctivo y preventivo por kilometraje y periodo previsto.
- Registro de combustible por tanque, separando gasolina y GNV.
- Web administrativa para gestionar recursos y viajes.
- App móvil posterior para consultar viajes propios y actualizar su estado.

## Tipos de viaje

- **Distribución:** requiere uno o dos ayudantes en total. La empresa contratante puede proporcionar el apoyo, por lo que puede haber cero ayudantes propios.
- **Ruta corta:** una o dos paradas, duración usual de pocas horas y sin ayudante como regla inicial.
- **Viaje largo:** interdepartamental, puede durar varios días, identifica a la empresa contratante y conserva el dato del precinto. Puede cambiar el conductor mediante asignaciones con intervalos.

## Fuera de alcance inicial

- Módulos de propietarios y flota.
- Rutas reutilizables y horarios fijos.
- Arqueo o liquidación del dinero recibido por ayudantes.
- Notificaciones automáticas de vencimiento documental.
- Optimización automática de recorridos.
- Seguimiento GPS y telemetría.
- Facturación o conciliación de ventas, salvo el enlace futuro con los cobros del módulo de distribución.
- Aplicación móvil de ayudantes o funciones móviles distintas de las aprobadas para conductores.

## Modelo de operación

Una instalación del producto puede gestionar varias empresas según la plataforma. Cada solicitud opera en el contexto de una empresa seleccionada y sus permisos. La configuración y el despliegue de mvp-transporte se mantienen independientes de mvp-base.
