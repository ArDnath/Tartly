import { describe, expect, it } from "vitest";

import {
  canExtract,
  extractText,
  htmlToPlainText,
} from "@/lib/assets/extract";

/**
 * Build a tiny, valid PDF with one page of selectable text. Keeping the fixture
 * in code avoids committing a binary just to prove the PDF extractor is wired.
 */
function minimalPdf(text: string): Buffer {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
  ];
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  objects.push(
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
  );
  objects.push(
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  );

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

describe("assets/extract", () => {
  it("strips tags, scripts, and decodes entities from HTML", () => {
    const html =
      "<html><head><style>p{color:red}</style><script>alert(1)</script></head>" +
      "<body><h1>T&amp;C</h1><p>Hello&nbsp;<b>world</b></p></body></html>";
    const text = htmlToPlainText(html);
    expect(text).toContain("T&C");
    expect(text).toContain("Hello world");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color:red");
  });

  it("extracts plain text and JSON verbatim", async () => {
    await expect(
      extractText(Buffer.from("  hi there  "), "text/plain"),
    ).resolves.toEqual({
      text: "hi there",
      parser: "text/plain",
    });
    await expect(
      extractText(Buffer.from('{"a":1}'), "application/json; charset=utf-8"),
    ).resolves.toEqual({ text: '{"a":1}', parser: "application/json" });
  });

  it("extracts selectable text from a PDF", async () => {
    const result = await extractText(minimalPdf("Hello Tartly"), "application/pdf");
    expect(result?.parser).toBe("application/pdf");
    expect(result?.text).toContain("Hello Tartly");
    expect(canExtract("application/pdf")).toBe(true);
  });

  it("returns null for unsupported binary formats", async () => {
    await expect(
      extractText(Buffer.from([0xff, 0xd8]), "image/jpeg"),
    ).resolves.toBeNull();
    expect(canExtract("image/jpeg")).toBe(false);
    expect(canExtract("text/csv")).toBe(true);
  });
});
