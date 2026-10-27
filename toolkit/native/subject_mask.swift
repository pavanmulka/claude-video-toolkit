// Subject masks for "text behind the subject" (Apple Vision, on-device, macOS 14+).
// Built on first use by toolkit/subject.py into .cache/bin/subject_mask (swiftc -O).
//
// Protocol (binary, little-endian, one frame at a time so the process stays warm):
//   in:  u32 width, u32 height, u32 mode (0 = every foreground subject, 1 = people only), width*height*4 bytes BGRA
//   out: u32 mask_width, u32 mask_height, mask_width*mask_height bytes (0 = background, 255 = subject)
import CoreVideo
import Foundation
import Vision

let input = FileHandle.standardInput
let output = FileHandle.standardOutput

func readExact(_ n: Int) -> Data? {
    var d = Data()
    while d.count < n {
        let chunk = input.readData(ofLength: n - d.count)
        if chunk.isEmpty { return nil }
        d.append(chunk)
    }
    return d
}

func u32(_ d: Data, _ at: Int) -> Int {
    return Int(d.subdata(in: at..<at + 4).withUnsafeBytes { $0.load(as: UInt32.self) })
}

func write(_ w: Int, _ h: Int, _ bytes: [UInt8]) {
    var hdr = Data()
    var a = UInt32(w), b = UInt32(h)
    hdr.append(Data(bytes: &a, count: 4))
    hdr.append(Data(bytes: &b, count: 4))
    output.write(hdr)
    output.write(Data(bytes))
}

func maskBytes(_ pb: CVPixelBuffer) -> (Int, Int, [UInt8]) {
    CVPixelBufferLockBaseAddress(pb, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
    let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb)
    let row = CVPixelBufferGetBytesPerRow(pb)
    let fmt = CVPixelBufferGetPixelFormatType(pb)
    var out = [UInt8](repeating: 0, count: w * h)
    guard let base = CVPixelBufferGetBaseAddress(pb) else { return (w, h, out) }
    for y in 0..<h {
        let line = base.advanced(by: y * row)
        for x in 0..<w {
            if fmt == kCVPixelFormatType_OneComponent32Float {
                let v = line.assumingMemoryBound(to: Float32.self)[x]
                out[y * w + x] = UInt8(max(0, min(255, v * 255)))
            } else {
                out[y * w + x] = line.assumingMemoryBound(to: UInt8.self)[x]
            }
        }
    }
    return (w, h, out)
}

while let hdr = readExact(12) {
    let w = u32(hdr, 0), h = u32(hdr, 4), mode = u32(hdr, 8)
    guard let px = readExact(w * h * 4) else { break }
    var pbOpt: CVPixelBuffer?
    let attrs = [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary
    CVPixelBufferCreate(nil, w, h, kCVPixelFormatType_32BGRA, attrs, &pbOpt)
    guard let pb = pbOpt else { write(1, 1, [0]); continue }
    CVPixelBufferLockBaseAddress(pb, [])
    let dst = CVPixelBufferGetBaseAddress(pb)!
    let row = CVPixelBufferGetBytesPerRow(pb)
    px.withUnsafeBytes { src in
        for y in 0..<h {
            memcpy(dst.advanced(by: y * row), src.baseAddress!.advanced(by: y * w * 4), w * 4)
        }
    }
    CVPixelBufferUnlockBaseAddress(pb, [])
    let handler = VNImageRequestHandler(cvPixelBuffer: pb, options: [:])
    var result: (Int, Int, [UInt8]) = (1, 1, [0])
    if mode == 1 {
        let req = VNGeneratePersonSegmentationRequest()
        req.qualityLevel = .accurate
        req.outputPixelFormat = kCVPixelFormatType_OneComponent8
        if (try? handler.perform([req])) != nil, let m = req.results?.first?.pixelBuffer {
            result = maskBytes(m)
        }
    } else {
        let req = VNGenerateForegroundInstanceMaskRequest()
        if (try? handler.perform([req])) != nil, let r = req.results?.first,
           let m = try? r.generateScaledMaskForImage(forInstances: r.allInstances, from: handler) {
            result = maskBytes(m)
        }
    }
    write(result.0, result.1, result.2)
}
