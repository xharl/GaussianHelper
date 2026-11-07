/**
 * @fileoverview Minimal, dependency-free ZIP writer.
 *
 * The workflow bundle needs a single archive that works offline in the browser
 * and in Node tests, so this module writes ZIP files directly instead of
 * relying on a compression library. Entries are stored uncompressed
 * (method 0): correctness and deterministic bytes matter more than size for
 * small Gaussian inputs.
 *
 * The implementation writes, for every entry, a local file header followed by
 * its data, then a central directory and an end-of-central-directory record.
 * Filenames are UTF-8 and flagged as such (general-purpose bit 11).
 */

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const VERSION_NEEDED = 20;
const VERSION_MADE_BY = (3 << 8) | VERSION_NEEDED; // UNIX, ZIP 2.0
const UNIX_REGULAR_FILE_ATTRIBUTES = (0o100644 << 16) >>> 0;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const textEncoder = new TextEncoder();

/**
 * Compute the CRC-32 (IEEE 802.3, reflected) checksum used by ZIP entries.
 *
 * @param {Uint8Array} bytes
 * @returns {number} Unsigned 32-bit checksum.
 */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) {
    crc = CRC32_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Convert a date to the DOS date/time pair stored in ZIP headers. UTC is used
 * so an export is reproducible regardless of the local timezone.
 *
 * @param {Date|string|number} value
 * @returns {{ dosTime: number, dosDate: number }}
 */
export function toDosDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('A valid date is required for ZIP timestamps.');
  const year = Math.min(Math.max(date.getUTCFullYear(), 1980), 2107);
  return {
    dosTime: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
    dosDate: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

/**
 * Build a ZIP archive from stored entries.
 *
 * @param {Array<{name: string, data: string|Uint8Array|ArrayBuffer}>} entries
 *   Archive entries. Names must be relative, slash-separated paths without
 *   `..` segments or backslashes. Data may be text (UTF-8 encoded) or bytes.
 * @param {{ date?: Date|string|number }} [options]
 * @returns {Uint8Array} Complete ZIP archive bytes.
 */
export function createZip(entries, options = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('A ZIP archive needs at least one entry.');
  }
  if (entries.length > MAX_UINT16) {
    throw new Error(`A ZIP archive may contain at most ${MAX_UINT16} entries.`);
  }

  const { dosTime, dosDate } = toDosDateTime(options.date ?? new Date());
  const prepared = [];
  const seenNames = new Set();

  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string') throw new TypeError('Each ZIP entry needs a string name.');
    const name = validateEntryName(entry.name);
    if (seenNames.has(name)) throw new Error(`Duplicate ZIP entry name: "${name}".`);
    seenNames.add(name);
    const data = toBytes(entry.data, name);
    if (data.length > MAX_UINT32) throw new Error(`ZIP entry "${name}" is too large.`);
    prepared.push({
      nameBytes: textEncoder.encode(name),
      data,
      crc: crc32(data),
    });
  }

  // Local headers + file data.
  const localChunks = [];
  let offset = 0;
  for (const entry of prepared) {
    if (entry.nameBytes.length > MAX_UINT16) throw new Error('ZIP entry name is too long.');
    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);
    view.setUint32(0, LOCAL_FILE_HEADER_SIGNATURE, true);
    view.setUint16(4, VERSION_NEEDED, true);
    view.setUint16(6, UTF8_FLAG, true);
    view.setUint16(8, STORE_METHOD, true);
    view.setUint16(10, dosTime, true);
    view.setUint16(12, dosDate, true);
    view.setUint32(14, entry.crc, true);
    view.setUint32(18, entry.data.length, true);
    view.setUint32(22, entry.data.length, true);
    view.setUint16(26, entry.nameBytes.length, true);
    view.setUint16(28, 0, true);
    entry.localOffset = offset;
    localChunks.push(header, entry.nameBytes, entry.data);
    offset += header.length + entry.nameBytes.length + entry.data.length;
    if (offset > MAX_UINT32) throw new Error('ZIP archive exceeds the 4 GiB limit.');
  }

  const centralOffset = offset;
  const centralChunks = [];
  for (const entry of prepared) {
    const header = new Uint8Array(46);
    const view = new DataView(header.buffer);
    view.setUint32(0, CENTRAL_DIRECTORY_SIGNATURE, true);
    view.setUint16(4, VERSION_MADE_BY, true);
    view.setUint16(6, VERSION_NEEDED, true);
    view.setUint16(8, UTF8_FLAG, true);
    view.setUint16(10, STORE_METHOD, true);
    view.setUint16(12, dosTime, true);
    view.setUint16(14, dosDate, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.data.length, true);
    view.setUint32(24, entry.data.length, true);
    view.setUint16(28, entry.nameBytes.length, true);
    view.setUint16(30, 0, true); // extra field length
    view.setUint16(32, 0, true); // file comment length
    view.setUint16(34, 0, true); // disk number start
    view.setUint16(36, 0, true); // internal attributes
    view.setUint32(38, UNIX_REGULAR_FILE_ATTRIBUTES, true);
    view.setUint32(42, entry.localOffset, true);
    centralChunks.push(header, entry.nameBytes);
    offset += header.length + entry.nameBytes.length;
    if (offset > MAX_UINT32) throw new Error('ZIP archive exceeds the 4 GiB limit.');
  }

  const centralSize = offset - centralOffset;
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  eocdView.setUint16(4, 0, true); // number of this disk
  eocdView.setUint16(6, 0, true); // disk with central directory
  eocdView.setUint16(8, prepared.length, true);
  eocdView.setUint16(10, prepared.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, centralOffset, true);
  eocdView.setUint16(20, 0, true); // archive comment length

  const totalLength = offset + eocd.length;
  const archive = new Uint8Array(totalLength);
  let cursor = 0;
  for (const chunk of [...localChunks, ...centralChunks, eocd]) {
    archive.set(chunk, cursor);
    cursor += chunk.length;
  }
  return archive;
}

function validateEntryName(name) {
  if (!name || name.length > MAX_UINT16) throw new Error('ZIP entry names must be 1 to 65535 characters.');
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.includes('\\') || /[\0\r\n]/.test(name)) {
    throw new Error(`ZIP entry name "${name}" is not a safe relative path.`);
  }
  if (name.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`ZIP entry name "${name}" is not a safe relative path.`);
  }
  return name;
}

function toBytes(data, name) {
  if (typeof data === 'string') return textEncoder.encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError(`ZIP entry "${name}" data must be text, a Uint8Array, or an ArrayBuffer.`);
}
