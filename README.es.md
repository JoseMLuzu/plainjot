# PlainJot

**Notas para ti. Memoria para tus agentes.**

Una libreta Markdown y bandeja de tareas local-first para humanos y coding agents.

- Local first
- Archivos Markdown
- Sin cuentas
- No requiere cloud
- Amigable para humanos y agentes
- Aplicación nativa para macOS
- Open source

> **Files first. Local first. Agent friendly.**

PlainJot es deliberadamente pequeño. No es un workspace, grafo de conocimiento o gestor de proyectos. Los archivos `.md` de la carpeta elegida —`~/Documents/PlainJot` por defecto— siempre son la fuente de verdad.

Las notas con encabezados Markdown muestran un índice ligero a la derecha para navegar documentos largos sin añadir metadatos al archivo.

## Qué hace

PlainJot tiene tres secciones sencillas:

- **Notes** para documentos Markdown normales.
- **Inbox** para tareas creadas por agentes u otras herramientas.
- **Tasks** para trabajo pendiente y completado, con un Sprint View opcional de tres columnas.

La lista de tareas sigue siendo la vista predeterminada. Sprint View solo ordena las mismas tareas Markdown como **Inbox**, **Por hacer** y **Hecho**; no añade tableros, metadatos de sprint ni otra fuente de verdad.

La app observa la carpeta PlainJot en macOS, por lo que las creaciones, ediciones, renombres y eliminaciones externas aparecen automáticamente. El guardado automático comprueba revisiones para no sobrescribir silenciosamente una edición externa. Si ambas versiones cambian, PlainJot protege el borrador local y te permite elegir cuál conservar.

Eliminar desde la app nativa mueve el archivo Markdown a la Papelera de macOS para que siga siendo recuperable.

Pulsa la ruta de la esquina inferior izquierda para elegir otra carpeta local. PlainJot la recuerda, reinicia el watcher y comparte la selección con la CLI. Los archivos existentes nunca se mueven automáticamente.

## Compilar la app para macOS

Requiere macOS 13 o posterior y las herramientas de línea de comandos de Xcode.

```bash
git clone https://github.com/JoseMLuzu/plainjot.git
cd plainjot
./scripts/build_macos_app.sh
open dist/PlainJot.app
```

La aplicación nativa integra la interfaz HTML/CSS/JavaScript compartida dentro de WebKit. No necesita Python para funcionar.

## Instalar la CLI

El instalador sin dependencias coloca `plainjot` en `~/.local/bin`:

```bash
./scripts/install_cli.sh
export PATH="$HOME/.local/bin:$PATH"
```

También puedes ejecutar `./plainjot` directamente desde el repositorio.

```bash
plainjot add "Mi nota"
plainjot task "Corregir autenticación"
plainjot task "Limpiar perfiles" --project outcrew
plainjot task "Corregir login" --source codex
plainjot list
plainjot list --inbox
plainjot list --tasks
plainjot search "autenticación"
plainjot done corregir-aut
```

La CLI y la aplicación operan exactamente sobre los mismos archivos Markdown.

## Uso con agentes de IA

Cualquier coding agent con permiso para ejecutar comandos locales puede crear una tarea en Inbox:

```bash
plainjot task "Refactorizar autenticación" \
  --project my-project \
  --source codex
```

Para Claude Code se utiliza el mismo comando con una fuente precisa:

```bash
plainjot task "Revisar el script de distribución" \
  --project plainjot \
  --source claude-code
```

Otros agentes no necesitan una integración dedicada. Pueden utilizar la CLI o crear directamente un archivo Markdown válido dentro de:

```text
~/Documents/PlainJot
```

Esa es la ubicación predeterminada. Si eliges otra carpeta en la app de macOS, usa la ruta mostrada en la esquina inferior izquierda; la CLI `plainjot` seguirá esa selección automáticamente.

Estos flujos dependen únicamente del acceso normal a la terminal y al filesystem. No afirmamos ni requerimos un plugin oficial de Codex o Claude Code.

## Formato de tareas

Las tareas son archivos Markdown normales con un bloque YAML frontmatter pequeño:

```markdown
---
type: task
status: inbox
project: plainjot
source: codex
created: 2026-08-24T22:30:00Z
completed:
---

# Añadir filesystem watcher

Detectar automáticamente cambios Markdown externos.
```

Los únicos estados compatibles son `inbox`, `todo` y `done`. Las notas anteriores sin frontmatter continúan funcionando.

## Desarrollo web

El servidor requiere Python 3.10 o posterior y utiliza únicamente la biblioteca estándar:

```bash
python3 app.py
```

Después abre `http://127.0.0.1:8765`. Para usar archivos temporales durante desarrollo:

```bash
python3 app.py --notes-dir /tmp/plainjot-dev --port 9000
```

## Arquitectura

```text
Archivos Markdown
├── Core Python → CLI y servidor de desarrollo
└── Core Swift  → puente WebKit y filesystem watcher nativo
                          ↓
                 HTML / CSS / JavaScript compartido
```

El Core Python puede reutilizarse en un futuro servidor MCP pequeño. El Core Swift mantiene la app nativa e independiente de Python. Ambos implementan el mismo contrato Markdown sin base de datos ni dependencia YAML.

## Pruebas

```bash
python3 -m unittest -v
node --check static/app.js
./scripts/build_macos_app.sh
./dist/PlainJot.app/Contents/MacOS/PlainJot --self-test
```

## Build descargable

Crea un zip validado sin publicar una release:

```bash
./scripts/package_release.sh
```

El archivo aparece en `dist/`. Los builds de desarrollo usan una firma ad hoc. La distribución pública requiere una firma Apple Developer ID y notarización; el procedimiento manual está en [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md).

## Contribuciones y seguridad

Consulta [CONTRIBUTING.md](CONTRIBUTING.md), [ROADMAP.md](ROADMAP.md) y [SECURITY.md](SECURITY.md). No incluyas notas personales, aplicaciones generadas, credenciales o material de firma en el repositorio.

## Licencia

PlainJot se distribuye bajo la [Mozilla Public License 2.0](LICENSE).
