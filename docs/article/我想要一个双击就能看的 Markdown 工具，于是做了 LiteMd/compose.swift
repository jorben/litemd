// 复现文章封面与保真对比图：swift docs/wechat/compose.swift
// 封面背景由 MCP 生图；应用界面和 diff 使用本地真实素材合成。
import AppKit

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("docs/wechat")
let images = root.appendingPathComponent("images")
var canvasHeight: CGFloat = 0
func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> NSRect {
    NSRect(x: x, y: canvasHeight-y-h, width: w, height: h)
}
func color(_ hex: UInt32) -> NSColor {
    NSColor(srgbRed: CGFloat((hex>>16)&255)/255, green: CGFloat((hex>>8)&255)/255, blue: CGFloat(hex&255)/255, alpha: 1)
}
func box(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ fill: UInt32, radius: CGFloat = 0) {
    color(fill).setFill()
    NSBezierPath(roundedRect: rect(x,y,w,h), xRadius: radius, yRadius: radius).fill()
}
func text(_ s: String, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ size: CGFloat, _ fill: UInt32 = 0x252A32, bold: Bool = false, mono: Bool = false) {
    let font = mono ? NSFont.monospacedSystemFont(ofSize: size, weight: .regular) : NSFont.systemFont(ofSize: size, weight: bold ? .semibold : .regular)
    (s as NSString).draw(in: rect(x,y,w,size*1.65), withAttributes: [.font: font, .foregroundColor: color(fill)])
}
func picture(_ name: String, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, shadow: Bool = false) {
    let image = NSImage(contentsOf: images.appendingPathComponent(name))!
    NSGraphicsContext.saveGraphicsState()
    if shadow {
        let s=NSShadow(); s.shadowColor=NSColor.black.withAlphaComponent(0.18); s.shadowBlurRadius=25; s.shadowOffset=NSSize(width:0,height:-12); s.set()
    }
    image.draw(in: rect(x,y,w,h), from: .zero, operation: .sourceOver, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
}
func render(_ file: String, _ width: Int, _ height: Int, draw: () -> Void) {
    canvasHeight=CGFloat(height)
    let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:width,pixelsHigh:height,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:bitmap)
    NSGraphicsContext.current?.imageInterpolation = .high
    draw()
    NSGraphicsContext.restoreGraphicsState()
    try! bitmap.representation(using:.png,properties:[:])!.write(to: images.appendingPathComponent(file))
}
render("cover.png",1880,800) {
    picture("cover-background.png",0,0,1880,800)
    picture("app-preview-wide.png",840,88,952,632.1875,shadow:true)
}
render("fidelity-diff.png",1920,1160) {
    box(0,0,1920,1160,0xF6F7FA)
    text("改过的地方写回，其余保留原文",64,38,1780,52,bold:true)
    text("所见即所得编辑 → 实际保存 → 按字节核对",66,116,1760,28,0x687382)
    text("LiteMd 实际窗口",64,190,870,28,bold:true)
    picture("app-edit.png",64,246,858,702,shadow:true)
    box(978,246,878,702,0xFFFFFF,radius:20)
    text("保存前后的实际差异",1010,270,816,30,bold:true)
    let diff = try! String(contentsOf: root.appendingPathComponent("evidence/fidelity.diff"),encoding:.utf8)
    for (i,line) in diff.split(separator:"\n",omittingEmptySubsequences:false).enumerated() {
        let s=String(line)
        let lineY=CGFloat(336+i*49)
        var ink: UInt32=0x475569
        if s.hasPrefix("-") && !s.hasPrefix("---") { box(1000,lineY-3,834,46,0xFFF0EF,radius:4); ink=0xA52B28 }
        if s.hasPrefix("+") && !s.hasPrefix("+++") { box(1000,lineY-3,834,46,0xEAF7EF,radius:4); ink=0x17683B }
        text(s,1010,lineY,816,26,ink,mono:true)
    }
    box(64,1000,1792,90,0xE8F2FF,radius:16)
    text("本例核对通过：仅将「错别字」改为「小问题」，其余字节完全一致。",92,1024,1730,30,0x285896,bold:true)
}
print("已生成 cover.png（1880×800）与 fidelity-diff.png（1920×1160）")
