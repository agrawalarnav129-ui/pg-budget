// Builds the HDFC-style statement fixtures used by the PDF importer's integration test:
// one plain, one with the RC4 security Indian banks put on emailed statements.
// Regenerate with:  node scripts/make-sample-statement.mjs
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

export const LOCKED_PASSWORD = 'arna1234';

// --- PDF standard security handler, revision 2 (RC4, 40-bit) ---------------
const PAD = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);
const DOC_ID = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
const md5 = (...parts) => parts.reduce((h, p) => h.update(p), createHash('md5')).digest();
const padPassword = (pw) => Buffer.concat([Buffer.from(pw, 'latin1'), PAD]).subarray(0, 32);

function rc4(key, data) {
  const S = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
    out[n] = data[n] ^ S[(S[i] + S[j]) & 0xff];
  }
  return out;
}

function securityHandler(password) {
  const p = Buffer.alloc(4);
  p.writeInt32LE(-1); // every permission granted
  const O = rc4(md5(padPassword(password)).subarray(0, 5), padPassword(password));
  const key = md5(padPassword(password), O, p, DOC_ID).subarray(0, 5);
  return { O, U: rc4(key, PAD), key };
}

/** Per-object key, as the spec's algorithm 1 derives it. */
const objectKey = (key, num) =>
  md5(Buffer.concat([key, Buffer.from([num & 0xff, (num >> 8) & 0xff, (num >> 16) & 0xff, 0, 0])])).subarray(
    0,
    Math.min(key.length + 5, 16),
  );

const FS = 9;
// Helvetica advance widths (per 1000 em), enough for the characters used here.
const WIDTHS = { ',': 278, '.': 278, ' ': 278, '-': 333, '/': 278, '*': 389, '@': 1015 };
const widthOf = (s, size = FS) =>
  [...s].reduce((sum, c) => sum + (WIDTHS[c] ?? (/\d/.test(c) ? 556 : 500)), 0) / 1000 * size;

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

class Page {
  ops = [];
  text(x, y, s, size = FS) {
    this.ops.push(`BT /F1 ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${esc(s)}) Tj ET`);
  }
  /** Right-align, the way amount columns are printed. */
  right(xRight, y, s, size = FS) {
    this.text(xRight - widthOf(s, size), y, s, size);
  }
}

function build(pages, path, password) {
  const n = pages.length;
  const pageIds = pages.map((_, i) => 3 + 2 * i);
  const contentIds = pages.map((_, i) => 4 + 2 * i);
  const fontId = 3 + 2 * n;
  const encryptId = fontId + 1;
  const security = password ? securityHandler(password) : null;

  const objs = [
    [1, Buffer.from('<< /Type /Catalog /Pages 2 0 R >>')],
    [2, Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${n} >>`)],
  ];
  pages.forEach((pg, i) => {
    objs.push([
      pageIds[i],
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentIds[i]} 0 R ` +
          `/Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
      ),
    ]);
    const plain = Buffer.from(pg.ops.join('\n'), 'latin1');
    const stream = security ? rc4(objectKey(security.key, contentIds[i]), plain) : plain;
    objs.push([
      contentIds[i],
      Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from('\nendstream')]),
    ]);
  });
  objs.push([fontId, Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')]);
  if (security) {
    objs.push([
      encryptId,
      Buffer.from(
        `<< /Filter /Standard /V 1 /R 2 /O <${security.O.toString('hex')}> ` +
          `/U <${security.U.toString('hex')}> /P -1 >>`,
      ),
    ]);
  }

  const chunks = [Buffer.from('%PDF-1.4\n')];
  let offset = chunks[0].length;
  const offsets = new Map();
  for (const [num, body] of objs) {
    offsets.set(num, offset);
    const chunk = Buffer.concat([Buffer.from(`${num} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    chunks.push(chunk);
    offset += chunk.length;
  }
  const top = Math.max(...offsets.keys()) + 1;
  let xref = `xref\n0 ${top}\n0000000000 65535 f \n`;
  for (let i = 1; i < top; i++) xref += `${String(offsets.get(i) ?? 0).padStart(10, '0')} 00000 n \n`;
  const extra = security
    ? ` /Encrypt ${encryptId} 0 R /ID [<${DOC_ID.toString('hex')}> <${DOC_ID.toString('hex')}>]`
    : '';
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${top} /Root 1 0 R${extra} >>\nstartxref\n${offset}\n%%EOF\n`));

  writeFileSync(path, Buffer.concat(chunks));
}

// date, narration line 1, wrapped narration line 2, withdrawal, deposit
const TXNS = [
  ['01/09/26', 'UPI-PG OWNER RAMESH-ramesh@okicici-ICIC0000001-', '424512345670-Rent Sept', 9500, 0],
  ['02/09/26', 'UPI-SWIGGY LIMITED-swiggy@ybl-YESB0000001-', '424512345671-Payment', 345, 0],
  ['03/09/26', 'UPI-ZEPTO MARKETPLACE PRIVATE-zepto@axl-', '424512345672-Order', 212.5, 0],
  ['05/09/26', 'UPI-JIO RECHARGE-jio@hdfcbank-HDFC0000001-', '424512345673-Recharge', 349, 0],
  ['06/09/26', 'UPI-RAPIDO-rapido@ybl-YESB0000001-', '424512345674-Ride', 88, 0],
  ['08/09/26', 'UPI-MUMBAI METRO-mmopl@icici-ICIC0000002-', '424512345675-Ticket', 35, 0],
  ['10/09/26', 'NEFT CR-PAPA-SBIN0001234-Pocket money', 'N2026091012345', 0, 20000],
  ['11/09/26', 'UPI-ZOMATO LIMITED-zomato@ybl-YESB0000001-', '424512345676-Payment', 410, 0],
  ['12/09/26', 'UPI-BOOKMYSHOW-bms@axisbank-UTIB0000001-', '424512345677-Tickets', 650, 0],
  ['14/09/26', 'UPI-AMAZON PAY INDIA-amazon@apl-UTIB0000002-', '424512345678-Refund', 0, 499],
  ['15/09/26', 'UPI-BLINKIT-blinkit@paytm-PYTM0000001-', '424512345679-Order', 268, 0],
  ['18/09/26', 'POS 412345XXXXXX1234 DMART AVENUE SUPERMART', 'MUMBAI', 1240, 0],
];

const COL = { date: 40, narr: 95, wd: 432, dep: 492, bal: 556 };
const money = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const header = (pg, y) => {
  pg.text(COL.date, y, 'Date', 8);
  pg.text(COL.narr, y, 'Narration', 8);
  pg.text(300, y, 'Chq./Ref.No.', 8);
  pg.right(COL.wd, y, 'Withdrawal Amt.', 8);
  pg.right(COL.dep, y, 'Deposit Amt.', 8);
  pg.right(COL.bal, y, 'Closing Balance', 8);
};

const OPENING = 25_000;
let pg = new Page();
const pages = [pg];
pg.text(40, 800, 'HDFC BANK LIMITED', 13);
pg.text(40, 785, 'Statement of Account');
pg.text(40, 772, 'Account No: 50100123456789    Period: 01/09/2026 to 30/09/2026');
header(pg, 748);
pg.text(COL.date, 733, 'Opening Balance');
pg.right(COL.bal, 733, money(OPENING));

let balance = OPENING;
let y = 715;
for (const [date, narr1, narr2, wd, dep] of TXNS) {
  if (y < 90) {
    pg = new Page();
    pages.push(pg);
    header(pg, 800);
    y = 780;
  }
  balance = balance - wd + dep;
  pg.text(COL.date, y, date);
  pg.text(COL.narr, y, narr1);
  if (wd) pg.right(COL.wd, y, money(wd));
  if (dep) pg.right(COL.dep, y, money(dep));
  pg.right(COL.bal, y, money(balance));
  y -= 11;
  pg.text(COL.narr, y, narr2); // wrapped narration
  y -= 15;
}
pg.text(COL.date, y - 10, 'Closing Balance');
pg.right(COL.bal, y - 10, money(balance));
pg.text(COL.date, y - 30, '*** End of Statement ***');

mkdirSync('src/import/__fixtures__', { recursive: true });
build(pages, 'src/import/__fixtures__/sample-statement.pdf');
build(pages, 'src/import/__fixtures__/locked-statement.pdf', LOCKED_PASSWORD);
console.log(
  `${TXNS.length} transactions, closing ${money(balance)} — wrote sample-statement.pdf and ` +
    `locked-statement.pdf (password ${LOCKED_PASSWORD})`,
);
