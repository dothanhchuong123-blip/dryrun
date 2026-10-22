/** F5: client-side checks for a file dropped in the box. Same messages as the server (backend/services/doc_reader.py). */
import type { MissingItem } from "./events";

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const FILE_ACCEPT = ".pdf,image/jpeg,image/png,image/webp,.txt,.csv";
export const UNSUPPORTED = "We can read PDFs, photos (JPG, PNG) and text files.";
export const TOO_BIG = "That file is over 8 MB. Try a smaller one, or paste the numbers.";
export const NEEDS_LIVE = "Reading files needs the live server. Pick an example, or describe your business in a line.";

const OK_EXT = /\.(pdf|jpe?g|png|webp|txt|csv)$/i;
const OK_MIME = /^(application\/pdf|image\/(jpeg|png|webp)|text\/(plain|csv))$/;

/** An error message, or null when the file can be sent. */
export function checkFile(f: File): string | null {
  if (!OK_EXT.test(f.name) && !OK_MIME.test(f.type)) return UNSUPPORTED;
  if (f.size > MAX_FILE_BYTES) return TOO_BIG;
  return null;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function hasFiles(e: { dataTransfer?: DataTransfer | null }): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

export const MISSING: Record<MissingItem, { label: string; phrase: string }> = {
  what_you_sell: { label: "What you sell", phrase: "I sell " },
  where: { label: "Where", phrase: " in " },
  price: { label: "Your price", phrase: ", at about $" },
  cost: { label: "Your cost", phrase: ", costing me about $" },
};

export const REJECT_COPY = {
  too_little: "We need a bit more. What do you sell, and roughly where?",
  not_business: "This doesn't look like it's about a business. Try your price list, a sales report, or a line about your shop.",
} as const;
