// Generates the placeholder screenshots used by MockTaskClient as small indexed-color PNG
// wireframes, and writes them to lib/client/mock/screenshots.ts as base64 data URLs.
// Run with: npm run generate:screenshots
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const WIDTH = 480;
const HEIGHT = 300;

// Palette indexes.
const BG = 0;
const CHROME = 1;
const FIELD = 2;
const BORDER = 3;
const TEXT = 4;
const ACTIVE = 5;
const BUTTON = 6;
const SUCCESS = 7;
const WARN = 8;
const ERROR = 9;

const PALETTE = [
  [255, 255, 255],
  [226, 232, 240],
  [248, 250, 252],
  [100, 116, 139],
  [51, 65, 85],
  [29, 78, 216],
  [30, 64, 175],
  [22, 101, 52],
  [180, 83, 9],
  [185, 28, 28],
];

function canvas() {
  return Array.from({ length: HEIGHT }, () => new Uint8Array(WIDTH).fill(BG));
}

function rect(px, x, y, w, h, color) {
  for (let row = Math.max(0, y); row < Math.min(HEIGHT, y + h); row++) {
    px[row].fill(color, Math.max(0, x), Math.min(WIDTH, x + w));
  }
}

function frame(px, x, y, w, h, color, thickness = 1) {
  rect(px, x, y, w, thickness, color);
  rect(px, x, y + h - thickness, w, thickness, color);
  rect(px, x, y, thickness, h, color);
  rect(px, x + w - thickness, y, thickness, h, color);
}

/** Draws a gray bar standing in for a line of text. */
function textBar(px, x, y, w, color = TEXT) {
  rect(px, x, y, w, 6, color);
}

function browserChrome(px) {
  rect(px, 0, 0, WIDTH, 28, CHROME);
  rect(px, 12, 10, 8, 8, BORDER);
  rect(px, 26, 10, 8, 8, BORDER);
  rect(px, 52, 7, 300, 14, BG);
  textBar(px, 60, 11, 140, BORDER);
}

const FORM_FIELDS = [
  { label: 60, value: 110 },
  { label: 50, value: 150 },
  { label: 70, value: 130 },
  { label: 80, value: 90 },
  { label: 55, value: 260, tall: true },
];

/** Scholarship form with `filled` fields completed and field `active` (0-based) focused. */
function scholarshipForm({ filled, active, invalidField = null }) {
  const px = canvas();
  browserChrome(px);
  textBar(px, 24, 44, 200);
  let y = 58;
  FORM_FIELDS.forEach((field, index) => {
    const height = field.tall ? 40 : 22;
    textBar(px, 24, y, field.label, BORDER);
    const boxY = y + 10;
    rect(px, 24, boxY, 432, height, FIELD);
    const isActive = index === active;
    const isInvalid = index === invalidField;
    frame(
      px,
      24,
      boxY,
      432,
      height,
      isInvalid ? ERROR : isActive ? ACTIVE : BORDER,
      isActive || isInvalid ? 3 : 1,
    );
    if (index < filled) textBar(px, 32, boxY + 8, field.value);
    if (field.tall && index < filled) textBar(px, 32, boxY + 22, 340);
    y = boxY + height + 6;
  });
  rect(px, 24, 268, 110, 26, active === FORM_FIELDS.length ? ACTIVE : BUTTON);
  textBar(px, 52, 278, 54, BG);
  return px;
}

function confirmationPage() {
  const px = canvas();
  browserChrome(px);
  rect(px, 24, 48, 432, 70, SUCCESS);
  rect(px, 44, 70, 26, 26, BG);
  textBar(px, 86, 70, 220, BG);
  textBar(px, 86, 88, 150, BG);
  textBar(px, 24, 140, 300);
  textBar(px, 24, 156, 260);
  textBar(px, 24, 172, 280);
  return px;
}

/** Login form; `active` is 0 (email), 1 (password) or 2 (sign in button). */
function loginForm({ emailFilled, passwordFilled, active }) {
  const px = canvas();
  browserChrome(px);
  textBar(px, 140, 54, 200);
  const fields = [
    { y: 84, filled: emailFilled, value: 160 },
    { y: 140, filled: passwordFilled, value: 80 },
  ];
  fields.forEach((field, index) => {
    textBar(px, 120, field.y, 60, BORDER);
    rect(px, 120, field.y + 12, 240, 26, FIELD);
    const isActive = index === active;
    frame(
      px,
      120,
      field.y + 12,
      240,
      26,
      isActive ? (index === 1 ? WARN : ACTIVE) : BORDER,
      isActive ? 3 : 1,
    );
    if (field.filled) textBar(px, 128, field.y + 22, field.value);
  });
  rect(px, 120, 206, 240, 30, active === 2 ? ACTIVE : BUTTON);
  textBar(px, 210, 218, 60, BG);
  return px;
}

function dashboardPage() {
  const px = canvas();
  browserChrome(px);
  rect(px, 0, 28, 110, HEIGHT - 28, CHROME);
  for (let i = 0; i < 5; i++) textBar(px, 16, 48 + i * 22, 70, BORDER);
  textBar(px, 130, 46, 220);
  for (let i = 0; i < 3; i++) {
    frame(px, 130 + i * 112, 70, 100, 80, BORDER);
    textBar(px, 142 + i * 112, 86, 60);
    textBar(px, 142 + i * 112, 104, 40, SUCCESS);
  }
  textBar(px, 130, 170, 300);
  textBar(px, 130, 186, 260);
  return px;
}

function deadlinePage() {
  const px = canvas();
  browserChrome(px);
  textBar(px, 24, 46, 240);
  textBar(px, 24, 66, 400, BORDER);
  textBar(px, 24, 80, 380, BORDER);
  rect(px, 24, 102, 432, 44, FIELD);
  frame(px, 24, 102, 432, 44, ACTIVE, 3);
  textBar(px, 40, 120, 220);
  textBar(px, 24, 164, 360, BORDER);
  textBar(px, 24, 178, 300, BORDER);
  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(px) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; // bit depth
  header[9] = 3; // indexed color
  const raw = Buffer.concat(px.map((row) => Buffer.concat([Buffer.from([0]), Buffer.from(row)])));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("PLTE", Buffer.from(PALETTE.flat())),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

const screenshots = {
  formEmpty: scholarshipForm({ filled: 0, active: -1 }),
  formName: scholarshipForm({ filled: 1, active: 0 }),
  formEmail: scholarshipForm({ filled: 2, active: 1 }),
  formProgram: scholarshipForm({ filled: 3, active: 2 }),
  formDate: scholarshipForm({ filled: 4, active: 3 }),
  formEssay: scholarshipForm({ filled: 5, active: 4 }),
  formReview: scholarshipForm({ filled: 5, active: 5 }),
  formProgramMissing: scholarshipForm({ filled: 2, active: -1, invalidField: 2 }),
  confirmation: confirmationPage(),
  loginEmpty: loginForm({ emailFilled: false, passwordFilled: false, active: -1 }),
  loginEmail: loginForm({ emailFilled: true, passwordFilled: false, active: 0 }),
  loginHandoff: loginForm({ emailFilled: true, passwordFilled: false, active: 1 }),
  loginSubmit: loginForm({ emailFilled: true, passwordFilled: true, active: 2 }),
  dashboard: dashboardPage(),
  deadline: deadlinePage(),
};

const entries = Object.entries(screenshots)
  .map(([name, px]) => `  ${name}:\n    "${encodePng(px)}",`)
  .join("\n");

const output = `// Generated by scripts/generate-mock-screenshots.mjs. Do not edit by hand.
export const mockScreenshots = {
${entries}
} as const;

export type MockScreenshotName = keyof typeof mockScreenshots;
`;

const target = new URL("../lib/client/mock/screenshots.ts", import.meta.url);
writeFileSync(target, output);
console.log(`Wrote ${Object.keys(screenshots).length} screenshots to ${target.pathname}`);
