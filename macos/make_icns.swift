import Foundation

guard CommandLine.arguments.count >= 4, CommandLine.arguments.count.isMultiple(of: 2) else {
    fputs("Uso: make_icns.swift <salida.icns> <tipo> <imagen.png> [...]\n", stderr)
    exit(1)
}

struct IconChunk {
    let type: String
    let data: Data
}

var chunks: [IconChunk] = []
var index = 2
while index < CommandLine.arguments.count {
    let type = CommandLine.arguments[index]
    guard type.utf8.count == 4 else {
        fputs("El tipo ICNS debe tener cuatro caracteres: \(type)\n", stderr)
        exit(1)
    }
    let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[index + 1]))
    chunks.append(IconChunk(type: type, data: data))
    index += 2
}

func appendBigEndian(_ value: UInt32, to data: inout Data) {
    var bigEndian = value.bigEndian
    withUnsafeBytes(of: &bigEndian) { bytes in
        data.append(contentsOf: bytes)
    }
}

let totalSize = 8 + chunks.reduce(0) { $0 + 8 + $1.data.count }
guard totalSize <= UInt32.max else {
    fputs("El icono es demasiado grande.\n", stderr)
    exit(1)
}

var output = Data("icns".utf8)
appendBigEndian(UInt32(totalSize), to: &output)
for chunk in chunks {
    output.append(Data(chunk.type.utf8))
    appendBigEndian(UInt32(chunk.data.count + 8), to: &output)
    output.append(chunk.data)
}

try output.write(to: URL(fileURLWithPath: CommandLine.arguments[1]), options: .atomic)
