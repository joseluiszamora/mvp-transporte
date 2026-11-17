# TRN-04 — Documentación

**Estado:** En curso — API y pantalla implementadas con filtros por titular, tipo y vigencia; falta validación con mvp-base activo.

## Propósito

Guardar documentos de vehículos y personal con archivos y datos de vigencia.

## Alcance

- Tipo y titular del documento.
- Archivo asociado mediante el servicio de mvp-base.
- Fechas de emisión, vencimiento y renovación cuando correspondan.
- Estado visible: vigente, próximo a renovar, vencido o sin vigencia definida.
- Historial de renovaciones.

## Reglas de negocio

- Cada documento pertenece exactamente a un vehículo o empleado.
- Aplicar permisos tanto al registro como al archivo.
- Reemplazar un documento crea historial o nueva versión según el servicio de archivos.
- Mostrar vencimiento en web.
- Preparar campos para una futura integración con notificaciones; no enviar avisos automáticos en esta etapa.
- La lista de tipos es configurable y no codifica requisitos legales sin validación del negocio.

## Criterios de aceptación

- Adjuntar y consultar un archivo autorizado.
- Filtrar por titular, tipo y estado de vigencia.
- Registrar una renovación conservando historial.
- Impedir acceso desde empresas no autorizadas.

## Avance de implementación

- Vehículos y empleados usan los recursos `VEHICLE` y `EMPLOYEE` registrados en el manifiesto de Transporte.
- La renovación agrega un documento nuevo y conserva el anterior como `SUPERSEDED`.
- La API descarga el contenido desde mvp-base solo después de validar autorización y el permiso de descarga.
- La pantalla filtra por tipo y vigencia (vigente, por vencer en 30 días, vencido, sin vencimiento y renovado). El flujo de archivos contra un mvp-base local activo sigue pendiente de validación.
