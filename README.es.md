# PlainJot

> Notes that stay yours.

PlainJot es una aplicación pequeña y local para guardar notas Markdown. Está pensada para escribir directamente o para pedirle a un agente de programación que guarde información sin mezclarla con Apple Notes.

- Sin cuentas ni base de datos.
- Sin dependencias externas.
- Las notas son archivos `.md` normales.
- Búsqueda, guardado automático, vista previa Markdown y tema claro/oscuro.
- Aplicación nativa para macOS y servidor web para desarrollo.

## Aplicación para macOS

Requiere macOS 13 o posterior y las herramientas de línea de comandos de Xcode para compilar.

```bash
git clone https://github.com/JoseMLuzu/plainjot.git
cd plainjot
./scripts/build_macos_app.sh
```

La aplicación se genera en `dist/PlainJot.app`. Puedes moverla a la carpeta `Applications` y abrirla normalmente; no necesita Python ni un servidor local.

## Dónde se guardan las notas

PlainJot usa esta carpeta de forma predeterminada:

```text
~/Documents/PlainJot
```

Cada nota es un archivo Markdown independiente. Por ejemplo, puedes pedirle a un agente:

> Guarda un resumen de esta sesión en `~/Documents/PlainJot/resumen-del-proyecto.md`, usando el título como encabezado `#`.

Las instalaciones anteriores llamadas “Notas Local” migran automáticamente la carpeta `~/Documents/NotasLocal` cuando es posible.

## Desarrollo web

La versión web de desarrollo requiere Python 3.10 o posterior y utiliza únicamente la biblioteca estándar:

```bash
python3 app.py
```

Después abre `http://127.0.0.1:8765`. También puedes elegir otra carpeta o puerto:

```bash
python3 app.py --notes-dir ~/Documents/MisNotas --port 9000
```

## Atajos de teclado

- `⌘ N`: crear una nota.
- `⌘ K`: buscar.
- `⌘ S`: guardar inmediatamente.
- `⌘ ⇧ P`: alternar entre escritura y vista previa.

## Pruebas

```bash
python3 -m unittest -v
./scripts/build_macos_app.sh
./dist/PlainJot.app/Contents/MacOS/PlainJot --self-test
```

## Contribuciones

Los reportes de errores, ideas y pull requests son bienvenidos. Antes de enviar cambios, ejecuta las pruebas y mantén el enfoque de PlainJot: una experiencia sencilla, local y basada en archivos abiertos.

## Licencia

PlainJot se distribuye bajo la [Mozilla Public License 2.0](LICENSE).
