"use client";

import { useState, type FormEvent } from "react";
import { Flag, Mail, Plus, UserRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Initials, MessengerIcon, Picker } from "@/components/inbox-shared";
import { agents, leadStages, type Conversation } from "@/lib/inbox/demo";
import type { LiveInboxAction, LiveInboxSnapshot } from "@/lib/inbox/live-types";

export function Details({ contact, members, onClose, onChange, onLiveChange }: {
  contact: Conversation;
  members?: LiveInboxSnapshot["agents"];
  onClose: () => void;
  onChange: (change: Partial<Conversation>) => void;
  onLiveChange?: (action: LiveInboxAction, value: string | null) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  const [savingTag, setSavingTag] = useState(false);
  const options = members ?? agents.map((name) => ({ id: name, name }));

  async function addTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingTag) return;
    const name = String(new FormData(event.currentTarget).get("tag") ?? "").trim();
    if (name && !contact.tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) {
      if (onLiveChange) {
        setSavingTag(true);
        const saved = await onLiveChange("add_tag", name);
        setSavingTag(false);
        if (!saved) return;
      } else onChange({ tags: [...contact.tags, name] });
    }
    setAdding(false);
  }

  function removeTag(tag: string) {
    if (onLiveChange) void onLiveChange("remove_tag", tag);
    else onChange({ tags: contact.tags.filter((value) => value !== tag) });
  }

  return <>
    <header className="details-header">
      <h2>Customer details</h2>
      <Button variant="ghost" size="icon-sm" aria-label="Close customer details" onClick={onClose}><X /></Button>
    </header>
    <div className="details-body">
      <div className="customer-identity">
        <Initials large contact={contact} />
        <div><h3>{contact.name}</h3><p><MessengerIcon /> Messenger</p></div>
      </div>
      <dl className="customer-fields">
        <div><dt><Mail size={16} />Email</dt><dd title={contact.email}>{contact.email ?? "Unavailable"}</dd></div>
        <div><dt><Flag size={16} />Page</dt><dd>{contact.page}</dd></div>
      </dl>
      <section className="detail-section">
        <h3>Tags</h3>
        {contact.tags.length > 0 && <div className="tag-list">
          {contact.tags.map((tag) => <Badge key={tag} variant="secondary" className="contact-tag">
            {tag}
            <button type="button" aria-label={`Remove tag ${tag}`} onClick={() => removeTag(tag)}><X size={12} /></button>
          </Badge>)}
        </div>}
        {adding ? <form onSubmit={addTag} className="tag-form">
          <input name="tag" aria-label="Tag name" placeholder="Tag name" maxLength={30} autoFocus required readOnly={savingTag} onKeyDown={(event) => {
            if (event.key === "Escape" && !savingTag) setAdding(false);
          }} />
          <Button type="submit" size="sm" disabled={savingTag}>{savingTag ? "Adding…" : "Add"}</Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel tag" disabled={savingTag} onClick={() => setAdding(false)}><X /></Button>
        </form> : <Button variant="outline" size="sm" onClick={() => setAdding(true)}><Plus />Add tag</Button>}
      </section>
      <section className="detail-section">
        <h3>Lead status</h3>
        <Picker aria-label="Lead status" className="lead-picker" value={contact.lead} onChange={(event) => {
          const value = event.target.value as Conversation["lead"];
          if (onLiveChange) void onLiveChange("lead", value);
          else onChange({ lead: value });
        }}>
          {leadStages.map((stage) => <option key={stage}>{stage}</option>)}
        </Picker>
      </section>
      <section className="detail-section">
        <h3>Assigned to</h3>
        <div className="assignee-field">
          <UserRound size={16} aria-hidden="true" />
          <Picker aria-label="Assigned agent" value={(members ? contact.assigneeId : contact.assignee) ?? ""} onChange={(event) => {
            if (onLiveChange) void onLiveChange("assign", event.target.value || null);
            else onChange({ assignee: event.target.value || undefined });
          }}>
            <option value="">Unassigned</option>
            {options.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </Picker>
        </div>
      </section>
    </div>
  </>;
}
