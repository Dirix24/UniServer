# Entrega A de UniServer

## Configuración y arranque

Ejecuta con Node.js 20 y npm. Copia `.env.example` a `.env` y elige un usuario y una contraseña aleatoria para el bootstrap. En producción, define `NODE_ENV=production` y usa al menos 16 caracteres para la contraseña de bootstrap. Puedes retirar esas dos variables después de crear el administrador. Si necesitas la API key heredada, genera una con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` y configura `ADMIN_API_KEY`. Esa clave concede privilegios de `SUPER_ADMIN`.

```sh
npm ci
npm test
npm audit
npm start
curl -fsS http://127.0.0.1:3000/api/ready
```

El dashboard está en `/dashboard/`. Las credenciales se mantienen en memoria durante la sesión del dashboard. Para producción, termina TLS en un proxy de confianza y limita el acceso al puerto HTTP del Core. Configura ese proxy para conservar el upgrade de WebSocket. Los limitadores HTTP usan la IP de la conexión inmediata con la configuración actual de Express.

`CORS_ORIGINS` y `WS_ORIGINS` aceptan listas separadas por comas de orígenes exactos. El dashboard servido por el propio Core usa la API del mismo origen. Los clientes WebSocket nativos sin cabecera `Origin` se autentican con `Authorization: Bearer …` o `x-api-key`. Los clientes que envían `Origin` requieren autorización de ese origen y credenciales en cabeceras. Envía `{"type":"subscribe","collections":["servers"]}` después de `welcome`. Las notificaciones incluyen colección, acción e ID. Lee los detalles por la API REST. Usuarios y auditoría requieren sus respectivos permisos RBAC. El servidor limita a 64 conexiones, 1 KiB por mensaje y 8 mensajes por segundo por conexión. La revocación local de sesión cierra la conexión y la comprobación periódica cubre expiración y cambios externos.

## Comprobaciones de salud

Los destinos públicos usan HTTP/HTTPS en sus puertos estándar. Para autorizar un origen privado o un puerto adicional, añade el origen exacto a `HEALTH_PRIVATE_TARGETS`, por ejemplo `http://10.20.30.40:8080`. La política valida todas las direcciones devueltas por DNS y fija una IP para la conexión. Excluye destinos especiales y direcciones conocidas de metadatos. Restringe también el tráfico saliente del Core en la plataforma de despliegue para cubrir recursos internos específicos de la organización.

Solo se envía `HEAD`, con 5 segundos de plazo total por defecto y sin seguir redirecciones. Se registra como saludable una respuesta 2xx. La comprobación individual y el escaneo requieren `servers.manage`. El escaneo ejecuta hasta cuatro comprobaciones a la vez. El Core admite hasta ocho en total.

## Actualización y recuperación

**Antes de cambiar de rama o actualizar, detén UniServer y copia el archivo de datos vigente fuera del checkout.** Versiones anteriores incluían archivos JSON de ejemplo y de pruebas en Git. Si la instalación usa la ruta por defecto, conserva primero su copia de `data/uniserver.json` y configura `DATA_FILE` hacia esa copia independiente con permisos de lectura y escritura para el usuario del Core. En contenedores, conserva el volumen existente. El formato anterior se lee directamente y la primera escritura guarda la versión 1 conservando IDs y relaciones.

El almacenamiento JSON es local. Ejecuta una sola instancia por archivo. Un bloqueo exclusivo protege cada transacción de escrituras concurrentes. Una contención devuelve 503. Las escrituras sincronizan el temporal y lo publican mediante renombrado. El Core conserva la última versión anterior válida en `DATA_FILE.bak`. Los eventos y la auditoría se limitan a las últimas 10 000 entradas por colección. Conserva copias externas si necesitas una retención mayor.

Si el archivo principal está corrupto, preserva el original para diagnóstico, detén todos los procesos que lo usan y recupera la copia validada hacia un archivo nuevo.

```sh
node scripts/restore-backup.js /ruta/estado.json.bak /ruta/estado-recuperado.json
DATA_FILE=/ruta/estado-recuperado.json npm start
```

El comando rechaza archivos corruptos y destinos que ya existen. Si una interrupción dejó un directorio `DATA_FILE.lock`, verifica primero que ningún proceso puede escribir en el almacén y elimina manualmente ese directorio vacío antes de reutilizar el mismo archivo. La copia local conserva una versión anterior y comparte el mismo disco. Para rollback del código, usa la copia externa hecha antes de actualizar.

SQLite sigue siendo una opción si el volumen de escrituras, las consultas históricas o los tiempos de recuperación justifican una migración. En esta entrega se mantiene JSON para conservar la compatibilidad del inventario y reducir el cambio de despliegue.

## Contenedor

```sh
docker build -t uniserver:core .
docker run --rm --env-file .env -p 127.0.0.1:3000:3000 \
  -v uniserver-data:/app/data uniserver:core
```

La imagen usa `NODE_ENV=production`, el usuario `node` y `/api/ready` como health check. Las validaciones funcionales de esta entrega usan un proceso Node aislado. La construcción de la imagen requiere una instalación de Docker.

## Cobertura y límites

La suite prueba autenticación, RBAC, rotación de tokens de agente, filtrado y revocación WebSocket, destinos HTTP restringidos, validación de entradas, auditoría, fallo de escritura, lectura de datos heredados y restauración. La observabilidad histórica, el agente de sistema operativo, las operaciones remotas y el programador pertenecen a las entregas posteriores.

Para reproducir la prueba del dashboard con un navegador Chromium compatible, ejecuta `BROWSER_BIN=/ruta/al/navegador npm run test:smoke`. La prueba inicia un Core local en un puerto efímero, aísla sus datos, abre el dashboard y verifica que el inventario se conserve después de reiniciar el proceso.
