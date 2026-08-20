# Gym Tracker

PWA personal para preparar y registrar entrenamientos desde el iPhone. Funciona
sin cuenta, guarda los datos en el propio dispositivo y sigue disponible sin
conexión después de la primera carga.

## Funciones

- Pantalla Hoy con rutina sugerida, última sesión y marcas recientes.
- Rutinas editables con rango de repeticiones, independientes del entrenamiento activo.
- Progresión de cargas por doble progresión, conservadora y editable.
- Recuperación automática de una sesión en curso después de cerrar la app.
- Peso y repeticiones por serie, cronómetro automático y guardado parcial.
- Descarte seguro: no cambia plantillas, historial, pesos ni récords.
- Historial, PR, evolución por ejercicio y volumen semanal.
- Ejercicios medidos en repeticiones o segundos.
- Copia de seguridad por descarga, compartir e importación JSON, y exportación CSV.
- Readiness con Apple Salud **como capa opcional**.
- Instalación PWA y funcionamiento offline.

## Uso en iPhone

1. Abre la URL de GitHub Pages en Safari.
2. Pulsa **Compartir**.
3. Elige **Añadir a pantalla de inicio**.
4. Abre Gym Tracker desde el nuevo icono al menos una vez con conexión.

Los datos de Safari y los de la app instalada son espacios distintos. Conviene
empezar a usarla desde el icono de la pantalla de inicio y guardar copias JSON
periódicas.

## Progresión de cargas

El peso no sube cada vez que cumples el objetivo. Cada ejercicio tiene un rango
de repeticiones y el peso solo sube tras completar el tope del rango en todas
las series durante dos sesiones consecutivas, con incrementos pequeños y un
tope del 5 %.

Explicado en [docs/progresion.md](docs/progresion.md).

## Readiness (opcional)

Viene **desactivado**. Con la capa apagada no aparece por ningún sitio y todo lo
demás funciona igual. Se activa y se desactiva en Ajustes, y al desactivarla se
ofrece borrar los datos de salud guardados.

Activada, la app calcula un score comparando cada señal con tu línea base de 60
días mediante una z robusta (mediana y MAD), no con constantes generales. Las
muestras entran por el portapapeles desde un Atajo del iPhone; nada se envía a
GitHub ni a ningún servidor.

La configuración está en [docs/readiness-shortcut.md](docs/readiness-shortcut.md).

El readiness es orientativo, no sustituye consejo médico y no modifica
automáticamente la rutina elegida.

## Desarrollo

La aplicación no necesita compilación ni dependencias de producción. Debe
servirse por HTTP para probar el service worker:

```bash
python3 -m http.server 8080
```

Las pruebas del modelo se ejecutan con Deno:

```bash
deno test --allow-read tests/
```

Con Node instalado, `npm test` hace lo mismo. Los tests usan `node:test` y
funcionan igual en ambos.

### Herramientas

Convertir la exportación oficial de Apple Salud en una semilla de métricas
diarias (lee el XML de varios GB en streaming, sin descomprimirlo a disco):

```bash
deno run --allow-read --allow-write --allow-run tools/parse-health-export.mjs ~/Downloads/exportación.zip semilla.json
```

Comprobar que el motor de readiness no se ha vuelto inestable:

```bash
deno run --allow-read tools/backtest-readiness.mjs semilla.json
```

Falla si el salto medio de un día a otro supera los 12 puntos o si más del 2 %
de los días saturan. Son las dos propiedades que hacían inservibles a las
versiones anteriores del algoritmo.

## Datos

El estado V3 se almacena en `localStorage` con la clave `gymTracker.v3`. La
primera apertura migra `gymTracker.v2` y `gymTracker.v1` sin reemplazar rutinas
personalizadas ni borrar el historial anterior.

Las sesiones guardadas antes de V3 no registraron repeticiones realizadas. Se
conservan íntegras, pero no cuentan para decidir subidas de peso.
