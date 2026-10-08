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

Las notas con encabezados Markdown muestran un índice ligero a la derecha. Pulsa **Ocultar índice** para ampliar el documento; tu elección se recuerda localmente. Los títulos son más compactos y se desplazan con la vista previa, sin quedarse fijos mientras lees.

El icono a la izquierda del encabezado oculta o muestra la barra lateral. Al ocultarla, el documento gana espacio y el índice derecho se hace más ancho y legible. Esta preferencia se recuerda localmente; ⌘N y ⌘K vuelven a mostrar la barra para crear o buscar. Una línea sutil separa el título del contenido en lectura y escritura.

## Qué hace

PlainJot tiene tres secciones sencillas:

- **Notas** para notas, journals, roadmaps, decisiones, reviews, refactorizaciones, handoffs y pizarras. Una etiqueta discreta indica el tipo de cada documento.
- **Análisis** para investigaciones, hallazgos y recomendaciones, identificados con `kind: analysis` en archivos Markdown normales.
- **Tareas** con filtros **Inbox**, **Pendientes** y **Hechas**, más Sprint View opcional. Acepta las propuestas de Inbox para pasarlas a Pendientes.

Elige un proyecto si lo necesitas, pulsa **+ Crear** y selecciona directamente el tipo. No hay un modo de desarrollo ni un dropdown de plantillas que configurar antes. Las tareas creadas por humanos empiezan en `todo`; la CLI conserva `inbox` como predeterminado para propuestas de agentes.

La lista de tareas sigue siendo la vista predeterminada. Usa el círculo de estado para avanzar una tarea sin abrirla. Sprint View ordena las mismas tareas Markdown como **Inbox**, **Por hacer** y **Hecho**, y permite arrastrar tarjetas entre esos estados; no añade metadatos de sprint ni otra fuente de verdad.

La app observa la carpeta PlainJot en macOS, por lo que las creaciones, ediciones, renombres y eliminaciones externas aparecen automáticamente. El guardado automático comprueba revisiones para no sobrescribir silenciosamente una edición externa. Si ambas versiones cambian, PlainJot protege el borrador local y te permite elegir cuál conservar.

Eliminar desde la app nativa mueve el archivo Markdown a la Papelera de macOS para que siga siendo recuperable.

Pulsa la ruta de la esquina inferior izquierda para elegir otra carpeta local. PlainJot la recuerda, reinicia el watcher y comparte la selección con la CLI. Los archivos existentes nunca se mueven automáticamente.

## Debug Journal

Pulsa **+ Crear → Debug Journal** para crear un registro en Notas. Incluye: Síntoma, Hipótesis, Investigación, Root cause, Solución y Qué aprendí.

Los registros siguen siendo notas normales en la misma carpeta, identificadas con `type: note` y `kind: debug-journal` en el frontmatter YAML. Aparecen junto al resto de documentos; cambiar de pestaña no mueve ni elimina archivos. Los agentes pueden escribir ese frontmatter directamente o ejecutar:

```bash
plainjot add "Bug: Journal no abría" --kind debug-journal \
  --body "## Síntoma

Open Journal no hacía nada."
plainjot list --journals
```

La app y la CLI comparten las mismas plantillas. `--body` sustituye el texto inicial, incluso si se proporciona vacío. Estos registros no son tareas ni tienen estados de tarea.

## Libreta para desarrolladores

El menú **+ Crear** incluye **Análisis**, **Ticket**, **Roadmap**, **Decisión técnica**, **Refactorización**, **Review** y **Handoff de sesión**, además de Debug Journal. Los tickets son Tareas normales con criterios de aceptación en el cuerpo. Los análisis tienen su sección; las demás plantillas siguen en Notas. Las notas antiguas o con tipos desconocidos siguen visibles sin clasificación automática.

El encabezado muestra el proyecto y tipo del documento, incluso con la barra izquierda oculta. Pulsa **⌘P** o el icono de búsqueda del encabezado para cambiar de documento entre todos los proyectos sin mostrar la barra. Busca por título, proyecto o tipo; usa las flechas y Enter para abrir, o Escape para cerrar.

Al elegir un proyecto, PlainJot abre su **Mapa de contexto**. El mapa reúne notas, ideas, análisis, decisiones y tareas en un lienzo conectado. Puedes ordenarlo automáticamente hacia la derecha o hacia abajo y después arrastrar cada tarjeta donde resulte más clara. Las posiciones son una preferencia visual local; las relaciones `parent` en Markdown siguen siendo la fuente de verdad compartida. **+** junto a una tarjeta crea un documento relacionado y **Escribir → Depende de** cambia la relación sin mover ni renombrar archivos.

Las relaciones son metadatos Markdown normales. `parent` contiene el nombre del archivo padre; las referencias rotas o circulares creadas externamente se muestran para revisión y nunca se reparan silenciosamente:

```yaml
project: Mi App
kind: analysis
parent: idea-modo-offline.md
```

Para ordenar una nota existente, abre **Escribir → Tipo → Análisis**. Solo actualiza el frontmatter: no cambia el nombre ni el cuerpo del archivo. Puedes revertirlo eligiendo **Nota**. Las tareas y pizarras no se convierten desde este selector. Los agentes pueden crear análisis directamente:

```bash
plainjot add "Investigación de autenticación" --kind analysis --project mi-app --source codex
plainjot add "Idea: modo offline" --kind idea --project mi-app --parent roadmap-mi-app.md
plainjot list --analyses --project mi-app
```

El filtro **Proyecto**, encima de la navegación, agrupa documentos y tareas, incluido Sprint View. Los elementos nuevos heredan el proyecto seleccionado; **Todos los proyectos** no exige asignar uno. Edita el proyecto en **Escribir** (o **Markdown** para pizarras); la vista previa oculta los controles de metadatos. Son metadatos YAML, no carpetas; las notas antiguas no necesitan migración. Vaciar el campo quita la asignación, no el documento.

```bash
plainjot task "Corregir login" --template ticket --project mi-app --source codex
plainjot add "Decisión de arquitectura" --kind decision --project mi-app
plainjot add "Retomar mañana" --kind handoff --project mi-app --source claude-code
plainjot list --inbox --project mi-app
plainjot search "login" --project mi-app
```

Enlaza documentos con Markdown normal, por ejemplo `[Investigación del login](bug-login.md)`. En vista previa el enlace abre ese archivo de la carpeta activa dentro de PlainJot. No se permiten rutas absolutas, rutas padre, subcarpetas ni symlinks. Renombrar un archivo no actualiza sus referencias automáticamente. Las listas de verificación se muestran en vista previa; sus marcas `[ ]` / `[x]` se cambian en Escribir.

Cualquier agente con acceso local al filesystem puede usar los comandos o escribir Markdown directamente. No requiere una conexión con la app ni una integración específica. Las plantillas son guías para completar, no hallazgos generados automáticamente.

## Pizarra

Pulsa **+ Crear → Pizarra** para dibujar dentro de Notas. Incluye lápiz, borrador de trazos completos, rectángulos, flechas, texto, cuatro colores y deshacer/rehacer. Los dibujos se guardan automáticamente con el mismo almacenamiento de las notas. Puedes exportar SVG con el diálogo nativo de guardado o mediante una descarga en el navegador durante desarrollo. No incluye PNG ni colaboración.

Cada pizarra es un `.md` normal con `type: note`, `kind: whiteboard`, proyecto opcional y un bloque JSON `plainjot-whiteboard`. Consulta [el formato del dibujo](docs/WHITEBOARD.md). Los agentes pueden crear o editar esos archivos directamente; los conflictos protegen el borrador local. Enlaza una pizarra desde un journal con `[Flujo](arquitectura.md)`; debajo del lienzo aparece un enlace listo para copiar. Los datos inválidos o de una versión desconocida se conservan y se pueden corregir en la pestaña **Markdown**.

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
node --test test_frontend.js test_whiteboard.js
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
