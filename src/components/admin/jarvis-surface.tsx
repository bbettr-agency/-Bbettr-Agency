"use client";

import { Tabs } from "@/components/ui/tabs";
import { JarvisChat } from "./jarvis-chat";

/**
 * F3 surface wrapper: Chat (default) | Console. The Console content is server-rendered
 * upstream and handed in as `consoleSlot` (a React node), so the existing Foundation-1
 * console + Memory panels are preserved untouched. This thin client component only owns
 * the tab selection (Tabs is a client render-prop component that can't be driven directly
 * from a server component).
 */
export function JarvisSurface({ firstName, consoleSlot }: { firstName?: string; consoleSlot: React.ReactNode }) {
  return (
    <Tabs
      items={[
        { id: "chat", label: "Chat" },
        { id: "console", label: "Console" },
      ]}
    >
      {(active) => (active === "chat" ? <JarvisChat firstName={firstName} /> : <div className="space-y-6">{consoleSlot}</div>)}
    </Tabs>
  );
}
