# Atajo «Datos de salud»

La capa de readiness es opcional. Gym Tracker funciona entero sin ella: rutinas,
sesión, progresión de cargas, historial y marcas no dependen de Apple Salud.
Esta guía solo hace falta si quieres activarla.

## Cómo funciona ahora

El Atajo **no calcula nada**. Solo lee cinco o seis medidas de Apple Salud y las
copia al portapapeles como JSON. El score lo calcula Gym Tracker.

Ese reparto es deliberado. Antes el Atajo calculaba el resultado y se lo
devolvía a la app por una URL con `#readiness=…`. Ese camino no puede funcionar
con la app instalada en la pantalla de inicio: iOS abre esas URL en Safari, y en
iOS el almacenamiento de Safari está separado del de una app añadida a la
pantalla de inicio. El resultado se guardaba donde la app nunca iba a leerlo.
Con el portapapeles no hay salto entre contextos.

Además, tener la fórmula en JavaScript permite cambiarla y probarla sin volver a
editar bloques en el iPhone.

## Formato que espera la app

```json
{
  "days": [
    {
      "date": "2026-08-19",
      "hrv": 32.4,
      "restingHeartRate": 55,
      "sleepHours": 7.57,
      "sleepSegments": 33,
      "respiratoryRate": 15.6,
      "wristTemperature": 36.22,
      "oxygenSaturation": 94.3
    }
  ]
}
```

Todos los campos menos `date` son opcionales. La app también acepta un día
suelto sin envoltorio `days`, una lista, y los nombres que usan Health Auto
Export y la exportación oficial (`hrv_sdnn_ms`, `resting_heart_rate_bpm`…), así
que cambiar de método de exportación no obliga a tocar nada.

## 1. Cargar el histórico (una sola vez)

El motor compara cada día con **tu** línea base de 60 días. Sin histórico no hay
score hasta dos meses después. Para no esperar:

1. En el iPhone: **Salud → tu perfil → Exportar todos los datos de Salud**.
2. Pasa el ZIP al Mac.
3. Genera la semilla:

```bash
deno run --allow-read --allow-write --allow-run tools/parse-health-export.mjs ~/Downloads/exportación.zip semilla.json
```

4. En Gym Tracker, activa **Readiness con Apple Salud** en Ajustes y pulsa
   **Importar archivo** para cargar `semilla.json`.

La app se queda con los últimos 120 días y descarta el resto.

## 2. El Atajo del día a día

Crea un Atajo llamado **Datos de salud**. Para cada medida:

1. **Buscar muestras de salud** del tipo correspondiente.
2. Filtra por **fecha de inicio: hoy**.
3. Ordena y limita si hace falta, y calcula el **promedio** con el bloque de
   estadísticas.

Los nombres exactos de los bloques cambian entre versiones de iOS; búscalos por
palabra clave en el buscador de acciones.

| Campo | Tipo en Salud | Cómo agregarlo |
|---|---|---|
| `hrv` | Variabilidad del ritmo cardiaco | **promedio del día** |
| `restingHeartRate` | Frecuencia cardiaca en reposo | valor del día |
| `sleepHours` | Sueño | horas totales dormidas de la noche que termina hoy |
| `respiratoryRate` | Frecuencia respiratoria | promedio de la noche |
| `wristTemperature` | Temperatura de muñeca durante el sueño | valor de la noche |
| `oxygenSaturation` | Oxígeno en sangre | promedio de la noche |

**El promedio importa.** Con la última muestra suelta de HRV en lugar del
promedio del día, la variación pasa del 30 % al 60 % y la señal deja de tener
relación con la del día anterior: el score se convertiría en ruido.

Termina con un bloque **Texto** que arme el JSON de arriba y un bloque **Copiar
al portapapeles**.

Con el mínimo de HRV o pulso en reposo más otra señal ya hay score; cuantas más
señales, mayor la confianza que muestra el panel.

## 3. Usarlo

Por la mañana: ejecuta el Atajo, abre Gym Tracker y pulsa **Pegar datos**. iOS
pedirá permiso para leer el portapapeles la primera vez.

Si el día ya tiene datos y vuelves a pegar, se sobrescriben: Apple recalcula el
sueño y sincroniza con retraso, así que reenviar es lo correcto. Si quieres
cubrir esos retrasos del todo, haz que el Atajo repita el bloque para los
últimos cinco días y devuelva los cinco en la lista `days`.

## Automatización

Puedes lanzarlo desde **Atajos → Automatización → Hora del día**. Ten en cuenta
que iOS no deja a las apps leer datos de salud con el iPhone bloqueado, así que
la automatización solo se ejecuta con el dispositivo desbloqueado.

Si algún día prefieres no mantener el Atajo, Health Auto Export (de pago) puede
exportar a iCloud Drive de forma automática y su JSON se importa con el mismo
botón de **Importar archivo**.

## Comprobaciones

1. Con todas las señales: número, banda de color y confianza «alta».
2. Solo con temperatura y oxígeno: debe decir **Datos insuficientes**. Sin HRV ni
   pulso en reposo no hay señal autónoma que interpretar.
3. Al día siguiente sin ejecutar el Atajo: el panel debe mostrar la fecha del
   último dato junto al score, no hacerlo pasar por el de hoy.

## Qué sale del dispositivo

Nada. El JSON viaja del Atajo al portapapeles y del portapapeles a
`localStorage`. GitHub Pages sirve archivos estáticos y no recibe ninguna
petición con estos datos.

El readiness es orientativo y no sustituye consejo médico.
