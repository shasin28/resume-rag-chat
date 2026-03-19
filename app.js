const express = require("express");
const OpenAI = require("openai");

const app = express();
const port = process.env.PORT || 3000;

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY environment variable.");
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(express.json({ limit: "2mb" }));
app.use(express.text({ type: "text/plain", limit: "2mb" }));
app.use(express.static("public"));

// In-memory vector store:
// Each item holds a resume chunk and its embedding vector.
// This keeps the example simple and avoids using a database.
const vectorStore = [];

function log(message, meta) {
  const timestamp = new Date().toISOString();
  if (meta) {
    console.log(`[${timestamp}] ${message}`, meta);
    return;
  }
  console.log(`[${timestamp}] ${message}`);
}

function getUploadText(body) {
  if (typeof body === "string") {
    return body;
  }

  if (body && typeof body.text === "string") {
    return body.text;
  }

  return "";
}

function getQuestion(body) {
  if (body && typeof body.question === "string") {
    return body.question;
  }

  if (typeof body === "string") {
    return body;
  }

  return "";
}

// Chunking:
// We split the uploaded resume into smaller pieces so embeddings capture
// local meaning well and retrieval can pull only the most relevant sections.
// This version groups sentences into chunks between 200 and 500 words.
function chunkText(text, minWords = 200, maxWords = 500) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const sentences = normalized.match(/[^.!?]+[.!?]?/g) || [normalized];
  const chunks = [];
  let currentSentences = [];
  let currentWords = 0;

  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if (!trimmedSentence) {
      continue;
    }

    const sentenceWords = trimmedSentence.split(/\s+/).length;

    if (currentWords > 0 && currentWords + sentenceWords > maxWords) {
      chunks.push(currentSentences.join(" ").trim());
      currentSentences = [];
      currentWords = 0;
    }

    currentSentences.push(trimmedSentence);
    currentWords += sentenceWords;

    if (currentWords >= minWords) {
      chunks.push(currentSentences.join(" ").trim());
      currentSentences = [];
      currentWords = 0;
    }
  }

  if (currentSentences.length > 0) {
    if (chunks.length > 0 && currentWords < minWords) {
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${currentSentences.join(" ")}`.trim();
    } else {
      chunks.push(currentSentences.join(" ").trim());
    }
  }

  return chunks.filter(Boolean);
}

// Embeddings:
// An embedding is a numeric vector representing the semantic meaning of text.
// Similar ideas end up with similar vectors, which allows vector search later.
async function createEmbedding(text) {
  const response = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });

  return response.data[0].embedding;
}

// Similarity search:
// Cosine similarity measures how close two vectors point in the same direction.
// A higher score means the resume chunk is more relevant to the user's question.
function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

app.get("/api", (req, res) => {
  res.json({
    message: "Resume chat backend is running.",
    endpoints: {
      upload: "POST /upload",
      ask: "POST /ask",
    },
    storedChunks: vectorStore.length,
  });
});

app.post("/upload", async (req, res, next) => {
  try {
    const text = getUploadText(req.body).trim();

    if (!text) {
      return res.status(400).json({
        error: "Please provide resume text as raw text or JSON: {\"text\": \"...\"}.",
      });
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      return res.status(400).json({ error: "Could not create chunks from the provided text." });
    }

    log("Upload received", { chunkCount: chunks.length });

    vectorStore.length = 0;

    for (const chunk of chunks) {
      const embedding = await createEmbedding(chunk);
      vectorStore.push({ text: chunk, embedding });
    }

    return res.json({
      message: "Resume uploaded and embedded successfully.",
      chunksStored: vectorStore.length,
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/ask", async (req, res, next) => {
  try {
    const question = getQuestion(req.body).trim();

    if (!question) {
      return res.status(400).json({
        error: "Please provide a question as raw text or JSON: {\"question\": \"...\"}.",
      });
    }

    if (vectorStore.length === 0) {
      return res.status(400).json({
        error: "No resume data found. Upload resume text first using POST /upload.",
      });
    }

    log("Question received", { question });

    const questionEmbedding = await createEmbedding(question);

    const topChunks = vectorStore
      .map((item) => ({
        text: item.text,
        score: cosineSimilarity(questionEmbedding, item.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const context = topChunks
      .map((chunk, index) => `Chunk ${index + 1}:\n${chunk.text}`)
      .join("\n\n");

    // RAG flow:
    // 1. Embed the user's question.
    // 2. Compare it against stored resume chunk embeddings.
    // 3. Retrieve the top matching chunks.
    // 4. Send those chunks as context to the chat model to answer grounded in the resume.
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You answer questions using only the provided resume context. If the answer is not in the context, say that clearly and avoid making up details.",
        },
        {
          role: "user",
          content: `Resume context:\n\n${context}\n\nQuestion: ${question}`,
        },
      ],
      temperature: 0.2,
    });

    const answer = completion.choices[0]?.message?.content || "No answer returned.";

    return res.json({
      answer,
      retrievedChunks: topChunks,
    });
  } catch (error) {
    return next(error);
  }
});

app.use((err, req, res, next) => {
  log("Unhandled error", {
    message: err.message,
    stack: err.stack,
  });

  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }

  return res.status(500).json({
    error: "Something went wrong while processing the request.",
    details: err.message,
  });
});

app.listen(port, () => {
  log(`Server listening on http://localhost:${port}`);
});
