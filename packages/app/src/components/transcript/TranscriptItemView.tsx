import { useState } from 'react';

import { ChevronDown, ChevronRight } from 'lucide-react';

import type { TranscriptItem } from '../../lib/transcript';

import { formatDuration } from '../../lib/transcript';

import { MarkdownBody } from './MarkdownBody';

import { ToolCard } from './ToolCard';



export function TranscriptItemView({

  item,

  projectRoot,

}: {

  item: TranscriptItem;

  projectRoot?: string | null;

}) {

  switch (item.kind) {

    case 'assistant_text':

      return (

        <div className="px-1 py-1" data-testid="assistant-text">

          <MarkdownBody markdown={item.markdown} />

          {item.streaming && <span className="text-meta text-text-3">Typing…</span>}

        </div>

      );

    case 'reasoning': {

      const label =

        item.durationMs != null

          ? `Thought · ${formatDuration(item.durationMs)}`

          : item.streaming

            ? 'Thought…'

            : 'Thought';

      return <CollapsibleMuted label={label} body={item.text} defaultOpen />;

    }

    case 'tool_call':

      return <ToolCard tool={item} projectRoot={projectRoot} />;

    case 'patch':

      return (

        <div className="flex flex-wrap gap-1 px-1" data-testid="transcript-patch">

          {item.paths.map((p) => (

            <span

              key={p}

              data-testid="transcript-patch-path"

              className="text-[11px] font-mono px-2 py-0.5 rounded-full border border-border-subtle bg-elevated"

            >

              {p}

            </span>

          ))}

        </div>

      );

    case 'todo_update':

      return (

        <ul className="text-[12px] space-y-1 px-1">

          {item.items.map((t) => (

            <li key={t.id} className="flex gap-2 text-text-2">

              <span className="text-text-3">{t.status}</span>

              <span>{t.content}</span>

            </li>

          ))}

        </ul>

      );

    case 'subtask':

      return (

        <CollapsibleMuted label={item.title ?? 'Subtask'} body={item.prompt} defaultOpen={false} />

      );

    case 'retry':

      return (

        <p className="text-meta text-status-approval px-1" data-testid="transcript-retry">

          Retry attempt {item.attempt}

          {item.message ? ` · ${item.message}` : ''}

          {item.retryAtMs != null

            ? ` · retry ${new Date(item.retryAtMs).toLocaleTimeString()}`

            : ''}

        </p>

      );

    case 'error':

      return (

        <p className="text-meta text-status-error px-1" data-testid="transcript-error">

          {item.message}

        </p>

      );

    case 'step_usage':

      return null;

    case 'file':

      return (

        <div className="px-1" data-testid="transcript-file">

          <span

            className="text-[11px] font-mono px-2 py-0.5 rounded-full border border-border-subtle bg-surface text-text-2"

          >

            {item.filename ?? item.path ?? 'file'}

          </span>

        </div>

      );

    case 'compaction':

      return (

        <div

          className="mx-1 my-2 border-y border-border-subtle/60 py-2 text-center text-meta text-text-3"

          data-testid="transcript-compaction"

        >

          Context compacted

        </div>

      );

    case 'user_prompt':

      return null;

    default: {

      const _never: never = item;

      return _never;

    }

  }

}



function CollapsibleMuted({

  label,

  body,

  defaultOpen,

}: {

  label: string;

  body: string;

  defaultOpen: boolean;

}) {

  const [open, setOpen] = useState(defaultOpen);

  return (

    <div className="rounded-md border border-border-subtle/80 bg-canvas/40 text-[12px]">

      <button

        type="button"

        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-text-3 hover:text-text-2"

        onClick={() => setOpen((v) => !v)}

      >

        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}

        {label}

      </button>

      {open && (

        <p className="px-2 pb-2 whitespace-pre-wrap text-text-3 border-t border-border-subtle/60">

          {body}

        </p>

      )}

    </div>

  );

}


