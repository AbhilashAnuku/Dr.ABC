#!/usr/bin/env bun
/**
 * mht-extract — strip the HTML body out of a .mht (MIME-HTML) file
 * and write a plain Markdown-ish version. .mht files are commonly
 * exported by browsers / WhatsApp; they're MIME multipart with an
 * HTML primary part + embedded resources.
 *
 * Usage:
 *   bun run scripts/mht-extract.ts <input.mht> <output.md>
 */

import { readFile, writeFile } from 'node:fs/promises';

async function main() {
  const [, , inFile, outFile] = process.argv;
  if (!inFile || !outFile) {
    console.error('usage: bun run scripts/mht-extract.ts <input.mht> <output.md>');
    process.exit(2);
  }

  const raw = await readFile(inFile, 'utf8');

  // 1. Find first text/html part. MIME boundary is the line beginning
  //    after each --boundary and the Content-Type header tells us what
  //    follows. We just grab the first `<body` ... `</body>` window.
  const bodyStart = raw.indexOf('<body');
  const bodyEnd = raw.lastIndexOf('</body>');
  let body = bodyStart >= 0 && bodyEnd > bodyStart ? raw.slice(bodyStart, bodyEnd + 7) : raw;

  // 2. Decode quoted-printable: lines ending with `=\n` are soft breaks;
  //    `=XX` (XX = 2 hex digits) is a single byte. RFC 2045.
  body = body.replace(/=\r?\n/g, '');
  body = body.replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );

  // 3. Strip <style> + <script> blocks (multiline).
  body = body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  body = body.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // 4. Convert headings + paragraphs + lists to markdown-ish text BEFORE
  //    stripping all tags (so we keep structure).
  body = body
    .replace(/<h1[^>]*>/gi, '\n\n# ')
    .replace(/<h2[^>]*>/gi, '\n\n## ')
    .replace(/<h3[^>]*>/gi, '\n\n### ')
    .replace(/<h4[^>]*>/gi, '\n\n#### ')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<strong[^>]*>/gi, '**')
    .replace(/<\/strong>/gi, '**')
    .replace(/<b[^>]*>/gi, '**')
    .replace(/<\/b>/gi, '**')
    .replace(/<em[^>]*>/gi, '_')
    .replace(/<\/em>/gi, '_')
    .replace(/<i[^>]*>/gi, '_')
    .replace(/<\/i>/gi, '_')
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // 5. Strip every remaining tag.
  body = body.replace(/<[^>]+>/g, ' ');

  // 6. Decode HTML entities.
  body = body
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9A-Fa-f]+);/g, (_m, h) => String.fromCodePoint(Number.parseInt(h, 16)));

  // 7. Collapse whitespace.
  body = body
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n');
  // Collapse runs of blank lines.
  body = body.replace(/\n{3,}/g, '\n\n');

  await writeFile(outFile, body);
  console.log(`▸ wrote ${outFile} (${(body.length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error('mht-extract failed:', err);
  process.exit(1);
});
