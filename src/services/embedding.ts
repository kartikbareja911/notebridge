import { createOpenAI } from "@ai-sdk/openai";
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { embed, embedMany } from "ai";
import type { AppConfig } from "../config.js";

const DATABASE_VECTOR_DIMENSIONS = 1536;
const BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

export interface EmbeddingProvider {
  embedQuery(text: string): Promise<number[]>;
  embedTexts(texts: string[]): Promise<number[][]>;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly model: ReturnType<ReturnType<typeof createOpenAI>["embedding"]>;

  constructor(modelName = "text-embedding-3-small", apiKey?: string) {
    const provider = createOpenAI({
      ...(apiKey ? { apiKey } : {}),
    });
    this.model = provider.embedding(modelName);
  }

  async embedQuery(text: string): Promise<number[]> {
    const { embedding } = await embed({
      model: this.model,
      value: text,
    });
    return embedding;
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const { embeddings } = await embedMany({
      model: this.model,
      values: texts,
    });
    return embeddings;
  }
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  private readonly extractor: Promise<FeatureExtractionPipeline>;

  constructor(modelName = "Xenova/bge-small-en-v1.5") {
    this.extractor = pipeline("feature-extraction", modelName, { dtype: "q8" });
  }

  async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.embedDocuments([`${BGE_QUERY_PREFIX}${text}`]);
    if (!embedding) {
      throw new Error("Local embedding provider returned no embedding");
    }
    return embedding;
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    return this.embedDocuments(texts);
  }

  private async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const extractor = await this.extractor;
    const output = await extractor(texts, {
      pooling: "cls",
      normalize: true,
    });
    const [rowCount, modelDimensions] = output.dims;

    if (
      rowCount !== texts.length ||
      modelDimensions === undefined ||
      modelDimensions > DATABASE_VECTOR_DIMENSIONS
    ) {
      throw new Error(
        `Local embedding output must have shape [${texts.length}, <=${DATABASE_VECTOR_DIMENSIONS}]`,
      );
    }

    return texts.map((_, rowIndex) => {
      const embedding = Array.from({ length: DATABASE_VECTOR_DIMENSIONS }, () => 0);

      for (let columnIndex = 0; columnIndex < modelDimensions; columnIndex += 1) {
        embedding[columnIndex] = Number(
          output.data[rowIndex * modelDimensions + columnIndex] ?? 0,
        );
      }

      return embedding;
    });
  }
}

export function createEmbeddingProvider(
  config: Pick<
    AppConfig,
    "EMBEDDING_PROVIDER" | "EMBEDDING_MODEL" | "LOCAL_EMBEDDING_MODEL" | "OPENAI_API_KEY"
  >,
): EmbeddingProvider {
  if (config.EMBEDDING_PROVIDER === "local") {
    return new LocalEmbeddingProvider(config.LOCAL_EMBEDDING_MODEL);
  }

  if (!config.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai");
  }

  return new OpenAIEmbeddingProvider(config.EMBEDDING_MODEL, config.OPENAI_API_KEY);
}
