import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatComposer } from "../src/chat/chat-composer.tsx";
import { TpsLine } from "../src/chat/tps-line.tsx";
import { Context } from "../src/components/ai-elements/context.tsx";
import { ResponsiveDialogContent } from "../src/components/responsive-dialog.tsx";
import { Button } from "../src/components/ui/button.tsx";
import { Dialog, DialogTitle } from "../src/components/ui/dialog.tsx";
import { Input } from "../src/components/ui/input.tsx";
import { Tabs, TabsList, TabsTrigger } from "../src/components/ui/tabs.tsx";
import { ThemeProvider, useTheme } from "../src/theme.tsx";
import "../src/index.css";

function Fixture() {
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between">
        <Tabs defaultValue="chat">
          <TabsList>
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="other">Other</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button onClick={() => theme.setChoice("dark")}>Dark theme</Button>
        <Button onClick={() => setOpen(true)}>Show dialog</Button>
      </header>
      <main data-testid="transcript" className="min-h-0 flex-1 overflow-auto">
        {"Transcript text. ".repeat(300)}
      </main>
      <footer className="shrink-0 p-4">
        <ChatComposer
          busy
          queued={Array.from({ length: 12 }, (_, id) => ({
            id,
            text: "Queued message. ".repeat(50),
            mode: "steer",
            imageCount: 0,
          }))}
          imageSupport={{ kind: "none" }}
          commands={[{ name: "review", description: "Review changes", origin: "project" }]}
          onSend={async (text, _comments, _images, mode) => {
            document.body.dataset.sent = text;
            document.body.dataset.mode = mode;
          }}
          onStop={() => {
            document.body.dataset.stopped = "yes";
          }}
          statusBar={
            <div className="flex min-w-0 items-center justify-between">
              <Button variant="ghost">Model</Button>
              <Context usedTokens={500} maxTokens={1000} />
            </div>
          }
          status={
            <TpsLine
              tps={{
                tokensPerSecond: 10,
                seconds: 1,
                inputTokens: 10,
                outputTokens: 10,
                totalTokens: 20,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
              }}
            />
          }
        />
      </footer>
      <Dialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent>
          <DialogTitle>Responsive dialog</DialogTitle>
          <p>{"Long dialog content. ".repeat(200)}</p>
          <Input aria-label="Name" />
          <Button onClick={() => setOpen(false)}>Save</Button>
        </ResponsiveDialogContent>
      </Dialog>
    </div>
  );
}
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <ThemeProvider>
      <Fixture />
    </ThemeProvider>,
  );
