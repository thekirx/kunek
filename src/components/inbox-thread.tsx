"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, CheckCheck, Info, LockKeyhole, Send } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Initials, MessengerIcon, Picker } from "@/components/inbox-shared";
import { statuses, type Conversation, type Message } from "@/lib/inbox/demo";

const bodySchema = z.string().trim().min(1, "Enter a message.").max(2000, "Use 2,000 characters or fewer.");

type ThreadProps = {
  conversation: Conversation;
  onBack: () => void;
  onDetails: () => void;
  onStatus: (status: Conversation["status"]) => void;
  onSend: (kind: "outbound" | "note", body: string) => void;
};

export function Thread({ conversation, onBack, onDetails, onStatus, onSend }: ThreadProps) {
  const [mode, setMode] = useState<"outbound" | "note">("outbound");
  const { register, handleSubmit, resetField, setError, control, formState: { errors } } = useForm({
    defaultValues: { outbound: "", note: "" },
  });
  const body = useWatch({ control, name: mode });
  const error = errors[mode];
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const log = end.current?.parentElement;
    if (log) log.scrollTop = log.scrollHeight;
  }, [conversation.messages.length]);

  const submit = handleSubmit((drafts) => {
    const result = bodySchema.safeParse(drafts[mode]);
    if (!result.success) {
      setError(mode, { message: result.error.issues[0].message });
      return;
    }
    onSend(mode, result.data);
    resetField(mode);
  });

  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  return <>
    <header className="thread-header">
      <Button variant="ghost" size="icon-sm" className="thread-back" onClick={onBack} aria-label="Back to conversations"><ArrowLeft /></Button>
      <Initials contact={conversation} />
      <div className="thread-identity">
        <h2>{conversation.name}</h2>
        <p><MessengerIcon /> Messenger <span className="thread-divider">/</span> {conversation.page}</p>
      </div>
      <Picker aria-label="Conversation status" className="status-picker" data-status={conversation.status.toLowerCase()} value={conversation.status}
        onChange={(event) => onStatus(event.target.value as Conversation["status"])}>
        {statuses.map((status) => <option key={status}>{status}</option>)}
      </Picker>
      <Button variant="outline" className="details-button" onClick={onDetails}><Info /><span>Details</span></Button>
    </header>
    <div className="message-log" role="log" aria-label={`Conversation with ${conversation.name}`}>
      <div className="message-date">{conversation.date}</div>
      {conversation.messages.map((message) => <MessageBubble key={message.id} message={message} />)}
      <div ref={end} />
    </div>
    <form className="composer" onSubmit={submit}>
      <div className="composer-tabs" aria-label="Message type">
        <button type="button" aria-pressed={mode === "outbound"} onClick={() => setMode("outbound")}>Reply</button>
        <button type="button" aria-pressed={mode === "note"} onClick={() => setMode("note")}><LockKeyhole size={13} />Internal note</button>
      </div>
      <textarea key={mode} aria-label={mode === "note" ? "Internal note" : "Reply message"} {...register(mode)}
        aria-invalid={Boolean(error)} aria-describedby={error ? "composer-error" : undefined}
        onKeyDown={onComposerKey} maxLength={2000}
        placeholder={mode === "note" ? "Write a note for your team…" : `Type a reply to ${conversation.name.split(" ")[0]}…`} />
      {error && <small className="form-error" id="composer-error" role="alert">{error.message}</small>}
      <div className="composer-actions">
        <small>{mode === "note" ? "Visible to your demo team" : "Demo replies stay in this workspace"}</small>
        <Button type="submit" disabled={!body?.trim()}><Send />{mode === "note" ? "Add note" : "Send reply"}</Button>
      </div>
    </form>
  </>;
}

function MessageBubble({ message }: { message: Message }) {
  return <div className="message-line" data-kind={message.kind}>
    <div className="message-bubble">
      {message.kind === "note" && <span className="message-note-label"><LockKeyhole size={13} /> Internal note</span>}
      {message.body}
    </div>
    <small>{message.time}{message.kind === "outbound" && <CheckCheck size={15} aria-label="Demo reply" />}</small>
  </div>;
}
