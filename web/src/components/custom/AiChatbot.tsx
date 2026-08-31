import { FormEvent, useEffect, useRef, useState } from 'react';
import { Bot, ChevronRight, ClipboardList, FileText, Loader2, MessageCircle, Send, ShieldAlert, Sparkles, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { apiClient } from '../../utils/api';

type ChatSource = { type: 'document' | 'task'; id: string; title: string };
type ChatMessage = { role: 'assistant' | 'user'; text: string; sources?: ChatSource[]; accessDenied?: boolean };

const welcome: ChatMessage = {
  role: 'assistant',
  text: 'Hello! I can help with your assigned or created tasks, authorized documents, calendar, announcements, and personal dashboard. Document answers use permission-checked OCR and in-file search.',
};

export function AiChatbot() {
  const [open, setOpen] = useState(false);
  // Draws attention to the assistant (pulsing ring + label) until the user
  // has actually opened it once in this session — no point still trying to
  // grab attention once they've already found it.
  const [hasOpened, setHasOpened] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([welcome]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open, loading]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const question = input.trim();
    if (!question || loading) return;
    // Sent with each new question so a follow-up like "what about its due date"
    // can resolve against what was just discussed. This is a client-side sliding
    // window only — nothing is persisted server-side, and it resets on refresh
    // exactly like `messages` itself does.
    //
    // The "Authorized sources" list shown in the UI is a separate, exact,
    // structured field (message.sources) — not part of the model's free-form
    // prose (message.text), which can paraphrase or vary punctuation on the
    // document's title from one answer to the next. The backend's sticky-
    // document-context matching needs the *exact* title, so it's appended here
    // verbatim rather than relying on the prose to have reproduced it faithfully.
    const history = messages
      .filter((message) => message !== welcome)
      .slice(-6)
      .map((message) => ({
        role: message.role,
        content: message.sources?.length
          ? `${message.text}\n[Sources: ${message.sources.map((source) => source.title).join(', ')}]`
          : message.text,
      }));
    setMessages((current) => [...current, { role: 'user', text: question }]);
    setInput('');
    setLoading(true);
    try {
      const response = await apiClient.askAiChat(question, history);
      setMessages((current) => [...current, {
        role: 'assistant', text: response.data.answer, sources: response.data.sources, accessDenied: response.data.accessDenied,
      }]);
    } catch (error: any) {
      setMessages((current) => [...current, { role: 'assistant', text: error?.response?.data?.error || 'I could not search the DMS right now. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  const sourceHref = (source: ChatSource) => source.type === 'document'
    ? `/documents?preview=${encodeURIComponent(source.id)}`
    : `/tasks?highlight=${encodeURIComponent(source.id)}`;

  return (
    <>
      {open && (
        <section className="chat-panel-in fixed bottom-24 right-4 z-[75] flex h-[min(720px,calc(100vh-7rem))] w-[min(480px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-[0_28px_80px_-24px_rgba(15,23,42,0.5)] ring-1 ring-black/[0.03] dark:border-white/10 dark:bg-slate-900" aria-label="DMS AI Assistant">
          <header className="flex items-center gap-3 bg-gradient-to-br from-[#1f2c5c] via-[#27366f] to-[#3a5aa0] px-5 py-4 text-white">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <Sparkles className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold tracking-wide text-white">DMS AI Assistant</h2>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-blue-100/90">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300" />
                </span>
                Secure workspace assistant
              </p>
            </div>
            <button onClick={() => setOpen(false)} className="relative rounded-lg p-2 transition hover:bg-white/10 active:scale-95" aria-label="Close AI assistant"><X className="h-5 w-5" /></button>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto bg-gradient-to-b from-[#f7f9fc] to-[#eef2f8] p-4 dark:from-slate-950 dark:to-slate-950">
            {messages.map((message, index) => (
              <div key={index} className={`chat-message-in flex items-end gap-2.5 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {message.role === 'assistant' && <span className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#e6edf7] to-[#d7e3f5] text-[#2f4d83] ring-1 ring-[#2f4d83]/10 dark:from-slate-800 dark:to-slate-800 dark:text-blue-300 dark:ring-white/10"><Bot className="h-4 w-4" /></span>}
                <div className={`max-w-[84%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'rounded-br-md bg-gradient-to-br from-[#3a5aa0] to-[#274f7b] !text-white shadow-md shadow-[#274f7b]/20' : message.accessDenied ? 'rounded-bl-md border border-amber-200 bg-amber-50 text-amber-950 shadow-sm dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100' : 'rounded-bl-md border border-slate-200/80 border-l-2 border-l-[#3a5aa0]/40 bg-white text-slate-700 shadow-sm dark:border-slate-700 dark:border-l-blue-400/30 dark:bg-slate-900 dark:text-slate-200'}`}>
                  {message.accessDenied && <ShieldAlert className="mb-1.5 h-5 w-5 text-amber-600" />}
                  {message.role === 'assistant' ? (
                    <ReactMarkdown components={{
                      p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                      ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
                      ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
                      strong: ({ children }) => <strong className="font-semibold text-slate-900 dark:text-white">{children}</strong>,
                      table: ({ children }) => <div className="my-2 overflow-x-auto"><table className="w-full border-collapse text-xs">{children}</table></div>,
                      th: ({ children }) => <th className="border border-slate-200 bg-slate-50 px-2 py-1.5 text-left dark:border-slate-700 dark:bg-slate-800">{children}</th>,
                      td: ({ children }) => <td className="border border-slate-200 px-2 py-1.5 align-top dark:border-slate-700">{children}</td>,
                    }}>{message.text}</ReactMarkdown>
                  ) : <p className="whitespace-pre-wrap font-medium text-white">{message.text}</p>}

                  {!!message.sources?.length && (
                    <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Authorized sources</p>
                      {message.sources.map((source) => (
                        <Link to={sourceHref(source)} onClick={() => setOpen(false)} key={`${source.type}-${source.id}`} className="group mb-1.5 flex w-full items-center gap-2 rounded-lg border border-transparent bg-slate-50/80 px-2.5 py-2 text-left text-xs font-medium text-[#2f5f96] transition hover:-translate-y-0.5 hover:border-blue-100 hover:bg-blue-50 hover:shadow-sm hover:text-[#244c7c] focus:outline-none focus:ring-2 focus:ring-blue-300 dark:bg-slate-800/60 dark:text-blue-300 dark:hover:border-blue-900 dark:hover:bg-blue-950/40">
                          {source.type === 'document' ? <FileText className="h-4 w-4 shrink-0" /> : <ClipboardList className="h-4 w-4 shrink-0" />}<span className="min-w-0 flex-1 truncate">{source.title}</span><ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="chat-message-in ml-10 flex w-fit items-center gap-2.5 rounded-2xl border border-slate-200/80 bg-white px-4 py-2.5 text-xs font-medium text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <span className="flex items-center gap-1">
                  <span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-[#3a5aa0]" style={{ animationDelay: '0ms' }} />
                  <span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-[#3a5aa0]" style={{ animationDelay: '160ms' }} />
                  <span className="chat-typing-dot h-1.5 w-1.5 rounded-full bg-[#3a5aa0]" style={{ animationDelay: '320ms' }} />
                </span>
                Searching your authorized workspace…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={submit} className="border-t border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-end gap-2 rounded-xl border border-slate-300 bg-white p-1.5 shadow-sm transition focus-within:border-[#3c89c9] focus-within:shadow-[0_0_0_3px_rgba(60,137,201,0.15)] dark:border-slate-700 dark:bg-slate-950">
              <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} rows={2} maxLength={2000} placeholder="Ask about a task, file, calendar item, or announcement…" aria-label="Ask the DMS AI Assistant" className="max-h-28 min-h-[44px] flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-white" />
              <button type="submit" disabled={!input.trim() || loading} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#3a5aa0] to-[#274f7b] text-white shadow-sm transition hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100" aria-label="Send question">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</button>
            </div>
            <p className="mt-2 text-center text-[10px] text-slate-400">Permission-filtered answers • Verify critical information against the source</p>
          </form>
        </section>
      )}

      <div className="group fixed bottom-5 right-5 z-[75] flex items-center gap-3">
        {!open && !hasOpened && (
          <span className="chat-message-in hidden select-none items-center rounded-full bg-white px-3.5 py-2 text-xs font-medium text-[#27366f] shadow-lg ring-1 ring-black/5 sm:flex dark:bg-slate-800 dark:text-blue-200">
            Need help? Ask the AI Assistant
          </span>
        )}
        <button
          onClick={() => setOpen((value) => { const next = !value; if (next) setHasOpened(true); return next; })}
          className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#3a5aa0] to-[#232f6b] text-white shadow-lg shadow-[#232f6b]/30 transition hover:scale-105 hover:shadow-xl active:scale-95 focus:outline-none focus:ring-4 focus:ring-[#3c89c9]/30"
          aria-label={open ? 'Close AI assistant' : 'Open AI assistant'}
          aria-expanded={open}
        >
          {!open && !hasOpened && <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-[#3a5aa0]/50" aria-hidden />}
          {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
        </button>
      </div>
    </>
  );
}
