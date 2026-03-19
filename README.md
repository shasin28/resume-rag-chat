# Resume RAG Chat

Minimal "Chat with your Resume" app built with Node.js, Express, and OpenAI.

It includes:
- a small backend API for upload and question answering
- in-memory embeddings storage
- cosine similarity retrieval for top resume chunks
- a simple browser UI served from the same Express app

## Features

- `POST /upload` accepts resume text
- `POST /ask` accepts a question
- text is split into chunks of roughly 200-500 words
- embeddings are generated with the OpenAI embeddings API
- the top 3 relevant chunks are retrieved using cosine similarity
- a chat completion generates the final grounded answer
- no database, no auth, no separate frontend build step

## Project Structure

```text
.
├── app.js
├── package.json
├── package-lock.json
├── public/
│   └── index.html
└── README.md
```

## Requirements

- Node.js 18+
- An OpenAI Platform API key

Important:
- ChatGPT Plus does not automatically include OpenAI API credits
- this app uses the OpenAI Platform API, which requires separate billing/quota

## Setup

```bash
npm install
export OPENAI_API_KEY="your_api_key_here"
npm start
```

The server starts on:

```text
http://localhost:3000
```

## UI

Open this in your browser:

```text
http://localhost:3000
```

The page lets you:
- paste resume text
- upload and embed it
- ask questions against the stored chunks

## API

### Health / API info

```bash
curl http://localhost:3000/api
```

### Upload resume text

```bash
curl -X POST http://localhost:3000/upload \
  -H "Content-Type: application/json" \
  -d '{"text":"Paste your full resume text here"}'
```

You can also send raw text:

```bash
curl -X POST http://localhost:3000/upload \
  -H "Content-Type: text/plain" \
  --data-binary "Paste your full resume text here"
```

### Ask a question

```bash
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"What backend experience does this candidate have?"}'
```

You can also send raw text:

```bash
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: text/plain" \
  --data-binary "What backend experience does this candidate have?"
```

## How It Works

1. Resume text is uploaded to `/upload`
2. The server splits the text into chunks
3. Each chunk is converted into an embedding
4. Chunks and embeddings are stored in memory
5. A question sent to `/ask` is embedded
6. Cosine similarity finds the top 3 relevant chunks
7. Those chunks are passed into the chat model as context
8. The model returns a grounded answer

## Notes

- Storage is in memory only, so restarting the server clears uploaded data
- This is intentionally minimal and not production-ready
- Basic logging and error handling are included

## Common Error

If you see a `429` quota error, your API key is reaching OpenAI successfully, but the account/project does not currently have usable API quota.

Check:
- OpenAI Platform billing is enabled
- the API key belongs to the correct project/account
- the project has available credits or payment method configured

<img width="1291" height="900" alt="Screenshot 2026-03-19 at 6 31 36 AM" src="https://github.com/user-attachments/assets/c2294489-c221-4cbf-9ff1-5b229c61ccfb" />
