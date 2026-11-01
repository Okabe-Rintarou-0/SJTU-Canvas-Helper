import { describe, expect, it } from "vitest";
import { srtToVtt } from "./subtitle_format";

describe("plain subtitle text", () => {
  it("converts CRLF timings and keeps comparisons, code and Unicode visible", () => {
    expect(srtToVtt("1\r\n00:00:01,250 --> 00:00:02,500\r\nx < y && y > 0；f(x₀) ≤ 1；vector<int>\r\n"))
      .toBe("WEBVTT\n\n1\n00:00:01.250 --> 00:00:02.500\nx &lt; y &amp;&amp; y &gt; 0；f(x₀) ≤ 1；vector&lt;int&gt;\n");
  });
});
