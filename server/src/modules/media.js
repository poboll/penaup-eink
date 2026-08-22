/* Copyright (c) 2026 poboll - LicenseRef-Poboll-NonCommercial */
import fs from 'node:fs';
import path from 'node:path';

export function safeFilename(value, fallback = 'upload.bin') {
  const base = path.basename(String(value || fallback));
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96) || fallback;
}

export function isImageMime(mime) { return ['image/jpeg', 'image/png', 'image/webp'].includes(String(mime || '').toLowerCase()); }

export function isImageMagic(buffer, mime) {
  const normalized = String(mime || '').toLowerCase();
  if (normalized === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (normalized === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (normalized === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

function stripJpegMetadata(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return buffer;
  const chunks = [buffer.subarray(0, 2)];
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      chunks.push(buffer.subarray(offset));
      break;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) {
      chunks.push(buffer.subarray(offset));
      break;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      chunks.push(buffer.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    if (offset + 4 > buffer.length) return buffer;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    const segmentEnd = offset + 2 + segmentLength;
    if (segmentLength < 2 || segmentEnd > buffer.length) return buffer;
    // APP1 contains EXIF/XMP; APP13 contains IPTC; COM is free-form text.
    if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) chunks.push(buffer.subarray(offset, segmentEnd));
    offset = segmentEnd;
  }
  return Buffer.concat(chunks);
}

function stripPngMetadata(buffer) {
  if (buffer.length < 8) return buffer;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) return buffer;
  const chunks = [buffer.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) return buffer;
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    if (!['eXIf', 'tEXt', 'zTXt', 'iTXt'].includes(type)) chunks.push(buffer.subarray(offset, end));
    offset = end;
    if (type === 'IEND') break;
  }
  return offset === buffer.length ? Buffer.concat(chunks) : buffer;
}

function stripWebpMetadata(buffer) {
  if (buffer.length < 12 || buffer.subarray(0, 4).toString('ascii') !== 'RIFF' || buffer.subarray(8, 12).toString('ascii') !== 'WEBP') return buffer;
  const chunks = [Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')];
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString('ascii');
    const size = buffer.readUInt32LE(offset + 4);
    const payloadEnd = offset + 8 + size;
    const chunkEnd = payloadEnd + (size % 2);
    if (chunkEnd > buffer.length) return buffer;
    // EXIF, XMP and ICCP are metadata chunks; keep VP8/VP8L/VP8X/ANIM data.
    if (!['EXIF', 'XMP ', 'ICCP'].includes(type)) chunks.push(buffer.subarray(offset, chunkEnd));
    offset = chunkEnd;
  }
  if (offset !== buffer.length) return buffer;
  const result = Buffer.concat(chunks);
  result.writeUInt32LE(result.length - 8, 4);
  return result;
}

export function stripImageMetadata(buffer, mime) {
  const normalized = String(mime || '').toLowerCase();
  if (normalized === 'image/jpeg') return stripJpegMetadata(buffer);
  if (normalized === 'image/png') return stripPngMetadata(buffer);
  if (normalized === 'image/webp') return stripWebpMetadata(buffer);
  return buffer;
}

export function mediaAbsolutePath(config, storedPath) {
  const mediaRoot = path.resolve(config.mediaDir);
  const absolutePath = path.resolve(config.dataDir, String(storedPath || ''));
  const relative = path.relative(mediaRoot, absolutePath);
  if (!storedPath || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  // A database path can still point at a symlink inside data/media. Resolve
  // existing files before serving them so the lexical check cannot be
  // bypassed into an arbitrary host path.
  try {
    const realMediaRoot = fs.realpathSync.native(mediaRoot);
    const realPath = fs.realpathSync.native(absolutePath);
    const realRelative = path.relative(realMediaRoot, realPath);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) return null;
    return realPath;
  } catch (error) {
    if (error?.code !== 'ENOENT') return null;
  }
  return absolutePath;
}
