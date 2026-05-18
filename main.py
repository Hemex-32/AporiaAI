import asyncio
from contextlib import asynccontextmanager
import json
import os
import time
import uuid
from typing import List, Optional

import chromadb
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from google import genai
from google.genai import types
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pydantic import BaseModel
from pypdf import PdfReader


chroma_client = None
collection = None
gemini_client = None
resources_ready = asyncio.Event()
resources_error = None
resources_started_at = time.time()
resources_ready_at = None
warmup_estimate_seconds = 15


class GeminiEmbeddingFunction:
    def __init__(self):
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY must be set to initialize embeddings.")

        self.client = genai.Client(api_key=api_key)
        self.model = "gemini-embedding-001"

    @staticmethod
    def name():
        return "gemini-embedding-001"

    def __call__(self, input):
        texts = list(input)
        if not texts:
            return []

        response = self.client.models.embed_content(
            model=self.model,
            contents=texts,
            config=types.EmbedContentConfig(taskType="SEMANTIC_SIMILARITY"),
        )
        return [embedding.values for embedding in response.embeddings]


def load_resources_sync():
    global chroma_client, collection, gemini_client, resources_error, resources_ready_at

    print("Background: loading embedding model and vector store...")
    try:
        chroma_client = chromadb.PersistentClient(
            path="./chroma_db",
            settings=chromadb.Settings(anonymized_telemetry=False),
        )
        embedding_function = GeminiEmbeddingFunction()
        collection = chroma_client.get_or_create_collection(
            name="research_papers_gemini",
            embedding_function=embedding_function,
        )
        resources_ready_at = time.time()
        print("Background: all resources ready.")
    except Exception as exc:
        resources_error = exc
        print(f"Background: resource loading failed: {exc}")

    try:
        gemini_client = genai.Client()
    except Exception as exc:
        print(f"Background: Gemini client unavailable: {exc}")


async def load_resources_background():
    await asyncio.to_thread(load_resources_sync)
    resources_ready.set()


async def ensure_resources_ready(wait_for_ready: bool = False, timeout_seconds: int = 120):
    if resources_error:
        raise HTTPException(
            status_code=503,
            detail=f"Backend resources failed to initialize: {resources_error}",
        )

    if not wait_for_ready and not resources_ready.is_set():
        raise HTTPException(
            status_code=503,
            detail="Backend is still warming up. Please retry in a minute.",
        )

    try:
        await asyncio.wait_for(resources_ready.wait(), timeout=timeout_seconds)
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=503,
            detail="Backend is still warming up. Please retry in a minute.",
        )

    if resources_error:
        raise HTTPException(
            status_code=503,
            detail=f"Backend resources failed to initialize: {resources_error}",
        )


def process_pdf_sync(file: UploadFile):
    pdf_reader = PdfReader(file.file)
    text = ""

    for page in pdf_reader.pages:
        extracted = page.extract_text()
        if extracted:
            text += extracted + "\n"

    if not text.strip():
        raise HTTPException(
            status_code=400,
            detail="Could not extract any text from the PDF.",
        )

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
        length_function=len,
    )
    chunks = text_splitter.split_text(text)

    document_id = f"{file.filename}-{uuid.uuid4().hex}"
    ids = [f"{document_id}_chunk_{i}" for i in range(len(chunks))]
    metadatas = [
        {"source": file.filename, "document_id": document_id, "chunk_index": i}
        for i in range(len(chunks))
    ]

    collection.add(
        documents=chunks,
        metadatas=metadatas,
        ids=ids,
    )

    return {
        "status": "success",
        "document_id": file.filename,
        "message": f"Successfully processed and stored {len(chunks)} chunks from {file.filename}.",
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Start heavy resource initialization in a background thread so that
    uvicorn can bind the port before model loading finishes on Render.
    """
    asyncio.create_task(load_resources_background())

    yield

    print("Aporia: shutting down.")


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
    now = time.time()
    elapsed_seconds = max(0, round(now - resources_started_at))
    remaining_seconds = 0 if resources_ready.is_set() else max(
        0,
        warmup_estimate_seconds - elapsed_seconds,
    )

    return {
        "status": "healthy" if resources_ready.is_set() and not resources_error else "warming",
        "resources_ready": resources_ready.is_set(),
        "resources_error": str(resources_error) if resources_error else None,
        "warmup_elapsed_seconds": elapsed_seconds,
        "warmup_estimate_seconds": warmup_estimate_seconds,
        "warmup_remaining_seconds": remaining_seconds,
        "resources_ready_at": resources_ready_at,
    }


@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    """
    Extract text from a PDF, split it into chunks, and store it in ChromaDB.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    await ensure_resources_ready()

    try:
        return await asyncio.to_thread(process_pdf_sync, file)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing upload: {str(e)}")


@app.post("/chat")
async def chat(payload: ChatRequest):
    """
    Perform scoped similarity search and generate streaming grounded answers via Gemini.
    """
    await ensure_resources_ready()

    if not gemini_client:
        raise HTTPException(
            status_code=503,
            detail="Gemini client is not configured. Set GEMINI_API_KEY on the backend.",
        )

    try:
        query_params = {
            "query_texts": [payload.query],
            "n_results": 5,
        }
        if payload.document_id:
            query_params["where"] = {"source": payload.document_id}

        results = collection.query(**query_params)

        if not results["documents"] or not results["documents"][0]:
            async def empty_generator():
                yield f"data: {json.dumps({'type': 'content', 'text': 'I cannot find any relevant context in the uploaded document to answer this question.'})}\n\n"
                yield "data: [DONE]\n\n"

            return StreamingResponse(empty_generator(), media_type="text/event-stream")

        context_chunks = results["documents"][0]
        sources = results["metadatas"][0]
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

        async def event_generator():
            try:
                primary_source = sources[0] if sources else None
                yield f"data: {json.dumps({'type': 'sources', 'sources': primary_source})}\n\n"

                response = gemini_client.models.generate_content_stream(
                    model="gemini-2.0-flash",
                    contents=prompt,
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
