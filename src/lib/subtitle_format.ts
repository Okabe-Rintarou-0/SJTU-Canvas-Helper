/** Native text tracks use WebVTT cue text, not Markdown or a math renderer.
 * Escape payload characters so comparison operators and code stay visible.
 */
export function srtToVtt(srt: string) {
  const lines = srt.replace(/\r\n?/g, "\n").split("\n");
  return "WEBVTT\n\n" + lines.map((line) => {
    if (/^\d{2,}:\d{2}:\d{2},\d{3} --> \d{2,}:\d{2}:\d{2},\d{3}/.test(line)) {
      return line.replace(/,(\d{3})/g, ".$1");
    }
    return line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }).join("\n");
}
