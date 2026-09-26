/*
 * QR Code generator core adapted from Project Nayuki's TypeScript implementation.
 * Copyright (c) Project Nayuki. MIT License.
 * https://www.nayuki.io/page/qr-code-generator-library
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 */

type Bit = number;
type Byte = number;

function appendBits(value: number, length: number, buffer: Bit[]) {
  if (length < 0 || length > 31 || value >>> length !== 0) throw new RangeError('Value out of range');
  for (let i = length - 1; i >= 0; i--) buffer.push((value >>> i) & 1);
}

function getBit(value: number, index: number) {
  return ((value >>> index) & 1) !== 0;
}

function assert(condition: boolean) {
  if (!condition) throw new Error('QR assertion error');
}

class QrSegment {
  static readonly BYTE = { modeBits: 0x4, countBits: [8, 16, 16] as const };

  static makeBytes(data: readonly Byte[]) {
    const bits: Bit[] = [];
    for (const byte of data) appendBits(byte, 8, bits);
    return new QrSegment(data.length, bits);
  }

  static getTotalBits(segments: readonly QrSegment[], version: number) {
    let result = 0;
    const countBits = QrSegment.BYTE.countBits[Math.floor((version + 7) / 17)];
    for (const segment of segments) {
      if (segment.numChars >= (1 << countBits)) return Infinity;
      result += 4 + countBits + segment.bits.length;
    }
    return result;
  }

  private constructor(readonly numChars: number, private readonly bits: Bit[]) {}
  getData() { return this.bits.slice(); }
}

class Ecc {
  constructor(readonly ordinal: number, readonly formatBits: number) {}
}

export class QrCode {
  static readonly LOW = new Ecc(0, 1);
  static readonly MEDIUM = new Ecc(1, 0);
  static readonly QUARTILE = new Ecc(2, 3);
  static readonly HIGH = new Ecc(3, 2);
  static readonly MIN_VERSION = 1;
  static readonly MAX_VERSION = 40;

  readonly size: number;
  readonly mask: number;
  private readonly modules: boolean[][] = [];
  private isFunction: boolean[][] = [];

  static encodeText(text: string, errorCorrection = QrCode.MEDIUM) {
    const bytes = Array.from(new TextEncoder().encode(text));
    return QrCode.encodeSegments([QrSegment.makeBytes(bytes)], errorCorrection);
  }

  private static encodeSegments(segments: readonly QrSegment[], ecl: Ecc) {
    let version: number;
    let usedBits: number;
    for (version = QrCode.MIN_VERSION; ; version++) {
      const capacity = QrCode.getNumDataCodewords(version, ecl) * 8;
      const candidate = QrSegment.getTotalBits(segments, version);
      if (candidate <= capacity) {
        usedBits = candidate;
        break;
      }
      if (version >= QrCode.MAX_VERSION) throw new RangeError('QR data too long');
    }

    for (const next of [QrCode.MEDIUM, QrCode.QUARTILE, QrCode.HIGH]) {
      if (usedBits <= QrCode.getNumDataCodewords(version, next) * 8) ecl = next;
    }

    const bits: Bit[] = [];
    const countBits = QrSegment.BYTE.countBits[Math.floor((version + 7) / 17)];
    for (const segment of segments) {
      appendBits(QrSegment.BYTE.modeBits, 4, bits);
      appendBits(segment.numChars, countBits, bits);
      bits.push(...segment.getData());
    }
    assert(bits.length === usedBits);

    const capacity = QrCode.getNumDataCodewords(version, ecl) * 8;
    appendBits(0, Math.min(4, capacity - bits.length), bits);
    appendBits(0, (8 - bits.length % 8) % 8, bits);
    for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) appendBits(pad, 8, bits);

    const data: Byte[] = Array(Math.ceil(bits.length / 8)).fill(0);
    bits.forEach((bit, i) => { data[i >>> 3] |= bit << (7 - (i & 7)); });
    return new QrCode(version, ecl, data, -1);
  }

  private constructor(
    readonly version: number,
    readonly errorCorrectionLevel: Ecc,
    dataCodewords: readonly Byte[],
    mask: number
  ) {
    this.size = version * 4 + 17;
    const row = Array(this.size).fill(false) as boolean[];
    for (let i = 0; i < this.size; i++) {
      this.modules.push(row.slice());
      this.isFunction.push(row.slice());
    }

    this.drawFunctionPatterns();
    this.drawCodewords(this.addEccAndInterleave(dataCodewords));

    if (mask === -1) {
      let bestPenalty = Infinity;
      for (let candidate = 0; candidate < 8; candidate++) {
        this.applyMask(candidate);
        this.drawFormatBits(candidate);
        const penalty = this.getPenaltyScore();
        if (penalty < bestPenalty) {
          bestPenalty = penalty;
          mask = candidate;
        }
        this.applyMask(candidate);
      }
    }
    assert(mask >= 0 && mask <= 7);
    this.mask = mask;
    this.applyMask(mask);
    this.drawFormatBits(mask);
    this.isFunction = [];
  }

  getModule(x: number, y: number) {
    return x >= 0 && x < this.size && y >= 0 && y < this.size && this.modules[y][x];
  }

  private drawFunctionPatterns() {
    for (let i = 0; i < this.size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);

    const positions = this.getAlignmentPatternPositions();
    for (let i = 0; i < positions.length; i++) {
      for (let j = 0; j < positions.length; j++) {
        if (!(i === 0 && j === 0 || i === 0 && j === positions.length - 1 || i === positions.length - 1 && j === 0)) {
          this.drawAlignmentPattern(positions[i], positions[j]);
        }
      }
    }
    this.drawFormatBits(0);
    this.drawVersion();
  }

  private drawFormatBits(mask: number) {
    const data = this.errorCorrectionLevel.formatBits << 3 | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = (data << 10 | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) this.setFunctionModule(8, i, getBit(bits, i));
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i++) this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
    this.setFunctionModule(8, this.size - 8, true);
  }

  private drawVersion() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = this.version << 12 | rem;
    for (let i = 0; i < 18; i++) {
      const color = getBit(bits, i);
      const a = this.size - 11 + i % 3;
      const b = Math.floor(i / 3);
      this.setFunctionModule(a, b, color);
      this.setFunctionModule(b, a, color);
    }
  }

  private drawFinderPattern(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFunctionModule(xx, yy, distance !== 2 && distance !== 4);
        }
      }
    }
  }

  private drawAlignmentPattern(x: number, y: number) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  private setFunctionModule(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  private addEccAndInterleave(data: readonly Byte[]) {
    const blockCount = QrCode.NUM_ERROR_CORRECTION_BLOCKS[this.errorCorrectionLevel.ordinal][this.version];
    const eccLength = QrCode.ECC_CODEWORDS_PER_BLOCK[this.errorCorrectionLevel.ordinal][this.version];
    const rawCodewords = Math.floor(QrCode.getNumRawDataModules(this.version) / 8);
    const shortBlockCount = blockCount - rawCodewords % blockCount;
    const shortBlockLength = Math.floor(rawCodewords / blockCount);
    const divisor = QrCode.reedSolomonComputeDivisor(eccLength);
    const blocks: Byte[][] = [];

    for (let i = 0, k = 0; i < blockCount; i++) {
      const chunk = data.slice(k, k + shortBlockLength - eccLength + (i < shortBlockCount ? 0 : 1));
      k += chunk.length;
      const block = [...chunk];
      const ecc = QrCode.reedSolomonComputeRemainder(block, divisor);
      if (i < shortBlockCount) block.push(0);
      blocks.push(block.concat(ecc));
    }

    const result: Byte[] = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((block, j) => {
        if (i !== shortBlockLength - eccLength || j >= shortBlockCount) result.push(block[i]);
      });
    }
    assert(result.length === rawCodewords);
    return result;
  }

  private drawCodewords(data: readonly Byte[]) {
    let bitIndex = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < this.size; vertical++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vertical : vertical;
          if (!this.isFunction[y][x] && bitIndex < data.length * 8) {
            this.modules[y][x] = getBit(data[bitIndex >>> 3], 7 - (bitIndex & 7));
            bitIndex++;
          }
        }
      }
    }
    assert(bitIndex === data.length * 8);
  }

  private applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = x * y % 2 + x * y % 3 === 0; break;
          case 6: invert = (x * y % 2 + x * y % 3) % 2 === 0; break;
          case 7: invert = ((x + y) % 2 + x * y % 3) % 2 === 0; break;
          default: throw new RangeError('Invalid QR mask');
        }
        if (!this.isFunction[y][x] && invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  private getPenaltyScore() {
    let result = 0;
    for (let y = 0; y < this.size; y++) {
      let runColor = false;
      let runLength = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < this.size; x++) {
        if (this.modules[y][x] === runColor) {
          runLength++;
          if (runLength === 5) result += 3;
          else if (runLength > 5) result++;
        } else {
          this.finderPenaltyAddHistory(runLength, history);
          if (!runColor) result += this.finderPenaltyCountPatterns(history) * 40;
          runColor = this.modules[y][x];
          runLength = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runLength, history) * 40;
    }
    for (let x = 0; x < this.size; x++) {
      let runColor = false;
      let runLength = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < this.size; y++) {
        if (this.modules[y][x] === runColor) {
          runLength++;
          if (runLength === 5) result += 3;
          else if (runLength > 5) result++;
        } else {
          this.finderPenaltyAddHistory(runLength, history);
          if (!runColor) result += this.finderPenaltyCountPatterns(history) * 40;
          runColor = this.modules[y][x];
          runLength = 1;
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runLength, history) * 40;
    }
    for (let y = 0; y < this.size - 1; y++) {
      for (let x = 0; x < this.size - 1; x++) {
        const color = this.modules[y][x];
        if (color === this.modules[y][x + 1] && color === this.modules[y + 1][x] && color === this.modules[y + 1][x + 1]) result += 3;
      }
    }
    let dark = 0;
    for (const row of this.modules) dark = row.reduce((sum, color) => sum + (color ? 1 : 0), dark);
    const total = this.size * this.size;
    result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return result;
  }

  private getAlignmentPatternPositions() {
    if (this.version === 1) return [];
    const count = Math.floor(this.version / 7) + 2;
    const step = Math.floor((this.version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
    const result = [6];
    for (let position = this.size - 7; result.length < count; position -= step) result.splice(1, 0, position);
    return result;
  }

  private static getNumRawDataModules(version: number) {
    let result = (16 * version + 128) * version + 64;
    if (version >= 2) {
      const align = Math.floor(version / 7) + 2;
      result -= (25 * align - 10) * align - 55;
      if (version >= 7) result -= 36;
    }
    return result;
  }

  private static getNumDataCodewords(version: number, ecl: Ecc) {
    return Math.floor(QrCode.getNumRawDataModules(version) / 8)
      - QrCode.ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][version]
      * QrCode.NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][version];
  }

  private static reedSolomonComputeDivisor(degree: number) {
    const result: Byte[] = Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = QrCode.reedSolomonMultiply(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = QrCode.reedSolomonMultiply(root, 0x02);
    }
    return result;
  }

  private static reedSolomonComputeRemainder(data: readonly Byte[], divisor: readonly Byte[]) {
    const result: Byte[] = divisor.map(() => 0);
    for (const byte of data) {
      const factor = byte ^ (result.shift() as Byte);
      result.push(0);
      divisor.forEach((coefficient, i) => { result[i] ^= QrCode.reedSolomonMultiply(coefficient, factor); });
    }
    return result;
  }

  private static reedSolomonMultiply(x: Byte, y: Byte) {
    let result = 0;
    for (let i = 7; i >= 0; i--) {
      result = (result << 1) ^ ((result >>> 7) * 0x11d);
      result ^= ((y >>> i) & 1) * x;
    }
    return result;
  }

  private finderPenaltyCountPatterns(history: readonly number[]) {
    const n = history[1];
    const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
    return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0)
      + (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
  }

  private finderPenaltyTerminateAndCount(color: boolean, length: number, history: number[]) {
    if (color) {
      this.finderPenaltyAddHistory(length, history);
      length = 0;
    }
    length += this.size;
    this.finderPenaltyAddHistory(length, history);
    return this.finderPenaltyCountPatterns(history);
  }

  private finderPenaltyAddHistory(length: number, history: number[]) {
    if (history[0] === 0) length += this.size;
    history.pop();
    history.unshift(length);
  }

  private static readonly ECC_CODEWORDS_PER_BLOCK = [
    [-1,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    [-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],
    [-1,13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
    [-1,17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30]
  ];

  private static readonly NUM_ERROR_CORRECTION_BLOCKS = [
    [-1,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25],
    [-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49],
    [-1,1,1,2,2,4,4,6,6,8,8,8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68],
    [-1,1,1,2,4,4,4,5,6,8,8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,40,42,45,48,51,54,57,60,63,66,70,74,77,81]
  ];
}

export function qrSvgPath(text: string) {
  const qr = QrCode.encodeText(text, QrCode.MEDIUM);
  const parts: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) parts.push(`M${x},${y}h1v1h-1z`);
    }
  }
  return { size: qr.size, path: parts.join('') };
}
