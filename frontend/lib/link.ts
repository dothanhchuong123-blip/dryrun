/** Pull a pasted web link out of the business box. The first http(s) URL becomes `url`; the rest is the owner's note.
 *  A bare domain ("mycafe.vn") counts only when it is the whole input. */
export function splitLink(input: string): { url: string | null; note: string } {
  const text = input.trim();
  const m = text.match(/https?:\/\/[^\s<>"')]+/i);
  if (m) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    return { url, note: text.replace(m[0], " ").replace(/\s+/g, " ").trim() };
  }
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(text)) return { url: `https://${text}`, note: "" };
  return { url: null, note: text };
}
