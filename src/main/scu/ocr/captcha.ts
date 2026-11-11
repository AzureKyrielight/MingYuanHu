/** 统一认证验证码本地 OCR。
 *  算法与权重移植自 SCU-CLI（internal/ocr，源自 scu-plus）：质心模板匹配，
 *  特征为 8×6 二值像素 + 宽高比共 49 维；预处理为去灰线 → 颜色量化分割 → 二值化。
 *  仅用于统一认证登录的验证码识别，不做任何联网请求。 */
import { inflateSync } from 'node:zlib';
import model from './captcha-centroid.json';

const CAPTCHA_WIDTH = 80;
const CAPTCHA_HEIGHT = 26;
const CHAR_H = 8;
const CHAR_W = 6;
const FEAT_DIM = CHAR_H * CHAR_W;
const FEAT_DIM_WITH_AR = FEAT_DIM + 1;
const NUM_CLASSES = 36;
const CAPTCHA_LEN = 4;

const LINE_TOLERANCE = 10;
const COLOR_QUANT_STEP = 8;
const WHITE_THRESHOLD = 250;
const BINARIZE_THRESHOLD = 0.3;
const MIN_CONFIDENCE = 0.3;
const MAX_ASPECT_RATIO = 2;
const AR_WEIGHT = 25;
const LINE_COLOR = [111, 110, 112] as const;
const CHARSET = '0123456789abcdefghijklmnopqrstuvwxyz';

interface CentroidModel {
  readonly centroids_b64: string;
}

let centroids: Float32Array | null = null;

function loadCentroids(): Float32Array {
  if (centroids) return centroids;
  const raw = Buffer.from((model as CentroidModel).centroids_b64, 'base64');
  if (raw.length !== NUM_CLASSES * FEAT_DIM_WITH_AR) {
    throw new Error(`OCR 模型维度异常：${raw.length}`);
  }
  const result = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) result[i] = (raw[i] ?? 0) / 255;
  centroids = result;
  return result;
}

interface DecodedImage {
  readonly width: number;
  readonly height: number;
  /** RGBA，每像素 4 字节。 */
  readonly pixels: Uint8Array;
}

/** 解析 8 位 RGB/RGBA、非隔行 PNG（验证码接口只返回这种格式）。 */
export function decodePng(buffer: Buffer): DecodedImage {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < signature.length; i += 1) {
    if ((buffer[i] ?? 0) !== signature[i]) throw new Error('不是有效的 PNG 图片');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let bitDepth = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? -1;
      interlace = data[12] ?? 0;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error('验证码图片格式不支持');
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(width * height * 4);
  const previous = new Uint8Array(stride);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor] ?? 0;
    cursor += 1;
    const line = new Uint8Array(stride);
    for (let i = 0; i < stride; i += 1) line[i] = raw[cursor + i] ?? 0;
    cursor += stride;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? (line[i - channels] ?? 0) : 0;
      const up = previous[i] ?? 0;
      const upLeft = i >= channels ? (previous[i - channels] ?? 0) : 0;
      const current = line[i] ?? 0;
      switch (filter) {
        case 0:
          break;
        case 1:
          line[i] = (current + left) & 0xff;
          break;
        case 2:
          line[i] = (current + up) & 0xff;
          break;
        case 3:
          line[i] = (current + ((left + up) >> 1)) & 0xff;
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          line[i] = (current + predictor) & 0xff;
          break;
        }
        default:
          throw new Error('验证码图片压缩方式不支持');
      }
    }
    previous.set(line);
    for (let x = 0; x < width; x += 1) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      pixels[to] = line[from] ?? 255;
      pixels[to + 1] = line[from + 1] ?? 255;
      pixels[to + 2] = line[from + 2] ?? 255;
      pixels[to + 3] = channels === 4 ? (line[from + 3] ?? 255) : 255;
    }
  }
  return { width, height, pixels };
}

/** 归一化为 80×26 RGB（白底合成；过大裁左上角，过小最近邻放大）。 */
function toRgb(image: DecodedImage): Uint8Array {
  const rgb = new Uint8Array(CAPTCHA_WIDTH * CAPTCHA_HEIGHT * 3);
  for (let y = 0; y < CAPTCHA_HEIGHT; y += 1) {
    for (let x = 0; x < CAPTCHA_WIDTH; x += 1) {
      let sx: number;
      let sy: number;
      if (image.width >= CAPTCHA_WIDTH && image.height >= CAPTCHA_HEIGHT) {
        sx = x;
        sy = y;
      } else {
        sx = Math.floor((x * image.width) / CAPTCHA_WIDTH);
        sy = Math.floor((y * image.height) / CAPTCHA_HEIGHT);
      }
      const from = (sy * image.width + sx) * 4;
      const alpha = (image.pixels[from + 3] ?? 255) / 255;
      const to = (y * CAPTCHA_WIDTH + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        rgb[to + c] = Math.round((image.pixels[from + c] ?? 255) * alpha + 255 * (1 - alpha));
      }
    }
  }
  return rgb;
}

function isLineColor(r: number, g: number, b: number): boolean {
  return (
    Math.abs(r - (LINE_COLOR[0] ?? 0)) <= LINE_TOLERANCE &&
    Math.abs(g - (LINE_COLOR[1] ?? 0)) <= LINE_TOLERANCE &&
    Math.abs(b - (LINE_COLOR[2] ?? 0)) <= LINE_TOLERANCE
  );
}

function removeGrayLines(rgb: Uint8Array): Uint8Array {
  const cleaned = new Uint8Array(rgb.length);
  for (let p = 0; p < rgb.length; p += 3) {
    const r = rgb[p] ?? 255;
    const g = rgb[p + 1] ?? 255;
    const b = rgb[p + 2] ?? 255;
    if (isLineColor(r, g, b)) {
      cleaned[p] = 255;
      cleaned[p + 1] = 255;
      cleaned[p + 2] = 255;
    } else {
      cleaned[p] = r;
      cleaned[p + 1] = g;
      cleaned[p + 2] = b;
    }
  }
  return cleaned;
}

interface SegmentedChar {
  readonly image: Float32Array;
  readonly bbox: readonly [number, number, number, number];
}

/** 按颜色分割字符，返回按 x 中心排序的字符。 */
function segmentCharacters(rgb: Uint8Array): SegmentedChar[] {
  const length = CAPTCHA_WIDTH * CAPTCHA_HEIGHT;
  const charPixels: { r: number; g: number; b: number; index: number }[] = [];
  for (let i = 0; i < length; i += 1) {
    const p = i * 3;
    const r = rgb[p] ?? 255;
    const g = rgb[p + 1] ?? 255;
    const b = rgb[p + 2] ?? 255;
    if (!(r > WHITE_THRESHOLD && g > WHITE_THRESHOLD && b > WHITE_THRESHOLD)) {
      charPixels.push({ r, g, b, index: i });
    }
  }
  if (charPixels.length < 20) return [];

  const quant = new Map<string, { rSum: number; gSum: number; bSum: number; count: number }>();
  for (const px of charPixels) {
    const key = `${Math.floor(px.r / COLOR_QUANT_STEP) * COLOR_QUANT_STEP},${
      Math.floor(px.g / COLOR_QUANT_STEP) * COLOR_QUANT_STEP
    },${Math.floor(px.b / COLOR_QUANT_STEP) * COLOR_QUANT_STEP}`;
    const entry = quant.get(key);
    if (entry) {
      entry.rSum += px.r;
      entry.gSum += px.g;
      entry.bSum += px.b;
      entry.count += 1;
    } else {
      quant.set(key, { rSum: px.r, gSum: px.g, bSum: px.b, count: 1 });
    }
  }
  if (quant.size < 4) return [];

  const centers = [...quant.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .map((item) => ({
      r: Math.floor(item.rSum / item.count),
      g: Math.floor(item.gSum / item.count),
      b: Math.floor(item.bSum / item.count),
    }));

  const labels = new Int8Array(length).fill(-1);
  for (const px of charPixels) {
    let bestDistance = Number.MAX_SAFE_INTEGER;
    let bestCenter = -1;
    centers.forEach((center, index) => {
      const d = (px.r - center.r) ** 2 + (px.g - center.g) ** 2 + (px.b - center.b) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        bestCenter = index;
      }
    });
    labels[px.index] = bestCenter;
  }

  const chars: SegmentedChar[] = [];
  centers.forEach((_center, index) => {
    let x1 = CAPTCHA_WIDTH;
    let y1 = CAPTCHA_HEIGHT;
    let x2 = -1;
    let y2 = -1;
    let count = 0;
    for (let i = 0; i < length; i += 1) {
      if (labels[i] !== index) continue;
      count += 1;
      const x = i % CAPTCHA_WIDTH;
      const y = Math.floor(i / CAPTCHA_WIDTH);
      if (x < x1) x1 = x;
      if (x > x2) x2 = x;
      if (y < y1) y1 = y;
      if (y > y2) y2 = y;
    }
    if (count < 5) return;
    const cropW = x2 - x1 + 1;
    const cropH = y2 - y1 + 1;
    const gray = new Float32Array(cropW * cropH);
    for (let y = y1; y <= y2; y += 1) {
      for (let x = x1; x <= x2; x += 1) {
        const index2 = y * CAPTCHA_WIDTH + x;
        if (labels[index2] === index) {
          const p = index2 * 3;
          gray[(y - y1) * cropW + (x - x1)] =
            (0.299 * (rgb[p] ?? 255) + 0.587 * (rgb[p + 1] ?? 255) + 0.114 * (rgb[p + 2] ?? 255)) /
            255;
        } else {
          gray[(y - y1) * cropW + (x - x1)] = 1;
        }
      }
    }
    const bin = new Float32Array(cropW * cropH);
    for (let i = 0; i < gray.length; i += 1) {
      if (1 - (gray[i] ?? 1) > BINARIZE_THRESHOLD) bin[i] = 1;
    }
    const resized = new Float32Array(FEAT_DIM);
    for (let ch = 0; ch < CHAR_H; ch += 1) {
      const srcY = Math.floor((ch * cropH) / CHAR_H);
      for (let cw = 0; cw < CHAR_W; cw += 1) {
        const srcX = Math.floor((cw * cropW) / CHAR_W);
        resized[ch * CHAR_W + cw] = bin[srcY * cropW + srcX] ?? 0;
      }
    }
    chars.push({ image: resized, bbox: [x1, y1, x2, y2] });
  });

  chars.sort((a, b) => a.bbox[0] + a.bbox[2] - (b.bbox[0] + b.bbox[2]));
  return chars;
}

function classifyChar(
  feature: Float32Array,
  model: Float32Array,
): { index: number; confidence: number } {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let worstDistance = 0;
  for (let c = 0; c < NUM_CLASSES; c += 1) {
    const offset = c * FEAT_DIM_WITH_AR;
    let pixelDistance = 0;
    for (let i = 0; i < FEAT_DIM; i += 1) {
      const d = (feature[i] ?? 0) - (model[offset + i] ?? 0);
      pixelDistance += d * d;
    }
    const arDiff = (feature[FEAT_DIM] ?? 0) - (model[offset + FEAT_DIM] ?? 0);
    const distance = pixelDistance + AR_WEIGHT * arDiff * arDiff;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = c;
    }
    if (distance > worstDistance) worstDistance = distance;
  }
  const confidence =
    worstDistance > 0
      ? Math.min(1, Math.max(0, 1 - Math.sqrt(bestDistance) / Math.sqrt(worstDistance)))
      : 0;
  return { index: bestIndex, confidence };
}

export interface CaptchaRecognition {
  /** 识别出的 4 位字符；失败时为空串。 */
  readonly text: string;
  /** 各字符的最低置信度，可用于决定是否让用户手动输入。 */
  readonly confidence: number;
}

export function recognizeCaptchaPng(buffer: Buffer): CaptchaRecognition {
  const image = decodePng(buffer);
  const rgb = removeGrayLines(toRgb(image));
  const chars = segmentCharacters(rgb);
  if (chars.length !== CAPTCHA_LEN) return { text: '', confidence: 0 };
  const model = loadCentroids();
  let text = '';
  let confidence = 1;
  for (const char of chars) {
    const feature = new Float32Array(FEAT_DIM_WITH_AR);
    feature.set(char.image);
    const width = char.bbox[2] - char.bbox[0] + 1;
    const height = char.bbox[3] - char.bbox[1] + 1;
    const aspect = width / Math.max(height, 1);
    feature[FEAT_DIM] = Math.min(1, Math.max(0, aspect / MAX_ASPECT_RATIO));
    const result = classifyChar(feature, model);
    text += CHARSET[result.index] ?? '';
    confidence = Math.min(confidence, result.confidence);
  }
  if (confidence < MIN_CONFIDENCE) return { text: '', confidence };
  return { text, confidence };
}

/** 识别 base64 验证码图片（可带 data URL 前缀）。 */
export function recognizeCaptchaBase64(image: string): CaptchaRecognition {
  const comma = image.indexOf(',');
  const payload = comma >= 0 && comma < 64 ? image.slice(comma + 1) : image;
  return recognizeCaptchaPng(Buffer.from(payload, 'base64'));
}
