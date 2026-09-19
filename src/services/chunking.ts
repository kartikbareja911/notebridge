const DEFAULT_MAX_TOKENS = 500;
const APPROX_CHARACTERS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARACTERS_PER_TOKEN);
}

function splitOversizedText(text: string, maxCharacters: number): string[] {
  if (text.length <= maxCharacters) {
    return [text.trim()];
  }

  const sentences = text.split(/(?<=[.!?])\s+/);
  if (sentences.length > 1) {
    return groupUnits(sentences, maxCharacters, " ");
  }

  const words = text.split(/\s+/);
  if (words.length > 1) {
    return groupUnits(words, maxCharacters, " ");
  }

  const slices: string[] = [];
  for (let index = 0; index < text.length; index += maxCharacters) {
    slices.push(text.slice(index, index + maxCharacters));
  }
  return slices;
}

function groupUnits(units: string[], maxCharacters: number, separator: string): string[] {
  const groups: string[] = [];
  let current = "";

  for (const unit of units) {
    const candidate = current.length === 0 ? unit : `${current}${separator}${unit}`;
    if (candidate.length <= maxCharacters) {
      current = candidate;
      continue;
    }

    if (current.length > 0) {
      groups.push(current.trim());
    }
    current = unit;
  }

  if (current.length > 0) {
    groups.push(current.trim());
  }

  return groups;
}

export function chunkText(content: string, maxTokens = DEFAULT_MAX_TOKENS): string[] {
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
    throw new Error("maxTokens must be a positive integer");
  }

  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return [];
  }

  const maxCharacters = maxTokens * APPROX_CHARACTERS_PER_TOKEN;
  if (normalized.length <= maxCharacters) {
    return [normalized];
  }

  const units = normalized
    .split(/\n{2,}/)
    .flatMap((paragraph) =>
      paragraph.length <= maxCharacters
        ? [paragraph.trim()]
        : splitOversizedText(paragraph.trim(), maxCharacters),
    )
    .filter((unit) => unit.length > 0);

  return groupUnits(units, maxCharacters, "\n\n").filter((chunk) => chunk.length > 0);
}
