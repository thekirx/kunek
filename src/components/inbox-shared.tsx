import { ChevronDown, MessageCircle } from "lucide-react";
import type { SelectHTMLAttributes } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { Conversation } from "@/lib/inbox/demo";
import { cn } from "@/lib/utils";

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function Initials({ contact, large }: { contact: Conversation; large?: boolean }) {
  return <Avatar className={cn("monogram", large && "monogram-large")} data-color={contact.color}>
    <AvatarFallback>{contact.initials}</AvatarFallback>
  </Avatar>;
}

export function MessengerIcon() {
  return <span className="messenger-icon" aria-hidden="true"><MessageCircle size={13} strokeWidth={2.6} /></span>;
}

export function Picker({ children, className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <span className={cn("picker", className)}>
    <select {...props}>{children}</select>
    <ChevronDown size={15} aria-hidden="true" />
  </span>;
}
