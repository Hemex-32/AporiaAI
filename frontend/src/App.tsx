import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence, useSpring, useMotionValue } from 'framer-motion';
import { UploadCloud, MessageSquare, FileText, Loader2, Bot, User, Sparkles, Sun, Moon, AudioLines } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

// --- Magnetic Component ---
function Magnetic({ children, strength = 0.5 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const springConfig = { damping: 15, stiffness: 150 };
  const springX = useSpring(x, springConfig);
  const springY = useSpring(y, springConfig);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const { clientX, clientY } = e;
    const { left, top, width, height } = ref.current.getBoundingClientRect();
    const centerX = left + width / 2;
    const centerY = top + height / 2;
    
    // Calculate distance from center and multiply by strength
    x.set((clientX - centerX) * strength);
    y.set((clientY - centerY) * strength);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ x: springX, y: springY }}
    >
      {children}
    </motion.div>
  );
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: any;
}

interface ApiErrorBody {
  detail?: string;
}

interface HealthResponse {
  status?: string;
  resources_ready?: boolean;
  resources_error?: string | null;
  warmup_elapsed_seconds?: number;
  warmup_estimate_seconds?: number;
  warmup_remaining_seconds?: number;
}

const getApiBaseUrl = () => {
  const configuredUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configuredUrl) return configuredUrl.replace(/\/+$/, '');
  return import.meta.env.PROD ? '' : 'http://localhost:8000';
};

const getResponseErrorMessage = async (response: Response) => {
  try {
    const body = await response.json() as ApiErrorBody;
    if (body.detail) return body.detail;
  } catch {
    // Fall back to status text below when the backend did not return JSON.
  }

  return response.statusText || `Request failed with status ${response.status}`;
};

const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeoutMs = 60000) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const formatDuration = (seconds: number) => {
  if (seconds <= 0) return 'less than 10 seconds';
  if (seconds < 60) return `${seconds} seconds`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) return `${minutes} min`;

  return `${minutes} min ${remainingSeconds} sec`;
};

const getApiConfigError = (apiBaseUrl: string) => {
  if (!apiBaseUrl) {
    return 'Missing VITE_API_BASE_URL. Set it in Vercel to your Render backend URL and redeploy.';
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(apiBaseUrl);
  } catch {
    return `VITE_API_BASE_URL is not a valid URL: ${apiBaseUrl}`;
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const isLocalBackend = hostname === 'localhost' || hostname === '127.0.0.1';
  if (import.meta.env.PROD && isLocalBackend) {
    return 'Vercel is pointing to localhost. Set VITE_API_BASE_URL to your public Render backend URL, then redeploy Vercel.';
  }

  if (window.location.protocol === 'https:' && parsedUrl.protocol === 'http:') {
    return 'Your Vercel app is HTTPS but VITE_API_BASE_URL uses HTTP. Use the HTTPS Render URL instead.';
  }

  if (hostname.endsWith('vercel.app')) {
    return 'VITE_API_BASE_URL appears to point to the frontend. It must point to the Render backend URL.';
  }

  return null;
};

export default function App() {
  const API_BASE_URL = getApiBaseUrl();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [warmupSecondsRemaining, setWarmupSecondsRemaining] = useState<number | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isGenerating]);

  useEffect(() => {
    if (warmupSecondsRemaining === null) return;
    if (warmupSecondsRemaining <= 0) return;

    const timerId = window.setTimeout(() => {
      setWarmupSecondsRemaining(prev => prev === null ? null : Math.max(0, prev - 1));
    }, 1000);

    return () => window.clearTimeout(timerId);
  }, [warmupSecondsRemaining]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    const file = acceptedFiles[0];
    
    setIsUploading(true);
    setUploadError(null);
    setSuggestedQuestions([]);
    setWarmupSecondsRemaining(null);
    setUploadStatus('Checking backend readiness...');
    const formData = new FormData();
    formData.append('file', file);

    try {
      const configError = getApiConfigError(API_BASE_URL);
      if (configError) throw new Error(configError);

      const healthResponse = await fetchWithTimeout(`${API_BASE_URL}/health`, {}, 60000);
      if (!healthResponse.ok) {
        throw new Error(await getResponseErrorMessage(healthResponse));
      }

      const health = await healthResponse.json() as HealthResponse;
      if (health.resources_error) {
        throw new Error(`Backend startup failed: ${health.resources_error}`);
      }

      if (!health.resources_ready) {
        const remainingSeconds = health.warmup_remaining_seconds ?? 60;
        setWarmupSecondsRemaining(remainingSeconds);
        throw new Error(`Backend is warming up. Estimated time remaining: ${formatDuration(remainingSeconds)}.`);
      }

      setWarmupSecondsRemaining(null);
      setUploadStatus('Uploading and embedding PDF...');
      const response = await fetchWithTimeout(`${API_BASE_URL}/upload`, {
        method: 'POST',
        body: formData,
      }, 180000);
      
      if (!response.ok) {
        throw new Error(await getResponseErrorMessage(response));
      }

      const uploadResult = await response.json();
      setUploadedFile(uploadResult.document_id || file.name);
      setSuggestedQuestions(uploadResult.suggested_questions || []);
      
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `I've successfully parsed **${file.name}**. What structured research insights can I help you extract?`
      }]);
    } catch (error) {
      console.error('Error uploading file:', error);
      const message = error instanceof DOMException && error.name === 'AbortError'
        ? 'The backend did not respond in time. Make sure the Render service is awake, then try a smaller PDF or retry once it is warm.'
        : error instanceof TypeError && error.message === 'Failed to fetch'
          ? `Could not reach the backend at ${API_BASE_URL}. Check that VITE_API_BASE_URL is your HTTPS Render URL and that ${API_BASE_URL}/health opens in the browser.`
        : error instanceof Error
          ? error.message
          : 'Failed to upload file. Make sure the backend is running.';
      setUploadError(message);
    } finally {
      setUploadStatus(null);
      setIsUploading(false);
    }
  }, [API_BASE_URL]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1
  });

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isGenerating) return;

    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: input };
    const currentHistory = messages.map(m => ({ role: m.role, content: m.content }));

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsGenerating(true);

    const assistantMessageId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, {
      id: assistantMessageId,
      role: 'assistant',
      content: ''
    }]);

    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: userMessage.content,
          history: currentHistory,
          document_id: uploadedFile
        }),
      });

      if (!response.ok) throw new Error('Chat failed');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No reader available');

      let buffer = '';
      let assistantAnswer = '';
      let assistantSources: any = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        buffer = lines.pop() || '';

        for (const line of lines) {
          const cleanLine = line.trim();
          if (!cleanLine.startsWith('data: ')) continue;
          
          const rawData = cleanLine.substring(6);
          if (rawData === '[DONE]') continue;

          try {
            const parsed = JSON.parse(rawData);
            if (parsed.type === 'sources') {
              assistantSources = parsed.sources;
            } else if (parsed.type === 'content') {
              assistantAnswer += parsed.text;
              
              setMessages(prev => prev.map(msg => 
                msg.id === assistantMessageId 
                  ? { ...msg, content: assistantAnswer, sources: assistantSources }
                  : msg
              ));
            } else if (parsed.type === 'error') {
              assistantAnswer = `Error: ${parsed.message}`;
              setMessages(prev => prev.map(msg => 
                msg.id === assistantMessageId 
                  ? { ...msg, content: assistantAnswer }
                  : msg
              ));
            }
          } catch (e) {
            console.error('Failed to parse stream chunk:', e);
          }
        }
      }
    } catch (error) {
      console.error('Error during chat:', error);
      setMessages(prev => prev.map(msg => 
        msg.id === assistantMessageId 
          ? { ...msg, content: 'Sorry, I encountered an error while trying to answer your question.' }
          : msg
      ));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className={`flex h-screen w-full relative overflow-hidden p-6 gap-6 transition-colors duration-500 ${
      theme === 'dark' ? 'bg-dark-950 text-slate-200' : 'bg-[#FAFBF9] text-slate-800'
    }`}>
      {/* Isolated Decorative Background Layer */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        {/* Dynamic Background Mesh */}
        <div className={`absolute inset-0 transition-opacity duration-500 ${
          theme === 'dark' ? 'bg-luxury-mesh-dark' : 'bg-luxury-mesh-light'
        }`} />
        
        {/* Soft Ambient Gold Orbs */}
        <div className={`ambient-glow-orb top-[-100px] right-[-100px] animate-pulse-slow ${
          theme === 'light' ? 'ambient-glow-orb-light' : ''
        }`} />
        <div className={`ambient-glow-orb bottom-[-150px] left-[200px] animate-pulse-slow ${
          theme === 'light' ? 'ambient-glow-orb-light' : ''
        }`} style={{ animationDelay: '3s' }} />
      </div>

      {/* Sidebar */}
      <motion.div 
        initial={{ x: -280, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className={`w-96 p-8 flex flex-col z-10 rounded-3xl h-full overflow-y-auto scrollbar-none transition-all duration-500 ${
          theme === 'dark' ? 'glass-panel-dark' : 'glass-panel-light'
        }`}
      >
        <div className="flex flex-col gap-4 mb-8">
          {/* Elegant luxury champagne-striped accent line */}
          <div className="luxury-accent-line mb-2" />
          
          <div className="flex items-center gap-4">
            {/* Elegant floating glass brand block */}
            <motion.div 
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className={`
                relative flex items-center justify-center w-14 h-14 rounded-2xl shrink-0 border transition-all duration-500 shadow-md
                ${theme === 'dark'
                  ? 'bg-white/[0.02] border-white/10 text-brand-300 shadow-brand-500/[0.03]'
                  : 'bg-black/[0.01] border-black/10 text-brand-700 shadow-black/[0.01]'
                }
              `}
            >
              <Sparkles size={24} className="relative z-10" />
              <div className={`absolute inset-0 rounded-2xl blur-lg opacity-40 transition-opacity ${
                theme === 'dark' ? 'bg-brand-500/20' : 'bg-brand-500/10'
              }`} />
            </motion.div>
            
            <div>
              <h1 className={`text-2xl font-black tracking-[0.12em] uppercase leading-none ${
                theme === 'dark' ? 'text-white' : 'text-slate-900'
              }`}>
                Aporia<span className={`transition-colors ${theme === 'dark' ? 'text-brand-300 text-glow' : 'text-brand-650'}`}>.</span>
              </h1>
              <p className={`text-[8px] font-bold tracking-[0.28em] uppercase mt-1.5 ${
                theme === 'dark' ? 'text-slate-400' : 'text-slate-500'
              }`}>
                Quiet RAG Studio
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-6">
          <div>
            <h2 className={`text-[10px] font-medium uppercase tracking-[0.2em] mb-4 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
              Datasources
            </h2>
            
            <Magnetic strength={0.2}>
              <div 
                {...getRootProps()} 
                className={`
                  relative overflow-hidden cursor-pointer p-6 border transition-all duration-500 rounded-2xl
                  ${isDragActive 
                    ? 'border-brand-400/50 bg-white/[0.02] shadow-[0_0_30px_rgba(226,201,153,0.05)]' 
                    : theme === 'dark'
                      ? 'border-white/10 bg-white/[0.005] hover:border-white/20 hover:bg-white/[0.01]'
                      : 'border-black/10 bg-black/[0.005] hover:border-black/20 hover:bg-black/[0.01]'
                  }
                `}
              >
                <input {...getInputProps()} />
                <div className="flex flex-col items-center justify-center text-center gap-4 relative z-10">
                  <div className={`p-3 rounded-xl border transition-all ${
                    isDragActive 
                      ? 'border-brand-400/30 bg-brand-500/10 text-brand-300' 
                      : theme === 'dark'
                        ? 'border-white/[0.06] bg-white/[0.01] text-slate-400'
                        : 'border-black/[0.06] bg-black/[0.01] text-slate-500'
                  }`}>
                    {isUploading ? <Loader2 className="animate-spin text-brand-500" size={20} /> : <UploadCloud size={20} />}
                  </div>
                  <div>
                    <p className={`text-sm font-light tracking-wide ${theme === 'dark' ? 'text-slate-200' : 'text-slate-700'}`}>
                      {isUploading ? 'Ingesting manuscript...' : 'Drop PDF here'}
                    </p>
                    <p className={`text-[9px] mt-1 tracking-wider ${theme === 'dark' ? 'text-slate-500' : 'text-slate-450'}`}>
                      {warmupSecondsRemaining !== null
                        ? `Warmup estimate: ${formatDuration(warmupSecondsRemaining)} remaining`
                        : uploadStatus || 'Or select file from explorer'}
                    </p>
                  </div>
                </div>
              </div>
            </Magnetic>

            <AnimatePresence>
              {uploadError && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className={`mt-3 text-[10px] leading-relaxed ${
                    theme === 'dark' ? 'text-red-300' : 'text-red-600'
                  }`}
                >
                  {uploadError}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          {/* Active File indicator */}
          <AnimatePresence>
            {uploadedFile && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={`p-4 border rounded-2xl flex items-center gap-3.5 relative shadow-sm ${
                  theme === 'dark' ? 'border-brand-500/20 bg-white/[0.01]' : 'border-brand-500/30 bg-black/[0.005]'
                }`}
              >
                <div className="p-2.5 bg-brand-500/10 text-brand-500 rounded-lg border border-brand-500/10">
                  <FileText size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-light truncate ${theme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>{uploadedFile}</p>
                  <p className="text-[8px] text-brand-500 font-medium mt-0.5 uppercase tracking-[0.18em]">Fully Grounded</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        <div className={`mt-auto pt-6 flex items-center justify-between text-[9px] font-medium border-t uppercase tracking-[0.18em] ${
          theme === 'dark' ? 'text-slate-650 border-white/[0.04]' : 'text-slate-400 border-black/[0.04]'
        }`}>
          <span>Ver 1.0.0</span>
          <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-pulse"></div> Encrypted</span>
        </div>
      </motion.div>

      {/* Main Unified Console Panel */}
      <motion.div 
        initial={{ y: 20, opacity: 0, rotateX: 2 }}
        animate={{ y: 0, opacity: 1, rotateX: 0 }}
        transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
        className="flex-1 flex flex-col relative z-10 h-full overflow-hidden"
      >
        <div className={`flex-1 flex flex-col rounded-3xl overflow-hidden transition-all duration-500 ${
          theme === 'dark' ? 'glass-panel-dark' : 'glass-panel-light'
        }`}
        style={{ perspective: '1200px' }}
        >
          
          {/* Panel Header */}
          <div className={`h-20 w-full flex items-center justify-between px-8 border-b ${
            theme === 'dark' ? 'border-white/[0.04]' : 'border-black/[0.03]'
          }`}>
            <h2 className={`text-[10px] font-semibold tracking-[0.25em] uppercase border-l-2 border-brand-400 pl-4 ${
              theme === 'dark' ? 'text-slate-400' : 'text-slate-500'
            }`}>
              Model Console // Grounded Vector RAG
            </h2>
            
            {/* Theme Toggle Toggle Button */}
            <button
              onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
              className={`p-2.5 rounded-xl border transition-all duration-300 ${
                theme === 'dark' 
                  ? 'border-white/[0.06] bg-white/[0.02] text-brand-300 hover:bg-white/[0.05]' 
                  : 'border-black/[0.05] bg-black/[0.01] text-brand-600 hover:bg-black/[0.03]'
              }`}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
            <div className="max-w-5xl mx-auto flex flex-col gap-8 py-4">
              
              {messages.length === 0 && !uploadedFile && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1, duration: 0.6 }}
                  className="flex-1 flex flex-col items-center justify-center text-center py-16"
                >
                  <div className={`w-16 h-16 rounded-2xl border flex items-center justify-center text-brand-400 mb-6 shadow-sm ${
                    theme === 'dark' ? 'bg-white/[0.01] border-white/[0.06]' : 'bg-black/[0.005] border-black/[0.04]'
                  }`}>
                    <MessageSquare size={24} className="opacity-80" />
                  </div>
                  <h2 className={`text-xl font-light mb-2 tracking-[0.08em] uppercase ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                    Grounding Module Ready
                  </h2>
                  <p className={`max-w-sm text-sm leading-relaxed font-light tracking-wide ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>
                    Upload a research manuscript. Aporia will isolate your context queries using semantic vector indexes.
                  </p>
                </motion.div>
              )}

              <AnimatePresence initial={false}>
                {messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    className={`flex gap-5 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                  >
                    <div className={`
                      w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border mt-0.5 text-[10px]
                      ${msg.role === 'user' 
                        ? theme === 'dark'
                          ? 'bg-white/[0.01] text-slate-400 border-white/[0.08]' 
                          : 'bg-black/[0.01] text-slate-500 border-black/[0.08]'
                        : theme === 'dark'
                          ? 'bg-gradient-to-tr from-brand-600/20 to-brand-400/20 text-brand-300 border-brand-500/20 shadow-md shadow-brand-500/[0.02]'
                          : 'bg-gradient-to-tr from-brand-600/10 to-brand-400/10 text-brand-700 border-brand-500/30'
                      }
                    `}>
                      {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                    </div>
                    
                    <div className={`
                      max-w-[78%] px-6 py-4.5 rounded-2xl border relative
                      ${msg.role === 'user' 
                        ? theme === 'dark'
                          ? 'bg-brand-500/[0.02] border-brand-500/10 text-slate-200' 
                          : 'bg-brand-500/[0.06] border-brand-500/20 text-slate-800 shadow-sm'
                        : theme === 'dark'
                          ? 'bg-white/[0.005] border-white/[0.04] text-slate-200' 
                          : 'bg-white/60 border-black/[0.03] text-slate-800 shadow-sm'
                      }
                    `}>
                      {msg.role === 'user' ? (
                        <p className={`whitespace-pre-wrap leading-relaxed text-sm tracking-wide font-light ${
                          theme === 'dark' ? 'text-slate-300' : 'text-slate-700'
                        }`}>{msg.content}</p>
                      ) : (
                        <div className={`font-sans text-[14px] font-light leading-relaxed max-w-none ${
                          theme === 'dark' ? 'text-slate-300' : 'text-slate-700'
                        }`}>
                          <ReactMarkdown 
                            components={{
                              p: ({node, ...props}) => <p className="mb-4 last:mb-0" {...props} />,
                              strong: ({node, ...props}) => <strong className={`${theme === 'dark' ? 'text-brand-300' : 'text-brand-700'} font-medium`} {...props} />,
                              ul: ({node, ...props}) => <ul className={`list-disc pl-5 mb-4 space-y-1.5 text-sm tracking-wide font-light ${
                                theme === 'dark' ? 'text-slate-400' : 'text-slate-500'
                              }`} {...props} />,
                              ol: ({node, ...props}) => <ol className={`list-decimal pl-5 mb-4 space-y-1.5 text-sm tracking-wide font-light ${
                                theme === 'dark' ? 'text-slate-400' : 'text-slate-500'
                              }`} {...props} />,
                              li: ({node, ...props}) => <li {...props} />,
                              h1: ({node, ...props}) => <h1 className={`text-sm font-semibold mb-2 mt-4 first:mt-0 tracking-[0.1em] uppercase border-b pb-1.5 ${
                                theme === 'dark' ? 'text-white border-white/[0.04]' : 'text-slate-900 border-black/[0.03]'
                              }`} {...props} />,
                              h2: ({node, ...props}) => <h2 className={`text-[11px] font-semibold mb-2 mt-3.5 first:mt-0 tracking-[0.08em] uppercase ${
                                theme === 'dark' ? 'text-white' : 'text-slate-900'
                              }`} {...props} />,
                              h3: ({node, ...props}) => <h3 className={`text-[10px] font-semibold mb-1.5 mt-2.5 first:mt-0 tracking-[0.05em] uppercase ${
                                theme === 'dark' ? 'text-white' : 'text-slate-900'
                              }`} {...props} />,
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      )}
                      
                      {msg.sources && (
                        <div className={`mt-5 pt-3.5 border-t flex items-center gap-2 text-[9px] font-medium tracking-wider ${
                          theme === 'dark' ? 'border-white/[0.03] text-slate-500' : 'border-black/[0.03] text-slate-450'
                        }`}>
                          <FileText size={10} className="text-brand-400" />
                          <span>Source: <span className={theme === 'dark' ? 'text-slate-400 font-light' : 'text-slate-600 font-light'}>{msg.sources.source}</span> <span className="opacity-40">//</span> Page {msg.sources.page_number}</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {isGenerating && (
                <motion.div 
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="flex gap-5"
                >
                  <div className={`w-9 h-9 rounded-xl border flex items-center justify-center ${
                    theme === 'dark'
                      ? 'bg-gradient-to-tr from-brand-600/20 to-brand-400/20 text-brand-300 border-brand-500/20'
                      : 'bg-gradient-to-tr from-brand-600/10 to-brand-400/10 text-brand-700 border-brand-500/30'
                  }`}>
                    <Bot size={14} />
                  </div>
                  <div className={`px-5 py-3.5 rounded-2xl flex items-center gap-3.5 border ${
                    theme === 'dark' 
                      ? 'bg-white/[0.005] border-white/[0.04] text-brand-450' 
                      : 'bg-white/60 border-black/[0.03] text-brand-600'
                  }`}>
                    <div className="flex gap-1.5 items-center">
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" style={{ animationDelay: '200ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" style={{ animationDelay: '400ms' }} />
                    </div>
                    <span className="text-[10px] tracking-[0.18em] font-medium uppercase">Resolving vector...</span>
                  </div>
                </motion.div>
              )}
              
              <div ref={messagesEndRef} className="h-4" />
            </div>
          </div>

          {/* Unified Chat Input Console */}
          <div className={`border-t p-6 transition-all duration-500 ${
            theme === 'dark' 
              ? 'border-white/[0.04] bg-dark-950/20' 
              : 'border-black/[0.03] bg-black/[0.005]'
          }`}>
            <div className="max-w-5xl w-full mx-auto">
              {/* Suggested Questions Chips */}
              <AnimatePresence>
                {suggestedQuestions.length > 0 && !isGenerating && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="flex flex-wrap gap-2 mb-6"
                  >
                    {suggestedQuestions.map((question, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setInput(question);
                          setSuggestedQuestions([]);
                        }}
                        className={`px-4 py-2 rounded-full text-[10px] font-medium tracking-wide border transition-all duration-300 ${
                          theme === 'dark'
                            ? 'bg-white/[0.02] border-white/10 text-slate-400 hover:border-brand-500/40 hover:text-brand-300 hover:bg-brand-500/5'
                            : 'bg-black/[0.01] border-black/10 text-slate-600 hover:border-brand-500/40 hover:text-brand-700 hover:bg-brand-500/5'
                        }`}
                      >
                        {question}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <form 
                onSubmit={handleSendMessage}
                className={`relative flex items-center group shadow-lg rounded-full border transition-all duration-500 ${
                  theme === 'dark' 
                    ? 'bg-[#1A1A1C]/90 border-white/[0.08] focus-within:border-white/20' 
                    : 'bg-white/90 border-black/[0.06] focus-within:border-black/20 shadow-[0_12px_40px_rgba(0,0,0,0.05)]'
                }`}
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask anything"
                  disabled={!uploadedFile || isGenerating}
                  className={`w-full bg-transparent border-none rounded-full py-6 pl-8 pr-16 text-base outline-none font-sans disabled:opacity-50 disabled:cursor-not-allowed ${
                    theme === 'dark' ? 'text-slate-200 placeholder:text-slate-600' : 'text-slate-800 placeholder:text-slate-400'
                  }`}
                />

                {/* Right Action Cluster */}
                <div className="absolute right-3 flex items-center">
                  <Magnetic strength={0.6}>
                    <button
                      type="submit"
                      disabled={!input.trim() || !uploadedFile || isGenerating}
                      className={`p-3.5 rounded-full transition-all shadow-lg ${
                        theme === 'dark'
                          ? 'bg-white text-dark-950 hover:bg-slate-200'
                          : 'bg-dark-950 text-white hover:bg-slate-800'
                      } disabled:opacity-30 disabled:scale-95`}
                    >
                      <AudioLines size={18} strokeWidth={2.5} />
                    </button>
                  </Magnetic>
                </div>
              </form>
              <div className={`text-center mt-4 text-[9px] font-medium tracking-[0.25em] uppercase opacity-40 ${
                theme === 'dark' ? 'text-slate-500' : 'text-slate-450'
              }`}>
                Neural Grounding Matrix // V 1.0.0
              </div>
            </div>
          </div>

        </div>
      </motion.div>
    </div>
  );
}
