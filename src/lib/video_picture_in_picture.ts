type WebKitVideo = HTMLVideoElement & {
  webkitPresentationMode?: string;
  webkitSetPresentationMode?: (mode: string) => void;
};

export function isVideoInPictureInPicture(video: HTMLVideoElement): boolean {
  return document.pictureInPictureElement === video
    || (video as WebKitVideo).webkitPresentationMode === "picture-in-picture";
}

export async function restoreVideoPictureInPicture(video: HTMLVideoElement): Promise<void> {
  if (isVideoInPictureInPicture(video)) return;
  const webkitVideo = video as WebKitVideo;
  if (video.requestPictureInPicture) {
    await video.requestPictureInPicture();
  } else if (webkitVideo.webkitSetPresentationMode) {
    webkitVideo.webkitSetPresentationMode("picture-in-picture");
  } else {
    throw new Error("当前浏览器不支持画中画");
  }
}

export async function exitVideoPictureInPicture(video: HTMLVideoElement): Promise<void> {
  if (document.pictureInPictureElement === video && document.exitPictureInPicture) {
    await document.exitPictureInPicture();
  } else if ((video as WebKitVideo).webkitPresentationMode === "picture-in-picture") {
    (video as WebKitVideo).webkitSetPresentationMode?.("inline");
  }
}
