"""
Construye "Datos de salud" replicando EXACTAMENTE la mecánica de un atajo real
y verificado ("Daily Health Report", descargado y decompilado de iCloud):
mismo identificador de acción, misma ventana temporal, mismo agrupamiento por
día, mismo patrón filter -> getitemfromlist -> round -> setvariable.

Solo se cambia la cadena "Type" de cada filtro:
  - "Resting Heart Rate" y "Oxygen Saturation": confirmadas al 100% (aparecen
    tal cual en el atajo real).
  - "Heart Rate Variability SDNN": inferida por el mismo patrón de
    transformación CamelCase -> Title Case que acertó en las dos anteriores,
    corroborada por una referencia técnica de HealthKit. Confirmada en la
    práctica: funcionó a la primera en el dispositivo real (iOS 26.6),
    mientras que "Resting Heart Rate" -que sí venía de un atajo real- no lo
    hizo. Ninguna cadena está garantizada al 100%; el mecanismo sí lo está.
  - "Respiratory Rate" y "Apple Sleeping Wrist Temperature": mismo tipo de
    inferencia que HRV, sin confirmar. Si Shortcuts marca cualquiera de estas
    con un aviso al abrir, se reselecciona de la lista en unos segundos: el
    resto del atajo sigue intacto.

Sueño queda fuera a propósito: HealthKit registra la noche en varios tramos
(profundo, REM, ligero...) y sumar sus duraciones necesita un mecanismo
distinto (Calcular estadísticas sobre "Duración") que no se ha podido
verificar contra un atajo real. Añadirlo a ciegas arriesgaría un número sin
sentido en vez de una señal ausente, que es peor.
"""
import json
import subprocess
import sys
import uuid
from pathlib import Path

def uid():
    return str(uuid.uuid4()).upper()

def output_ref(name, output_uuid):
    return {
        "Value": {"OutputName": name, "OutputUUID": output_uuid, "Type": "ActionOutput"},
        "WFSerializationType": "WFTextTokenAttachment"
    }

def health_filter_block(health_type, window_days=1):
    """Replica verbatim el bloque confirmado del atajo real, cambiando solo el tipo."""
    filter_uuid = uid()
    action = {
        "WFWorkflowActionIdentifier": "is.workflow.actions.filter.health.quantity",
        "WFWorkflowActionParameters": {
            "UUID": filter_uuid,
            "WFContentItemFilter": {
                "Value": {
                    "WFActionParameterFilterPrefix": 1,
                    "WFActionParameterFilterTemplates": [
                        {
                            "Bounded": True, "Operator": 4, "Property": "Type", "Removable": False,
                            "Values": {"Enumeration": {"Value": health_type, "WFSerializationType": "WFStringSubstitutableState"}}
                        },
                        {
                            "Bounded": True, "Operator": 1002, "Property": "Start Date", "Removable": False,
                            "Values": {"Number": str(window_days), "Unit": 16}
                        }
                    ],
                    "WFContentPredicateBoundedDate": False
                },
                "WFSerializationType": "WFContentPredicateTableTemplate"
            },
            "WFHKSampleFilteringGroupBy": "Day"
        }
    }
    return action, filter_uuid

def get_item_block(source_uuid):
    item_uuid = uid()
    action = {
        "WFWorkflowActionIdentifier": "is.workflow.actions.getitemfromlist",
        "WFWorkflowActionParameters": {
            "UUID": item_uuid,
            "WFInput": output_ref("Health Samples", source_uuid)
        }
    }
    return action, item_uuid

def round_block(source_uuid):
    round_uuid = uid()
    action = {
        "WFWorkflowActionIdentifier": "is.workflow.actions.round",
        "WFWorkflowActionParameters": {
            "UUID": round_uuid,
            "WFInput": output_ref("Item from List", source_uuid)
        }
    }
    return action, round_uuid

def set_variable_block(source_uuid, source_name, variable_name):
    action = {
        "WFWorkflowActionIdentifier": "is.workflow.actions.setvariable",
        "WFWorkflowActionParameters": {
            "WFInput": output_ref(source_name, source_uuid),
            "WFVariableName": variable_name
        }
    }
    return action

def metric_chain(health_type, variable_name, window_days=1):
    """filter -> primer elemento del día -> redondear -> variable con nombre."""
    actions = []
    filter_action, filter_uuid = health_filter_block(health_type, window_days)
    actions.append(filter_action)
    item_action, item_uuid = get_item_block(filter_uuid)
    actions.append(item_action)
    round_action, round_uuid = round_block(item_uuid)
    actions.append(round_action)
    actions.append(set_variable_block(round_uuid, "Rounded Number", variable_name))
    return actions, round_uuid  # UUID final para referenciar en el texto

def build():
    actions = []
    var_refs = {}  # nombre -> uuid final

    for health_type, var_name in [
        ("Resting Heart Rate", "RHR"),
        ("Oxygen Saturation", "SpO2"),
        ("Heart Rate Variability SDNN", "HRV"),  # mejor esfuerzo, ver docstring
        ("Respiratory Rate", "RESP"),  # mejor esfuerzo, mismo patrón que acertó con SpO2/HRV
        ("Apple Sleeping Wrist Temperature", "TEMP"),  # mejor esfuerzo
    ]:
        chain, final_uuid = metric_chain(health_type, var_name)
        actions.extend(chain)
        var_refs[var_name] = final_uuid

    # Fecha: "Formatear fecha" aplicada directamente sobre el token especial
    # "Fecha actual" (CurrentDate), el mismo que ya está confirmado y en uso
    # dentro del bloque de texto final. Se probó primero con una acción
    # "is.workflow.actions.date" separada para obtener la fecha actual, pero
    # esa acción resultó ser otra cosa (pedía elegir un evento de calendario):
    # se elimina y se referencia el token directamente, sin acción intermedia.
    format_uuid = uid()
    current_date_token = {
        "Value": {"Type": "CurrentDate"},
        "WFSerializationType": "WFTextTokenAttachment"
    }
    format_action = {
        "WFWorkflowActionIdentifier": "is.workflow.actions.format.date",
        "WFWorkflowActionParameters": {
            "UUID": format_uuid,
            "WFDate": current_date_token,
            "WFDateFormatStyle": "Custom",
            "WFDateFormat": "yyyy-MM-dd"
        }
    }
    actions.append(format_action)
    var_refs["FECHA"] = format_uuid

    # Texto final: el mismo mecanismo de attachmentsByRange confirmado en el
    # placeholder original del usuario y en el atajo real de referencia.
    template = (
        '{{"date":"{FECHA}","hrv":{HRV},"restingHeartRate":{RHR},'
        '"oxygenSaturation":{SpO2},"respiratoryRate":{RESP},'
        '"wristTemperature":{TEMP}}}'
    )
    order = ["FECHA", "HRV", "RHR", "SpO2", "RESP", "TEMP"]
    plain = template.format(**{k: "￼" for k in order})

    attachments = {}
    cursor = 0
    remaining = plain
    for key in order:
        idx = remaining.index("￼")
        attachments[f"{{{cursor + idx}, 1}}"] = {
            "OutputName": key,
            "OutputUUID": var_refs[key],
            "Type": "ActionOutput"
        }
        cursor += idx + 1
        remaining = remaining[idx + 1:]

    text_uuid = uid()
    text_action = {
        "WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
        "WFWorkflowActionParameters": {
            "UUID": text_uuid,
            "WFTextActionText": {
                "Value": {"attachmentsByRange": attachments, "string": plain},
                "WFSerializationType": "WFTextTokenString"
            }
        }
    }
    actions.append(text_action)

    clipboard_action = {
        "WFWorkflowActionIdentifier": "is.workflow.actions.setclipboard",
        "WFWorkflowActionParameters": {
            "WFInput": output_ref("Text", text_uuid)
        }
    }
    actions.append(clipboard_action)

    return {
        "WFWorkflowActions": actions,
        "WFWorkflowClientVersion": "4610.1",
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowHasShortcutInputVariables": False,
        "WFWorkflowIcon": {"WFWorkflowIconGlyphNumber": 61440, "WFWorkflowIconStartColor": 946986751},
        "WFWorkflowImportQuestions": [],
        "WFWorkflowInputContentItemClasses": [],
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowTypes": ["Watch", "WFWorkflowTypeShowInSearch"]
    }

if __name__ == "__main__":
    import plistlib
    workflow = build()
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
    unsigned = out_dir / "entrada.shortcut"
    unsigned.write_bytes(plistlib.dumps(workflow))
    signed = out_dir / "Datos de salud.shortcut"
    subprocess.run(
        ["shortcuts", "sign", "--mode", "anyone", "--input", str(unsigned), "--output", str(signed)],
        check=True
    )
    print(f"Firmado en {signed}")
