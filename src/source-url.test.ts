import { expect, test } from "bun:test";
import { parseNetworkSource } from "./source-url";

test("accepts streams and files", () => {
  expect(parseNetworkSource("srt://10.0.0.5:9000", "Bench")).toMatchObject({ scheme: "srt", local: false, label: "Bench" });
  expect(parseNetworkSource("rtsp://cam.local/stream1").label).toBe("RTSP cam.local");
  expect(parseNetworkSource("https://x.example/live.m3u8").scheme).toBe("https");
  expect(parseNetworkSource("/videos/game 1.mp4".replace(" ", "_"))).toMatchObject({ local: true, label: "game_1" });
  expect(parseNetworkSource("C:\\Videos\\a.mov").local).toBe(true);
});
test("rejects everything else", () => {
  for (const bad of ["", "   ", "javascript:alert(1)", "file:///etc/passwd", "ftp://a/b", "srt://host", "rtmp://", "/etc/passwd", "concat:a|b", "rtmp://a b/c", "not a url", 5])
    expect(() => parseNetworkSource(bad)).toThrow();
});

test("maskAddress never shows credentials, queries or stream keys", async () => {
  const { maskAddress } = await import("./source-url");
  expect(maskAddress("rtmp://user:pw@10.0.0.5:1935/live/KEY123?token=abc")).toBe("rtmp://10.0.0.5:1935/live/...");
  expect(maskAddress("srt://10.0.0.5:9000?passphrase=secret")).toBe("srt://10.0.0.5:9000/...");
  expect(maskAddress("/home/u/Videos/game.mp4")).toBe("game.mp4");
  expect(maskAddress("C:\\Videos\\game.mp4")).toBe("game.mp4");
  expect(maskAddress("garbage")).toBe("(address hidden)");
});
