import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import typescript from 'highlight.js/lib/languages/typescript';
import 'highlight.js/styles/github-dark.min.css';
import { isSafeHttpUrl } from '../../lib/safe-agent-text';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('typescript', typescript);

function highlight(code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    return hljs.highlight(code, { language: lang }).value;
  }
  return hljs.highlightAuto(code).value;
}

export function MarkdownBody({ markdown, className }: { markdown: string; className?: string }) {
  const components = useMemo(
    () => ({
      a({ href, children }: { href?: string; children?: React.ReactNode }) {
        if (!href || !isSafeHttpUrl(href)) {
          return <span className="text-text-2">{children}</span>;
        }
        return (
          <a href={href} className="text-link underline" target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        );
      },
      code(props: { className?: string; children?: React.ReactNode; inline?: boolean }) {
        const { className, children, inline } = props;
        const text = String(children ?? '').replace(/\n$/, '');
        if (inline) {
          return (
            <code className="px-1 py-0.5 rounded bg-elevated text-[12px] font-mono">{text}</code>
          );
        }
        const lang = /language-(\w+)/.exec(className ?? '')?.[1] ?? '';
        const html = highlight(text, lang);
        return (
          <pre className="my-2 overflow-x-auto rounded-md border border-border-subtle bg-canvas p-2 text-[12px] leading-relaxed">
            <code
              className="font-mono"
              // highlight.js output is escaped HTML entities only
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </pre>
        );
      },
    }),
    [],
  );

  return (
    <div className={`prose prose-invert max-w-none text-body text-text ${className ?? ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as never}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
