"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowLeft, CheckCheck, Info, LockKeyhole, Send } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Initials, MessengerIcon, Picker } from "@/components/inbox-shared";
import { statuses, type Conversation, type Message } from "@/lib/inbox/demo";

const bodySchema = z.string().trim().min(1, "Enter a message.").max(2000, "Use 2,000 characters or fewer.");

type ThreadProps = {
  conversation: Conversation;
  live: boolean;
  onBack: () => void;
  onDetails: () => void;
  onStatus: (status: Conversation["status"]) => void;
  onSend: (kind: "outbound" | "note", body: string) => Promise<void>;
};

export function Thread({ conversation, live, onBack, onDetails, onStatus, onSend }: ThreadProps) {
  const [mode, setMode] = useState<"outbound" | "note">("outbound");
  const [sending, setSending] = useState(false);
  const { register, handleSubmit, resetField, setError, control, formState: { errors } } = useForm({
    defaultValues: { outbound: "", note: "" },
  });
  const body = useWatch({ control, name: mode });
  const error = errors[mode];
  const end = useRef<HTMLDivElement>(null);
  const pending = useRef(false);

  useEffect(() => {
    const log = end.current?.parentElement;
    if (log) log.scrollTop = log.scrollHeight;
  }, [conversation.messages.length]);

  function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (pending.current) return;
    pending.current = true;
    void handleSubmit(async (drafts) => {
      const result = bodySchema.safeParse(drafts[mode]);
      if (!result.success) {
        setError(mode, { message: result.error.issues[0].message });
        return;
      }
      setSending(true);
      try {
        await onSend(mode, result.data);
        resetField(mode);
      } catch (error) {
        setError(mode, { message: error instanceof Error ? error.message : "Couldn’t save your message. Try again." });
      }
    })().finally(() => {
      pending.current = false;
      setSending(false);
    });
  }

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
      {conversation.date && <div className="message-date">{conversation.date}</div>}
      {conversation.messages.map((message) => <MessageBubble key={message.id} message={message} live={live} />)}
      <div ref={end} />
    </div>
    <form className="composer" onSubmit={submit}>
      <div className="composer-tabs" aria-label="Message type">
        <button type="button" disabled={sending} aria-pressed={mode === "outbound"} onClick={() => setMode("outbound")}>Reply</button>
        <button type="button" disabled={sending} aria-pressed={mode === "note"} onClick={() => setMode("note")}><LockKeyhole size={13} />Internal note</button>
      </div>
      <textarea key={mode} aria-label={mode === "note" ? "Internal note" : "Reply message"} {...register(mode)}
        aria-invalid={Boolean(error)} aria-describedby={error ? "composer-error" : undefined}
        onKeyDown={onComposerKey} maxLength={2000} readOnly={sending}
        placeholder={mode === "note" ? "Write a note for your team…" : `Type a reply to ${conversation.name.split(" ")[0]}…`} />
      {error && <small className="form-error" id="composer-error" role="alert">{error.message}</small>}
      <div className="composer-actions">
        <small>{mode === "note" ? (live ? "Visible to your workspace team" : "Visible to your demo team") : (live ? "Sent via Messenger" : "Demo replies stay in this workspace")}</small>
        <Button type="submit" disabled={sending || !body?.trim()}><Send />{sending ? (mode === "note" ? "Adding note…" : "Sending…") : (mode === "note" ? "Add note" : "Send reply")}</Button>
      </div>
    </form>
  </>;
}

const deliveryLabels: Record<string, string> = {
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed",
  queued: "Delivery unconfirmed",
  unknown: "Delivery unconfirmed",
};

function MessageBubble({ message, live }: { message: Message; live: boolean }) {
  const delivery = message.kind === "outbound" && (deliveryLabels[message.deliveryStatus ?? ""] ?? "Delivery unconfirmed");
  return <div className="message-line" data-kind={message.kind}>
    <div className="message-bubble">
      {message.kind === "note" && <span className="message-note-label"><LockKeyhole size={13} /> Internal note</span>}
      {message.body}
    </div>
    <small>{message.time}{delivery && (live ? <span className="message-delivery" data-status={message.deliveryStatus}>{delivery}</span>
      : <CheckCheck size={15} aria-label="Demo reply" />)}</small>
  </div>;
}
