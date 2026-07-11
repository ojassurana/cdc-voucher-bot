import qrcode from "qrcode-generator";

export function qrPayloadToPng(payload: string): Uint8Array {
  const qr = qrcode(0, "H");
  qr.addData(payload);
  qr.make();
  const modules = qr.getModuleCount();
  const margin = 4;
  const scale = modules > 70 ? 7 : modules > 55 ? 8 : 10;
  const size = (modules + margin * 2) * scale;
  const raw = new Uint8Array((size + 1) * size);
  let pointer = 0;
  for (let y = 0; y < size; y += 1) {
    raw[pointer++] = 0;
    const moduleY = Math.floor(y / scale) - margin;
    for (let x = 0; x < size; x += 1) {
      const moduleX = Math.floor(x / scale) - margin;
      const dark =
        moduleX >= 0 &&
        moduleY >= 0 &&
        moduleX < modules &&
        moduleY < modules &&
        qr.isDark(moduleY, moduleX);
      raw[pointer++] = dark ? 0 : 255;
    }
  }
  return encodePngGrayscale(size, size, raw);
}

function encodePngGrayscale(width: number, height: number, rawImageBytes: Uint8Array): Uint8Array {
  const signature = bytes([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = new Uint8Array(13);
  writeUint32(header, 0, width);
  writeUint32(header, 4, height);
  header[8] = 8;
  header[9] = 0;
  const imageData = zlibStore(rawImageBytes);
  return concatBytes([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", imageData),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const length = new Uint8Array(4);
  writeUint32(length, 0, data.length);
  const crc = new Uint8Array(4);
  writeUint32(crc, 0, crc32(concatBytes([typeBytes, data])));
  return concatBytes([length, typeBytes, data, crc]);
}

function zlibStore(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes([120, 1])];
  let offset = 0;
  while (offset < data.length) {
    const length = Math.min(65_535, data.length - offset);
    const final = offset + length >= data.length;
    const header = new Uint8Array(5);
    header[0] = final ? 1 : 0;
    header[1] = length & 255;
    header[2] = (length >>> 8) & 255;
    const inverseLength = ~length & 65_535;
    header[3] = inverseLength & 255;
    header[4] = (inverseLength >>> 8) & 255;
    parts.push(header, data.subarray(offset, offset + length));
    offset += length;
  }
  const adler = new Uint8Array(4);
  writeUint32(adler, 0, adler32(data));
  parts.push(adler);
  return concatBytes(parts);
}

function adler32(data: Uint8Array): number {
  let first = 1;
  let second = 0;
  for (const byte of data) {
    first = (first + byte) % 65_521;
    second = (second + first) % 65_521;
  }
  return ((second << 16) | first) >>> 0;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint32(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = (value >>> 24) & 255;
  buffer[offset + 1] = (value >>> 16) & 255;
  buffer[offset + 2] = (value >>> 8) & 255;
  buffer[offset + 3] = value & 255;
}

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
