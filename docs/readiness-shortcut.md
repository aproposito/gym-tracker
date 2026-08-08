# Atajo Calcular Readiness

Este Atajo consulta Apple Salud en el iPhone, calcula un resultado local y devuelve a Gym Tracker solo cuatro datos derivados: fecha, score, semáforo y motivos. No incluye las muestras originales.

## Resultado esperado

El Atajo termina construyendo este diccionario:

```json
{
  "date": "2026-08-08",
  "objectiveScore": 74,
  "availableMetrics": 3,
  "band": "green",
  "factors": ["HRV en tu media", "Pulso estable", "Sueño suficiente"]
}
```

Con una sola métrica disponible, usa `null` como `objectiveScore` y `1` como `availableMetrics`. Gym Tracker mostrará **Datos insuficientes**.

## 1. Crear el Atajo

1. Abre **Atajos** en el iPhone y crea uno llamado **Calcular Readiness**.
2. Activa **Recibir lo que hay en pantalla** o usa la variable **Entrada del atajo**. Gym Tracker enviará como texto su URL de retorno.
3. Añade tres bloques **Buscar muestras de Salud**:
   - Variabilidad de la frecuencia cardiaca (HRV): valor reciente y media de 28 días.
   - Frecuencia cardiaca en reposo: valor reciente y media de 28 días.
   - Sueño: duración total de la última noche.
4. Cuenta cuántas de esas tres señales tienen datos válidos.

Apple puede pedir permiso para cada tipo de muestra la primera vez. El Atajo solo necesita permiso de lectura.

## 2. Calcular los subresultados

Limita cada resultado al intervalo de 0 a 100:

- **HRV:** `70 + 150 × (HRV reciente / media HRV - 1)`.
- **Pulso en reposo:** `70 - 300 × (pulso reciente / media de pulso - 1)`.
- **Sueño:** `(horas de sueño - 4) × 25`.

Combina los disponibles con pesos HRV 40 %, pulso 30 % y sueño 30 %. Si falta una señal, divide por la suma de los pesos disponibles para no penalizarla dos veces. Redondea el resultado final.

El semáforo objetivo es:

- `green` desde 70.
- `amber` entre 45 y 69.
- `red` por debajo de 45.
- `unknown` si hay menos de dos señales.

Las selecciones **Energía** y **Agujetas** de Gym Tracker se aplican después y solo se guardan en la app.

## 3. Devolver el resultado

1. Crea un bloque **Diccionario** con `date`, `objectiveScore`, `availableMetrics`, `band` y `factors`.
2. Convierte el diccionario en texto JSON.
3. Aplica **Codificar URL** al JSON.
4. Crea el texto final concatenando:

```text
[Entrada del atajo]#readiness=[JSON codificado]
```

5. Termina con **Abrir URLs** usando ese texto.

El fragmento que comienza por `#` no forma parte de la petición al servidor. GitHub Pages no recibe el resultado; lo procesa el JavaScript ya cargado en el iPhone y guarda solo el resumen en `localStorage`.

## Comprobaciones

Ejecuta tres pruebas antes de usar el resultado para decidir la sesión:

1. Las tres métricas disponibles: debe aparecer un número y un semáforo.
2. Solo dos métricas: debe aparecer un número con confianza media.
3. Cero o una métrica: debe aparecer **Datos insuficientes**.

Si el retorno abre Safari en vez de la PWA instalada, vuelve a Gym Tracker desde su icono. Ese comportamiento debe validarse en la versión concreta de iOS antes de considerar automático el flujo.
