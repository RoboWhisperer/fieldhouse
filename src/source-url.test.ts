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
