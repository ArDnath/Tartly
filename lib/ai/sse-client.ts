/**
 * Minimal SSE reader used by the chat client.
 *
 * Frames are `event: <name>\ndata: <json>\n\n`. The reader buffers across
 * chunk boundaries so a frame split mid-flight is still parsed correctly.
 */
export type SseHandler = (event: string, data: unknown) => void;

export async function readSseStream(
  response: Response,
  onEvent: SseHandler,
): Promise<void> {
  if (!response.body) {
    throw new Error("Response has no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex !== -1) {
      const frame = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      separatorIndex = buffer.indexOf("\n\n");

      const lines = frame.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const dataLine = lines.find((line) => line.startsWith("data:"));
      if (!eventLine || !dataLine) continue;

      const event = eventLine.slice("event:".length).trim();
      try {
        onEvent(event, JSON.parse(dataLine.slice("data:".length).trim()));
      } catch {
        // Ignore malformed frames rather than killing the stream.
      }
    }
  }
}
