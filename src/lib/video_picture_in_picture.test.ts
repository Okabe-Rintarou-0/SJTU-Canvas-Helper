import { afterEach, describe, expect, it, vi } from "vitest";
import { exitVideoPictureInPicture, isVideoInPictureInPicture, restoreVideoPictureInPicture } from "./video_picture_in_picture";

afterEach(() => {
  Reflect.deleteProperty(document, "pictureInPictureElement");
  Reflect.deleteProperty(document, "exitPictureInPicture");
});

describe("live video picture-in-picture", () => {
  it("does not close a different video's picture-in-picture window", async () => {
    const video = document.createElement("video");
    const other = document.createElement("video");
    const exit = vi.fn();
    Object.defineProperty(document, "pictureInPictureElement", { configurable: true, value: other });
    Object.defineProperty(document, "exitPictureInPicture", { configurable: true, value: exit });
    await exitVideoPictureInPicture(video);
    expect(isVideoInPictureInPicture(video)).toBe(false);
    expect(exit).not.toHaveBeenCalled();
  });
  it("supports WebKit's picture-in-picture presentation mode", async () => {
    const video = document.createElement("video");
    const setMode = vi.fn((mode: string) => { Object.assign(video, { webkitPresentationMode: mode }); });
    Object.assign(video, { webkitPresentationMode: "inline", webkitSetPresentationMode: setMode });
    await restoreVideoPictureInPicture(video);
    expect(isVideoInPictureInPicture(video)).toBe(true);
    await restoreVideoPictureInPicture(video);
    expect(setMode).toHaveBeenCalledOnce();
    await exitVideoPictureInPicture(video);
    expect(setMode).toHaveBeenLastCalledWith("inline");
  });
});
