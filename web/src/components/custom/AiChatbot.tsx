import { FormEvent, useEffect, useRef, useState } from 'react';
import { Bot, FileText, Loader2, MessageCircle, Send, ShieldAlert, X } from 'lucide-react';
import { apiClient } from '../../utils/api';

type ChatSource = { type: 'document' | 'task'; id: string; title: string };
type ChatMessage = { role: 'assistant' | 'user'; text: string; sources?: ChatSource[]; accessDenied?: boolean };

const welcome: ChatMessage = {
  role: 'assistant',
  text: 'Hello! Ask me about your tasks or the contents of files you can access. I use OCR and in-file search, and I will never reveal a file you do not have permission to view.',
};

export function AiChatbot() {
  const [open, setOpen] = useState(false);
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
    setMessages((current) => [...current, { role: 'user', text: question }]);
    setInput('');
    setLoading(true);
    try {
      const response = await apiClient.askAiChat(question);
      setMessages((current) => [...current, {
        role: 'assistant',
        text: response.data.answer,
        sources: response.data.sources,
        accessDenied: response.data.accessDenied,
      }]);
    } catch (error: any) {
      setMessages((current) => [...current, {
        role: 'assistant',
        text: error?.response?.data?.error || 'I could not search the DMS right now. Please try again.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {open && (
        <section
          className="fixed bottom-24 right-4 z-50 flex h-[min(650px,calc(100vh-7rem))] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          aria-label="DMS AI Assistant"
        >
          <header className="flex items-center gap-3 bg-[#2f3e83] px-4 py-3 text-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><Bot className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">DMS AI Assistant</h2>
              <p className="text-xs text-blue-100">Permission-safe OCR & task search</p>
            </div>
            <button onClick={() => setOpen(false)} className="rounded-lg p-2 hover:bg-white/10" aria-label="Close AI assistant"><X className="h-5 w-5" /></button>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto bg-slate-50 p-4 dark:bg-slate-950">
            {messages.map((message, index) => (
              <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${message.role === 'user' ? 'rounded-br-md bg-[#2f6f9f] text-white' : message.accessDenied ? 'rounded-bl-md border border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100' : 'rounded-bl-md border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>
                  {message.accessDenied && <ShieldAlert className="mb-1.5 h-5 w-5 text-amber-600" />}
                  <p className="whitespace-pre-wrap">{message.text}</p>
                  {!!message.sources?.length && (
                    <div className="mt-3 border-t border-slate-200 pt-2 dark:border-slate-700">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Authorized sources</p>
                      {message.sources.map((source) => (
                        <div key={`${source.type}-${source.id}`} className="flex items-center gap-1.5 truncate text-xs text-[#2f6f9f] dark:text-blue-300">
                          <FileText className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{source.title}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Searching tasks and accessible files…</div>}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={submit} className="border-t border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={2}
                maxLength={2000}
                placeholder="Ask about a task or file…"
                aria-label="Ask the DMS AI Assistant"
                className="max-h-28 min-h-[44px] flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#3c89c9] focus:ring-2 focus:ring-[#3c89c9]/15 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              <button type="submit" disabled={!input.trim() || loading} className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#2f3e83] text-white disabled:cursor-not-allowed disabled:opacity-50" aria-label="Send question">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-slate-400">Answers are limited to your permissions and may need verification.</p>
          </form>
        </section>
      )}

      <button
        onClick={() => setOpen((value) => !value)}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#2f3e83] text-white shadow-lg transition hover:scale-105 hover:bg-[#26346f] focus:outline-none focus:ring-4 focus:ring-[#3c89c9]/30"
        aria-label={open ? 'Close AI assistant' : 'Open AI assistant'}
        aria-expanded={open}
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>
    </>
  );
}
