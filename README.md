# Gym Tracker

PWA personal para preparar y registrar entrenamientos desde el iPhone. Funciona sin cuenta, guarda los datos en el propio dispositivo y sigue disponible sin conexión después de la primera carga.

## Funciones

- Pantalla Hoy con rutina sugerida, última sesión, readiness y marcas recientes.
- Rutinas editables e independientes del entrenamiento activo.
- Recuperación automática de una sesión en curso después de cerrar la app.
- Peso anterior por serie, cronómetro automático y guardado parcial.
- Descarte seguro: no cambia plantillas, historial, pesos ni récords.
- Historial, PR y evolución por ejercicio.
- Ejercicios medidos en repeticiones o segundos.
- Copia de seguridad mediante descarga, compartir e importación JSON.
- Instalación PWA y funcionamiento offline.

## Uso en iPhone

1. Abre la URL de GitHub Pages en Safari.
2. Pulsa **Compartir**.
3. Elige **Añadir a pantalla de inicio**.
4. Abre Gym Tracker desde el nuevo icono al menos una vez con conexión.

Los datos de Safari y los de la app instalada pueden ser espacios distintos. Conviene empezar a usarla desde el icono de la pantalla de inicio y guardar copias JSON periódicas.

## Readiness

Gym Tracker recibe únicamente fecha, puntuación, semáforo y motivos calculados por un Atajo del iPhone. Las muestras originales de Apple Salud no se envían a GitHub ni se guardan en la app.

La configuración está explicada en [docs/readiness-shortcut.md](docs/readiness-shortcut.md).

## Desarrollo

La aplicación no necesita compilación ni dependencias de producción. Debe servirse por HTTP para probar el service worker:

```bash
python3 -m http.server 8080
```

Las pruebas del modelo se ejecutan con:

```bash
npm test
```

## Datos

El estado V2 se almacena en `localStorage` con la clave `gymTracker.v2`. La primera apertura migra `gymTracker.v1` sin reemplazar rutinas personalizadas ni borrar el historial anterior.

El readiness es orientativo y no sustituye consejo médico ni modifica automáticamente la rutina elegida.
