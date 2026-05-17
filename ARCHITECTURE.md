# 📄 Aporia: Architecture & Implementation Plan

## 🎯 System Overview
**Aporia** is a full-stack AI web application designed to allow users to upload complex PDF documents (like research papers) and query them using an intelligent chat interface. The system uses Retrieval-Augmented Generation (RAG) to ensure the AI's answers are strictly grounded in the uploaded document, preventing hallucinations.

---

## 🛠️ Technology Stack
As a Senior Architect, I recommend the **React + Python (FastAPI)** stack. This is the undisputed industry standard for AI applications. It shows recruiters you know how to split concerns: a highly responsive client-side UI, and a heavy data-processing backend.

### Frontend (Client)
*   **Framework:** React (Vite) + TypeScript
*   **Styling:** Tailwind CSS (Dark/Glassmorphism theme to match your portfolio)
*   **State Management:** React Hooks
*   **File Upload:** React Dropzone

### Backend (API & AI Pipeline)
*   **Server Framework:** FastAPI (Python) - Ultra-fast, async, automatic Swagger docs.
*   **Orchestration:** LangChain (Python) - Standard framework for connecting LLMs to data.
*   **Vector Database:** ChromaDB - Runs locally, highly performant, perfect for this scale.
*   **Embeddings:** HuggingFace `all-MiniLM-L6-v2` (Runs locally, completely free, fast).
*   **LLM (Generation):** Google Gemini API (Generous free tier, massive context window).

---

## 🏗️ Architecture Flow
1. **Ingestion (Document Processing):**
   * User drops a PDF into the React UI.
   * File is sent to FastAPI endpoint.
   * `PyPDFLoader` extracts text from the PDF.
   * `RecursiveCharacterTextSplitter` chunks the text into overlapping segments (e.g., 1000 characters).
   * HuggingFace model converts chunks into dense vector embeddings.
   * Embeddings and metadata are saved to ChromaDB.

2. **Retrieval & Generation (Chat):**
   * User types a question in the React UI.
   * FastAPI receives the query, embeds it using HuggingFace.
   * ChromaDB performs a similarity search to find the Top-K most relevant chunks.
   * The chunks + user question are injected into a prompt template.
   * The prompt is sent to the Gemini API.
   * Gemini streams the grounded answer back to the React UI.

---

## 📝 Implementation Phases (The Plan)

### Phase 1: Backend Foundation (Python)
- [x] Initialize Python virtual environment.
- [x] Install dependencies (`fastapi`, `uvicorn`, `langchain-text-splitters`, `chromadb`, `sentence-transformers`, `google-genai`, `pypdf`).
- [x] Set up basic FastAPI server and health check route.

### Phase 2: The RAG Pipeline (The Brains)
- [x] Implement `POST /upload` endpoint to handle PDF parsing and chunking.
- [x] Integrate local HuggingFace embeddings and initialize ChromaDB collection.
- [x] Implement `POST /chat` endpoint to perform similarity search.
- [x] Connect Gemini API to generate responses based on retrieved context.

### Phase 3: Frontend Foundation (React)
- [x] Initialize Vite React + TypeScript app.
- [x] Install Tailwind CSS and configure a dark/glass theme.
- [x] Build the layout: Sidebar (Document list/upload) + Main Area (Chat UI).

### Phase 4: Integration & Polish
- [x] Connect React frontend to FastAPI backend using `fetch` or `axios`.
- [x] Add loading states, error handling, and styling.
- [x] Write a stellar `README.md` explaining the architecture for recruiters.
