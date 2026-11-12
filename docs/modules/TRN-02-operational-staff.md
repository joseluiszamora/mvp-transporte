# TRN-02 — Conductores y ayudantes

## Propósito

Agregar capacidades operativas de transporte al personal ya administrado por mvp-base.

## Alcance

- Perfil de conductor.
- Perfil de ayudante.
- Una persona puede tener ambos perfiles.
- Activación/desactivación del perfil operativo.
- Validación de disponibilidad y compatibilidad al asignar una tripulación.

La ficha general de identidad, contacto y empleo sigue perteneciendo a mvp-base.

La API y la pantalla inicial están en `apps/api/src/modules/operational-staff` y `apps/web/src/modules/operational-staff`. Antes de crear o reactivar un perfil, Transporte consulta la API de Employee y confirma estado ACTIVE y empresa. La consulta de nombres/códigos requiere `employees.read` además del permiso de perfiles de transporte.

## Reglas de negocio

- DriverProfile y AssistantProfile se vinculan al Employee existente.
- Una asignación interna exige que el empleado tenga un perfil activo compatible.
- Los documentos personales se gestionan en TRN-04 y enlazan con el empleado.
- El historial de participación en viajes no se elimina al desactivar un perfil.
- El ayudante proporcionado por un cliente no es empleado propio. Se registra en la tripulación del viaje con origen CLIENTE y nombre opcional, sin crear una ficha de empleado.

## Capacidades del ayudante

Puede acompañar el camión, apoyar en carga y descarga y participar en cobros. El registro de cobros pertenece al flujo de distribución cuando exista; el arqueo o liquidación no forma parte de esta primera versión.

## Criterios de aceptación

- Crear perfiles vinculados a empleados existentes sin duplicar personas.
- Permitir a una persona tener perfil de conductor y ayudante.
- Impedir asignar perfiles inactivos o funciones no compatibles.
- Permitir registrar ayudante externo de cliente desde el viaje.
