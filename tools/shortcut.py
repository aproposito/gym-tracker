#!/usr/bin/env python3
"""
Lee y construye archivos .shortcut de Atajos de Apple.

Existe porque las acciones de Salud solo están en iOS: macOS no trae sus
definiciones, así que la única fuente fiable de los identificadores y
parámetros exactos es un atajo real exportado desde el iPhone.

  python3 tools/shortcut.py read  Atajo.shortcut          # volcar sus acciones
  python3 tools/shortcut.py build receta.json salida.shortcut

Un .shortcut firmado es un archivo AEA con perfil 0 (firmado, sin cifrar):
cabecera + cadena de certificados + bloques LZFSE que contienen el plist.
"""
import json
import plistlib
import struct
import subprocess
import sys
import tempfile
from pathlib import Path


def read_shortcut(path: Path) -> dict:
    raw = path.read_bytes()
    if raw[:8] == b"bplist00" or raw[:5] == b"<?xml":
        return plistlib.loads(raw)          # sin firmar
    if raw[:4] != b"AEA1":
        raise SystemExit(f"{path} no es un archivo de atajo reconocible.")

    auth_len, = struct.unpack("<I", raw[8:12])
    body = raw[12 + auth_len:]

    start = body.find(b"bvx")
    if start < 0:
        raise SystemExit("No se encuentra el bloque comprimido.")

    with tempfile.TemporaryDirectory() as tmp:
        packed = Path(tmp) / "bloque.lzfse"
        unpacked = Path(tmp) / "payload.bin"
        packed.write_bytes(body[start:])
        subprocess.run(
            ["compression_tool", "-decode", "-a", "lzfse", "-i", str(packed), "-o", str(unpacked)],
            check=True, capture_output=True
        )
        payload = unpacked.read_bytes()

    marker = payload.find(b"bplist00")
    if marker < 0:
        raise SystemExit("El bloque descomprimido no contiene un plist.")
    return plistlib.loads(payload[marker:])


def describe(workflow: dict) -> None:
    actions = workflow.get("WFWorkflowActions", [])
    print(f"{len(actions)} acciones\n")
    for index, action in enumerate(actions, 1):
        print(f"{index:2}. {action['WFWorkflowActionIdentifier']}")
        for key, value in (action.get("WFWorkflowActionParameters") or {}).items():
            rendered = json.dumps(value, default=str, ensure_ascii=False)
            if len(rendered) > 300:
                rendered = rendered[:300] + "…"
            print(f"      {key} = {rendered}")
        print()


def build(recipe: dict) -> dict:
    """La receta aporta las acciones; el resto son los envoltorios que espera iOS."""
    return {
        "WFWorkflowClientVersion": recipe.get("clientVersion", "2605"),
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": recipe.get("iconColor", 4251333119),
            "WFWorkflowIconGlyphNumber": recipe.get("iconGlyph", 59511),
        },
        "WFWorkflowImportQuestions": [],
        "WFWorkflowTypes": recipe.get("types", ["NCWidget"]),
        "WFWorkflowInputContentItemClasses": [],
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowHasShortcutInputVariables": False,
        "WFWorkflowHasOutputFallback": False,
        "WFQuickActionSurfaces": [],
        "WFWorkflowActions": recipe["actions"],
    }


def sign(workflow: dict, output: Path) -> None:
    # `shortcuts sign` exige que la entrada tenga extensión .shortcut.
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "entrada.shortcut"
        source.write_bytes(plistlib.dumps(workflow))
        subprocess.run(
            ["shortcuts", "sign", "--mode", "anyone", "--input", str(source), "--output", str(output)],
            check=True
        )


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    command = sys.argv[1]

    if command == "read":
        describe(read_shortcut(Path(sys.argv[2])))
    elif command == "build":
        recipe = json.loads(Path(sys.argv[2]).read_text())
        output = Path(sys.argv[3] if len(sys.argv) > 3 else "salida.shortcut")
        sign(build(recipe), output)
        print(f"Firmado en {output}")
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
