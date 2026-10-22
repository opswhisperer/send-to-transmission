import AppKit
import Foundation
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
func png(_ size: Int) -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    let context = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context
    let scale = CGFloat(size) / 128
    let transform = NSAffineTransform(); transform.scale(by: scale); transform.concat()
    NSColor(calibratedRed: 0.08, green: 0.47, blue: 0.42, alpha: 1).setFill()
    NSBezierPath(roundedRect: NSRect(x: 5, y: 5, width: 118, height: 118), xRadius: 27, yRadius: 27).fill()
    NSColor.white.setStroke()
    let arrow = NSBezierPath(); arrow.lineWidth = 10; arrow.lineCapStyle = .round; arrow.lineJoinStyle = .round
    arrow.move(to: NSPoint(x: 39, y: 45)); arrow.line(to: NSPoint(x: 88, y: 91)); arrow.move(to: NSPoint(x: 56, y: 91)); arrow.line(to: NSPoint(x: 88, y: 91)); arrow.line(to: NSPoint(x: 88, y: 59)); arrow.stroke()
    let tray = NSBezierPath(); tray.lineWidth = 7; tray.lineCapStyle = .round; tray.lineJoinStyle = .round
    tray.move(to: NSPoint(x: 31, y: 48)); tray.line(to: NSPoint(x: 31, y: 30)); tray.line(to: NSPoint(x: 93, y: 30)); tray.line(to: NSPoint(x: 93, y: 41)); tray.stroke()
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}
let iconFolder = root.appendingPathComponent("Extension/icons")
try FileManager.default.createDirectory(at: iconFolder, withIntermediateDirectories: true)
for size in [16, 32, 48, 64, 96, 128, 256, 512, 1024] { try png(size).write(to: iconFolder.appendingPathComponent("icon-\(size).png")) }
let assets = root.appendingPathComponent("macOS/Send to Transmission/Send to Transmission/Assets.xcassets/AppIcon.appiconset")
var images: [[String: String]] = []
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let name = "icon-\(size)-\(scale)x.png"
        try png(size * scale).write(to: assets.appendingPathComponent(name))
        images.append(["idiom": "mac", "size": "\(size)x\(size)", "scale": "\(scale)x", "filename": name])
    }
}
try JSONSerialization.data(withJSONObject: ["images": images, "info": ["author": "xcode", "version": 1]], options: [.prettyPrinted, .sortedKeys]).write(to: assets.appendingPathComponent("Contents.json"))
try png(256).write(to: root.appendingPathComponent("macOS/Send to Transmission/Send to Transmission/Resources/Icon.png"))
