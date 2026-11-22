/* Read only the primary XML member of an Apple Health ZIP. All bytes stay local. */
(() => {
  "use strict";

  const U16_MAX = 0xffff;
  const U32_MAX = 0xffffffff;
  const utf8 = new TextDecoder();
  const invalid = () => new Error("El ZIP de Salud está incompleto o dañado. Prueba con una exportación nueva.");
  const splitArchive = () => new Error("Selecciona una exportación de Salud en un único archivo ZIP.");
  const u16 = (view, offset) => view.getUint16(offset, true);
  const u32 = (view, offset) => view.getUint32(offset, true);

  function u64(view, offset) {
    const value = Number(view.getBigUint64(offset, true));
    if (!Number.isSafeInteger(value)) throw invalid();
    return value;
  }

  function checkRange(offset, length, size) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
        offset < 0 || length < 0 || offset > size - length) throw invalid();
  }

  async function readView(file, offset, length) {
    checkRange(offset, length, file.size);
    return new DataView(await file.slice(offset, offset + length).arrayBuffer());
  }

  // The last ZIP record includes a variable-length archive comment.
  async function directoryLocation(file) {
    if (file.size < 22) throw invalid();
    const tailStart = Math.max(0, file.size - 22 - U16_MAX);
    const tail = await readView(file, tailStart, file.size - tailStart);
    let end = tail.byteLength - 22;
    while (end >= 0) {
      if (u32(tail, end) === 0x06054b50 && end + 22 + u16(tail, end + 20) === tail.byteLength) break;
      end--;
    }
    if (end < 0) throw invalid();
    const absoluteEnd = tailStart + end;
    if (u16(tail, end + 4) !== 0 || u16(tail, end + 6) !== 0 ||
        u16(tail, end + 8) !== u16(tail, end + 10)) throw splitArchive();
    let count = u16(tail, end + 10);
    let length = u32(tail, end + 12);
    let offset = u32(tail, end + 16);
    let limit = absoluteEnd;
    if (absoluteEnd >= 20) {
      const locator = await readView(file, absoluteEnd - 20, 20);
      if (u32(locator, 0) === 0x07064b50) {
        if (u32(locator, 4) !== 0 || u32(locator, 16) !== 1) throw splitArchive();
        limit = u64(locator, 8);
        checkRange(limit, 56, absoluteEnd - 20);
        const record = await readView(file, limit, 56);
        if (u32(record, 0) !== 0x06064b50 || u64(record, 4) < 44) throw invalid();
        checkRange(limit + 12, u64(record, 4), absoluteEnd - 20);
        if (u32(record, 16) !== 0 || u32(record, 20) !== 0 ||
            u64(record, 24) !== u64(record, 32)) throw splitArchive();
        count = u64(record, 32);
        length = u64(record, 40);
        offset = u64(record, 48);
      }
    }
    checkRange(offset, length, limit);
    if (count > Math.floor(length / 46)) throw invalid();
    return {offset, length, count};
  }

  function xmlRank(path) {
    const parts = path.split("/");
    if (parts.length > 2 || parts.some(part => !part || part.startsWith(".") || part.includes("\\") || part.includes("\0"))) return 0;
    if (!/^(?:export|exportar)\.xml$/i.test(parts.at(-1))) return 0;
    if (parts.length === 1) return 1;
    return /(?:health|salud|santé|gesundheit|saúde)/i.test(parts[0]) ? 2 : 0;
  }

  // ZIP64 adds replacement fields only for values marked with the 32-bit sentinel.
  function entryLocation(header, extra) {
    const member = {size:u32(header, 24), packed:u32(header, 20), offset:u32(header, 42), disk:u16(header, 34)};
    const fields = Object.keys(member).filter(key => member[key] === (key === "disk" ? U16_MAX : U32_MAX));
    if (fields.length) {
      let found = false;
      for (let i = 0; i < extra.byteLength;) {
        checkRange(i, 4, extra.byteLength);
        const tag = u16(extra, i), length = u16(extra, i + 2);
        let at = i + 4;
        checkRange(at, length, extra.byteLength);
        i = at + length;
        if (tag !== 1) continue;
        for (const key of fields) {
          const width = key === "disk" ? 4 : 8;
          checkRange(at, width, i);
          member[key] = width === 4 ? u32(extra, at) : u64(extra, at);
          at += width;
        }
        found = true;
        break;
      }
      if (!found) throw invalid();
    }
    if (member.disk !== 0) throw splitArchive();
    return member;
  }

  async function findXml(file, directory) {
    let cache = new ArrayBuffer(0), base = -1;
    const limit = directory.offset + directory.length;
    async function directoryView(offset, length) {
      checkRange(offset, length, limit);
      if (offset < base || offset + length > base + cache.byteLength) {
        base = offset;
        cache = await file.slice(base, Math.min(limit, base + Math.max(length, 256 * 1024))).arrayBuffer();
      }
      return new DataView(cache, offset - base, length);
    }
    let position = directory.offset, selected = null, highest = 0, ambiguous = false;
    for (let i = 0; i < directory.count; i++) {
      const header = await directoryView(position, 46);
      if (u32(header, 0) !== 0x02014b50) throw invalid();
      const nameSize = u16(header, 28), extraSize = u16(header, 30);
      const body = position + 46;
      const remaining = nameSize + extraSize + u16(header, 32);
      checkRange(body, remaining, limit);
      position = body + remaining;
      const filename = utf8.decode(await directoryView(body, nameSize));
      const rank = xmlRank(filename);
      if (!rank || rank < highest) continue;
      if (rank === highest) { ambiguous = true; continue; }
      highest = rank;
      ambiguous = false;
      const extra = await directoryView(body + nameSize, extraSize);
      selected = {...entryLocation(header, extra), filename, method:u16(header, 10),
        flags:u16(header, 8), crc:u32(header, 16)};
    }
    if (!selected) throw new Error("El ZIP no contiene el XML principal de Salud (export.xml o exportar.xml). Selecciona el ZIP original del iPhone.");
    if (ambiguous) throw new Error("El ZIP contiene varias exportaciones de Salud. Descomprímelo y selecciona el XML que quieras importar.");
    return selected;
  }

  const crcTable = Uint32Array.from({length:256}, (_, value) => {
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    return value >>> 0;
  });

  async function checkStored(bytes, expectedCrc) {
    const reader = bytes.stream().getReader();
    let crc = U32_MAX;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        for (const byte of part.value) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
      }
    } finally { reader.releaseLock(); }
    if (((~crc) >>> 0) !== expectedCrc) throw invalid();
    return bytes;
  }

  async function inflate(bytes, member) {
    let decompressor;
    try { decompressor = new DecompressionStream("gzip"); }
    catch { throw new Error("Tu navegador no admite la descompresión. Descomprime el ZIP y elige el XML de Salud."); }
    // Gzip encloses the same raw DEFLATE stream and verifies the ZIP CRC natively.
    const header = Uint8Array.of(31, 139, 8, 0, 0, 0, 0, 0, 0, 255);
    const trailer = new DataView(new ArrayBuffer(8));
    trailer.setUint32(0, member.crc, true);
    trailer.setUint32(4, member.size, true);
    let size = 0;
    const bounded = new TransformStream({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > member.size) throw invalid();
        controller.enqueue(chunk);
      }
    });
    try {
      const stream = new Blob([header, bytes, trailer]).stream().pipeThrough(decompressor).pipeThrough(bounded);
      const xml = await new Response(stream, {headers:{"Content-Type":"application/xml"}}).blob();
      if (xml.size !== member.size) throw invalid();
      return xml;
    } catch { throw invalid(); }
  }

  async function open(file) {
    const directory = await directoryLocation(file);
    const member = await findXml(file, directory);
    if (member.flags & 0x41) throw new Error("El ZIP está cifrado. Selecciona la exportación original de Salud.");
    if (member.method !== 0 && member.method !== 8) throw new Error("El método de compresión no es compatible. Descomprime el ZIP y elige el XML de Salud.");
    checkRange(member.offset, 30, directory.offset);
    const header = await readView(file, member.offset, 30);
    if (u32(header, 0) !== 0x04034b50 || u16(header, 8) !== member.method || u16(header, 6) !== member.flags) throw invalid();
    const nameLength = u16(header, 26), extraLength = u16(header, 28);
    const start = member.offset + 30 + nameLength + extraLength;
    checkRange(start, member.packed, directory.offset);
    if (utf8.decode(await readView(file, member.offset + 30, nameLength)) !== member.filename) throw invalid();
    const bytes = file.slice(start, start + member.packed, "application/xml");
    if (member.method === 8) return inflate(bytes, member);
    if (member.size !== member.packed) throw invalid();
    return checkStored(bytes, member.crc);
  }

  window.WatchZip = Object.freeze({open});
})();
