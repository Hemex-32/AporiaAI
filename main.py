from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import chromadb
from chromadb.utils import embedding_functions
from pypdf import PdfReader
from langchain_text_splitters import RecursiveCharacterTextSplitter
import os
import json
from google import genai
from pydantic import BaseModel
from typing import List, Optional

# Global references — populated during lifespan startup
chroma_client = None
collection = None
gemini_client = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Initialize all heavy resources (ChromaDB, embedding model, Gemini client)
    AFTER uvicorn has already bound to the port. This prevents Render's port
    scan from timing out while waiting for model downloads.
    """
    global chroma_client, collection, gemini_client

    print("🚀 Aporia: loading embedding model and vector store...")

    chroma_client = chromadb.PersistentClient(
        path="./chroma_db",
        settings=chromadb.Settings(anonymized_telemetry=False)
    )
    embedding_function = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name="all-MiniLM-L6-v2"
    )
    collection = chroma_client.get_or_create_collection(
        name="research_papers",
        embedding_function=embedding_function
    )

    gemini_client = genai.Client()
    print("✅ Aporia: all resources ready.")

    yield  # Server runs here

    print("🛑 Aporia: shutting down.")


app = FastAPI(
    title="Aporia API",
    description="API for the Aporia AI Research Assistant",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    query: str
    history: List[Message]
    document_id: Optional[str] = None


@app.get("/")
async def root():
    return {"status": "ok", "message": "Aporia API is running!"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    """
    Endpoint to handle PDF parsing and chunking.
    Extracts text, splits it into chunks, and stores in ChromaDB.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    try:
        # 1. Read PDF
        pdf_reader = PdfReader(file.file)
        text = ""
        for page in pdf_reader.pages:
            extracted = page.extract_text()
            if extracted:
                text += extracted + "\n"

        if not text.strip():
            raise HTTPException(status_code=400, detail="Could not extract any text from the PDF.")

        # 2. Chunk text using RecursiveCharacterTextSplitter
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            length_function=len,
        )
        chunks = text_splitter.split_text(text)

        # 3. Store in ChromaDB
        ids = [f"{file.filename}_chunk_{i}" for i in range(len(chunks))]
        metadatas = [{"source": file.filename, "chunk_index": i} for i in range(len(chunks))]

        collection.add(
            documents=chunks,
            metadatas=metadatas,
            ids=ids
        )

        return {
            "status": "success",
            "message": f"Successfully processed and stored {len(chunks)} chunks from {file.filename}."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing upload: {str(e)}")


@app.post("/chat")
async def chat(payload: ChatRequest):
    """
    Endpoint to perform scoped similarity search and generate streaming grounded answers via Gemini.
    """
    try:
        # 1. Retrieve relevant chunks from ChromaDB
        query_params = {
            "query_texts": [payload.query],
            "n_results": 5
        }
        if payload.document_id:
            query_params["where"] = {"source": payload.document_id}

        results = collection.query(**query_params)

        if not results['documents'] or not results['documents'][0]:
            async def empty_generator():
                yield f"data: {json.dumps({'type': 'content', 'text': 'I cannot find any relevant context in the uploaded document to answer this question.'})}\n\n"
                yield "data: [DONE]\n\n"
            return StreamingResponse(empty_generator(), media_type="text/event-stream")

        context_chunks = results['documents'][0]
        sources = results['metadatas'][0]

        # 2. Build prompt with context & history
        context = "\n\n---\n\n".join(context_chunks)

        history_str = ""
        for msg in payload.history:
            role_name = "User" if msg.role == "user" else "Assistant"
            history_str += f"{role_name}: {msg.content}\n"

        prompt = f"""You are a helpful research assistant. Answer the user's question using ONLY the provided context from the research paper.
Strictly base your answers on the context. If the answer cannot be found in the context, politely say "I cannot answer this based on the provided documents."

Context:
{context}

Conversation History:
{history_str}

Question: {payload.query}
"""

        # 3. Stream the generation
        async def event_generator():
            try:
                primary_source = sources[0] if sources else None
                yield f"data: {json.dumps({'type': 'sources', 'sources': primary_source})}\n\n"

                response = gemini_client.models.generate_content_stream(
                    model="gemini-2.0-flash",
                    contents=prompt
                )
                for chunk in response:
                    if chunk.text:
                        yield f"data: {json.dumps({'type': 'content', 'text': chunk.text})}\n\n"

                yield "data: [DONE]\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
                yield "data: [DONE]\n\n"

        return StreamingResponse(event_generator(), media_type="text/event-stream")

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error in chat streaming: {str(e)}")
