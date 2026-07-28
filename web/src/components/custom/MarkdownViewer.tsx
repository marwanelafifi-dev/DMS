import ReactMarkdown from 'react-markdown';

interface MarkdownViewerProps {
  content: string;
}

export function MarkdownViewer({ content }: MarkdownViewerProps) {
  return (
    <article
      className="mx-auto min-h-full max-w-4xl rounded-[4px] border border-[#dbe2ec] bg-white px-6 py-8 text-[#334155] shadow-sm dark:border-white/10 dark:bg-slate-900 dark:text-slate-200 sm:px-10"
      data-testid="markdown-document-viewer"
    >
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h1 className="mb-6 border-b border-slate-200 pb-3 text-[32px] font-bold leading-10 text-[#283a7a] dark:border-slate-700 dark:text-white">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-3 mt-8 text-[28px] font-semibold leading-9 text-[#283a7a] dark:text-white">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-6 text-2xl font-semibold leading-8 text-[#34425b] dark:text-slate-100">{children}</h3>,
          p: ({ children }) => <p className="my-4 leading-7">{children}</p>,
          ul: ({ children }) => <ul className="my-4 list-disc space-y-2 pl-6">{children}</ul>,
          ol: ({ children }) => <ol className="my-4 list-decimal space-y-2 pl-6">{children}</ol>,
          blockquote: ({ children }) => <blockquote className="my-5 border-l-4 border-[#3f8bca] bg-slate-50 px-4 py-2 italic dark:bg-slate-800">{children}</blockquote>,
          code: ({ children }) => <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm dark:bg-slate-800">{children}</code>,
          pre: ({ children }) => <pre className="my-5 overflow-x-auto rounded bg-slate-950 p-4 text-sm text-slate-100">{children}</pre>,
          table: ({ children }) => <table className="my-6 w-full border-collapse text-left text-sm">{children}</table>,
          th: ({ children }) => <th className="border border-slate-300 bg-slate-100 px-3 py-2 font-semibold dark:border-slate-700 dark:bg-slate-800">{children}</th>,
          td: ({ children }) => <td className="border border-slate-300 px-3 py-2 dark:border-slate-700">{children}</td>,
          a: ({ children, href }) => <a className="text-[#2f78b7] underline underline-offset-2" href={href} target="_blank" rel="noreferrer">{children}</a>,
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}
