import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";
import { recognize } from "tesseract.js";

export interface ParsedPdf {
  text: string;
  numpages: number;
  isOcr?: boolean;
}

export async function parsePdfFile(
  filePathOrBuffer: string | Buffer,
): Promise<ParsedPdf> {
  const buffer =
    typeof filePathOrBuffer === "string"
      ? await readFile(filePathOrBuffer)
      : filePathOrBuffer;

  const uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const parser = new PDFParse(uint8Array);
  const textResult = await parser.getText();

  const rawText = textResult.text;
  const cleanedText = rawText.replace(/-- \d+ of \d+ --/g, "").trim();

  if (cleanedText.length < 20) {
    try {
      const ocrResult = await recognize(buffer, "eng");
      if (ocrResult.data.text.trim().length > 0) {
        return {
          text: ocrResult.data.text.trim(),
          numpages: textResult.total,
          isOcr: true,
        };
      }
    } catch {
      // fallback to original text if OCR fails
    }
  }

  return {
    text: rawText,
    numpages: textResult.total,
    isOcr: false,
  };
}
