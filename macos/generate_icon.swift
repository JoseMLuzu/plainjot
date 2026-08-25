import AppKit

guard CommandLine.arguments.count == 2 else {
    fputs("Uso: generate_icon.swift <salida.png>\n", stderr)
    exit(1)
}

let canvas = NSSize(width: 1024, height: 1024)
let image = NSImage(size: canvas)
image.lockFocus()

let background = NSBezierPath(roundedRect: NSRect(origin: .zero, size: canvas), xRadius: 220, yRadius: 220)
NSColor(calibratedRed: 0.16, green: 0.35, blue: 0.26, alpha: 1).setFill()
background.fill()

let pageRect = NSRect(x: 232, y: 170, width: 560, height: 684)
let page = NSBezierPath(roundedRect: pageRect, xRadius: 70, yRadius: 70)
NSColor(calibratedWhite: 0.97, alpha: 1).setFill()
page.fill()

let shadowLine = NSBezierPath()
shadowLine.move(to: NSPoint(x: 330, y: 365))
shadowLine.line(to: NSPoint(x: 694, y: 365))
shadowLine.lineWidth = 26
shadowLine.lineCapStyle = .round
NSColor(calibratedRed: 0.78, green: 0.80, blue: 0.76, alpha: 1).setStroke()
shadowLine.stroke()

let secondLine = NSBezierPath()
secondLine.move(to: NSPoint(x: 330, y: 280))
secondLine.line(to: NSPoint(x: 604, y: 280))
secondLine.lineWidth = 26
secondLine.lineCapStyle = .round
NSColor(calibratedRed: 0.78, green: 0.80, blue: 0.76, alpha: 1).setStroke()
secondLine.stroke()

let attributes: [NSAttributedString.Key: Any] = [
    .font: NSFont(name: "Georgia-BoldItalic", size: 330) ?? NSFont.boldSystemFont(ofSize: 330),
    .foregroundColor: NSColor(calibratedRed: 0.16, green: 0.35, blue: 0.26, alpha: 1),
]
let letter = NSAttributedString(string: "P", attributes: attributes)
let letterSize = letter.size()
letter.draw(at: NSPoint(x: (1024 - letterSize.width) / 2 - 8, y: 440))

image.unlockFocus()

guard
    let tiff = image.tiffRepresentation,
    let bitmap = NSBitmapImageRep(data: tiff),
    let png = bitmap.representation(using: .png, properties: [:])
else {
    fputs("No se pudo generar el icono.\n", stderr)
    exit(1)
}

try png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]), options: .atomic)
