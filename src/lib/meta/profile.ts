import "server-only";
import { decryptCredential, graphVersion } from "./config";
import { createMetaGraph } from "./graph";
import { serviceClient } from "@/lib/supabase/server";

// Profile details may be unavailable under Meta's privacy or app access rules.
// This happens after durable acceptance so optional enrichment cannot drop a message.
export async function enrichMessengerProfiles(conversationIds: string[]) {
  try {
    const db = serviceClient();
    const graph = createMetaGraph(graphVersion());
    const ids = [...new Set(conversationIds)].slice(0, 5);
    await Promise.allSettled(ids.map(async (id) => {
      const { data, error } = await db.rpc("oniro_messenger_profile_context", { p_conversation_id: id });
      if (error || !data) return;
      const token = decryptCredential(data.token_ciphertext, data.organization_id, data.page_id);
      const name = await graph.profileName(data.recipient_id, token);
      if (!name) return;
      await db.from("contacts").update({ display_name: name }).eq("organization_id", data.organization_id)
        .eq("channel_id", data.channel_id).eq("id", data.contact_id).eq("display_name", "Messenger contact");
    }));
  } catch {
    // Contacts retain their generic display name when provider lookup is unavailable.
  }
}
