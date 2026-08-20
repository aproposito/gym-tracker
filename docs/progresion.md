# Cómo decide Gym Tracker subir el peso

## Doble progresión

Cada ejercicio tiene un **rango** de repeticiones, no un objetivo único: por
ejemplo 9-12. Primero se progresa dentro del rango con el mismo peso; el peso
solo sube cuando el rango se completa de forma sostenida.

La regla, en orden:

1. Con el peso actual, sumas repeticiones hasta llegar al tope del rango.
2. Cuando completas el tope **en todas las series** y lo repites en **dos
   sesiones consecutivas** de ese ejercicio, la app propone subir.
3. Al subir, vuelves al mínimo del rango y reconstruyes.

Si te quedas por debajo del mínimo en todas las series dos sesiones seguidas, se
propone bajar un 10 % y reconstruir desde ahí.

## Por qué no sube cada vez que cumples el objetivo

Porque a partir de los 50 el tejido conectivo y las articulaciones se adaptan
más despacio que el músculo, y forzar la subida en cada sesión que sale bien
lleva a estancamientos y molestias antes que a fuerza.

Con la rotación de tres rutinas, cada ejercicio vuelve cada tres sesiones más o
menos. Exigir dos sesiones buenas seguidas espacia las subidas a dos o tres
semanas, que es la cadencia que recomienda la literatura de entrenamiento para
mayores de 50 (peso nuevo cada tercera o cuarta sesión) y coincide con el medio
kilo por semana de media que se observa en los estudios de fuerza en adultos
mayores.

## Cuánto sube

Por defecto, y editable en cada ejercicio:

- Tren inferior y máquinas grandes: **2,5 kg**
- Tren superior y movimientos pequeños: **1,25 kg**
- Ejercicios por tiempo: **5 segundos** sobre el rango

Con un tope: nunca más del **5 %** de la carga actual. En un ejercicio de 20 kg,
un incremento nominal de 2,5 kg se recorta a 1 kg.

Los pesos se redondean a 0,25 kg para no proponer cargas que no se pueden montar.

## Qué ves en la sesión

Una línea sobre las series, y nada más. Sin diálogos ni confirmaciones:

- **Toca subir: 41,25 kg desde 40 kg** — el peso ya viene puesto en las series.
- **Una sesión más al tope del rango y subes peso**
- **Suma repeticiones antes de tocar el peso**
- **Baja a 45 kg y reconstruye**
- **Tres sesiones iguales: prueba a sumar una repetición**

Todo es una propuesta. El peso y las repeticiones son campos editables: si
escribes otra cosa, manda lo que escribas.

## Repeticiones realizadas

Para decidir la progresión hace falta saber cuántas repeticiones hiciste, no
solo que completaste la serie. Cada serie tiene un campo de repeticiones
rellenado con una propuesta razonable (lo de la vez anterior, o el mínimo del
rango), así que en la mayoría de series no hay que tocar nada.

El historial anterior a esta versión no registró repeticiones. Esas sesiones se
conservan enteras, pero no cuentan para subir peso: hacen falta dos sesiones
nuevas antes de la primera subida. Es a propósito — antes que suponer que
cumpliste el objetivo, la app prefiere no proponer nada.

## Relación con el readiness

Ninguna, salvo un detalle: si la capa de readiness está activa y el día sale en
rojo, no se propone subir peso. Puedes subirlo igualmente escribiéndolo a mano.

Con la capa apagada, que es como viene de fábrica, la progresión funciona
exactamente igual.
