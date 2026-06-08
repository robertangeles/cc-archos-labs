import { notFound } from "next/navigation";
import * as chatService from "@/lib/chat/service";

interface ShareMessage {
  role: string;
  content: string;
  model?: string | null;
  createdAt: string;
}

export default async function SharedChatPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await chatService.getShareByToken(token);

  if (!result) notFound();

  if ("expired" in result) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-4">
        <div className="max-w-md text-center">
          <h1 className="mb-2 text-xl font-semibold text-white">
            Shared conversation expired
          </h1>
          <p className="text-neutral-400">
            This shared conversation has expired. Ask the sender for a new link.
          </p>
        </div>
      </div>
    );
  }

  const messages = (result.content as ShareMessage[]) ?? [];

  return (
    <div className="mx-auto min-h-screen max-w-3xl bg-neutral-950 px-4 py-8">
      <header className="mb-8 border-b border-neutral-800 pb-4">
        <h1 className="text-lg font-semibold text-white">
          {result.title ?? "Shared Conversation"}
        </h1>
        {result.modelUsed && (
          <p className="mt-1 text-sm text-neutral-500">{result.modelUsed}</p>
        )}
      </header>

      <div className="space-y-6">
        {messages.map((msg, i) => (
          <div key={i} className="flex gap-3">
            <div
              className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-neutral-700 text-neutral-300"
              }`}
            >
              {msg.role === "user" ? "U" : "AI"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-xs font-medium text-neutral-500">
                {msg.role === "user" ? "You" : "Assistant"}
              </p>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-200">
                {msg.content}
              </div>
            </div>
          </div>
        ))}
      </div>

      <footer className="mt-12 border-t border-neutral-800 pt-4 text-center text-xs text-neutral-600">
        Shared via Archos Labs
      </footer>
    </div>
  );
}
