# 🚀 Aporia

An intelligent, full-stack Retrieval-Augmented Generation (RAG) web application that allows users to upload complex research papers (PDFs) and query them using an advanced AI chat interface. 

The system guarantees that the AI's answers are strictly grounded in the provided document, drastically reducing hallucinations and providing citations for its claims.

## 🎯 Architecture Overview

Aporia demonstrates a production-ready architectural split: a highly responsive client-side UI and a heavy data-processing backend pipeline.

### 🧠 Backend (The AI Pipeline)
- **FastAPI (Python):** High-performance, async API server handling file uploads and chat requests.
- **Google Gemini API (`google-genai`):** Utilizes the latest `gemini-3-flash-preview` model for advanced context synthesis and grounded answer generation.
- **ChromaDB:** A high-performance local vector database used for semantic similarity search.
- **HuggingFace Embeddings:** Uses the fast, locally hosted `all-MiniLM-L6-v2` model via `SentenceTransformers` to convert text chunks into dense vectors without API latency or cost.
- **LangChain Splitting:** Employs `RecursiveCharacterTextSplitter` to intelligently chunk documents while preserving semantic boundaries and context overlap.
- **PyPDF:** Extracts raw text from uploaded research papers.

### 🎨 Frontend (The User Experience)
- **React (Vite) & TypeScript:** Blazing fast development environment and strict type safety.
- **Tailwind CSS v3:** Utility-first styling configured with a custom, premium **Glassmorphism** dark theme.
- **Framer Motion:** Implements buttery-smooth micro-animations, layout transitions, and loading states to create a "wow" factor.
- **Lucide React:** Clean, consistent iconography.
- **React Dropzone:** Seamless drag-and-drop file upload interface.

---

## ⚙️ How It Works

1. **Ingestion Phase:** 
   - You drag and drop a PDF into the frontend. 
   - The file is sent to the FastAPI `/upload` endpoint.
   - The text is extracted, chunked (1000 characters, 200 overlap), embedded into vectors using HuggingFace, and stored locally in ChromaDB.
2. **Retrieval & Generation Phase:** 
   - You ask a question in the chat UI.
   - The question is sent to the `/chat` endpoint, which embeds the query and performs a Top-K similarity search against ChromaDB.
   - The most relevant document chunks are retrieved and injected into a strict prompt template.
   - The Gemini API synthesizes the retrieved chunks and streams a grounded, highly accurate answer back to the UI.

---

## 🛠️ Getting Started (Local Development)

### 1. Clone the Repository
```bash
git clone https://github.com/yourusername/aporia.git
cd aporia
```

### 2. Setup the Backend (Python)
Ensure you have Python 3.10+ installed.
```bash
# Create and activate a virtual environment
python -m venv venv
source venv/bin/activate  # On Windows use: .\venv\Scripts\activate

# Install the required dependencies
pip install fastapi uvicorn langchain-text-splitters chromadb sentence-transformers google-genai pypdf python-multipart

# Set your Gemini API Key
$env:GEMINI_API_KEY="your_api_key_here" # For PowerShell (Windows)

# Start the FastAPI server
uvicorn main:app --reload --port 8000
```
*The backend will be running at `http://localhost:8000`.*

### 3. Setup the Frontend (React)
Open a new terminal window.
```bash
cd frontend

# Install dependencies
npm install

# Start the Vite development server
npm run dev
```
*The frontend will be running at `http://localhost:5173`.*

---

## 🌟 Future Roadmap
- [ ] Implement conversation history (memory) for follow-up questions.
- [ ] Add support for processing multiple PDFs simultaneously.
- [ ] Stream Gemini API responses using Server-Sent Events (SSE) for a typing effect.
- [ ] Implement source highlighting in a split-pane PDF viewer.

---
*Built with ❤️ to demonstrate modern AI application architecture.*
