import { useState } from 'react';

import { ChevronDown, ChevronRight } from 'lucide-react';

import type { NoticeAction } from '../../lib/agent-events';

import type { TranscriptItem, TranscriptNotice } from '../../lib/transcript';

import { formatDuration } from '../../lib/transcript';

import { MarkdownBody } from './MarkdownBody';

import { ToolCard } from './ToolCard';



export function TranscriptItemView({

  item,

  projectRoot,

  onNoticeAction,

}: {

  item: TranscriptItem;

  projectRoot?: string | null;

  onNoticeAction?: (action: NoticeAction) => void;

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

            ? 'Thinking…'

            : 'Thought';

      return <CollapsibleMuted label={label} body={item.text} defaultOpen={false} />;

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

    case 'notice':

      return <NoticeRow notice={item} onAction={onNoticeAction} />;

    case 'tool_group':

      return (

        <div className="space-y-1" data-testid="transcript-tool-group">

          {item.tools.map((tool) => (

            <ToolCard key={tool.id} tool={tool} projectRoot={projectRoot} />

          ))}

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



const NOTICE_TONE: Record<TranscriptNotice['level'], string> = {

  info: 'text-text-3',

  warning: 'text-status-approval',

  error: 'text-status-error',

};

const NOTICE_ACTION_LABEL: Record<NoticeAction['kind'], string> = {

  retry_chat: 'Retry',

  open_terminal: 'Open in terminal',

  focus_terminal: 'Focus terminal',

  back_to_chat: 'Back to chat',

};

function NoticeRow({

  notice,

  onAction,

}: {

  notice: TranscriptNotice;

  onAction?: (action: NoticeAction) => void;

}) {

  return (

    <div

      className={`flex items-center gap-2 px-1 text-meta ${NOTICE_TONE[notice.level]}`}

      data-testid="transcript-notice"

      data-level={notice.level}

    >

      <span className="min-w-0 flex-1 break-words">{notice.text}</span>

      {notice.action && (

        <button

          type="button"

          className="shrink-0 text-accent hover:underline"

          onClick={() => notice.action && onAction?.(notice.action)}

        >

          {NOTICE_ACTION_LABEL[notice.action.kind]}

        </button>

      )}

    </div>

  );

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


