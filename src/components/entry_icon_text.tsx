import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import { ReactNode } from "react";

import { Entry, File, Folder, isFile } from "../lib/model";
import { getBigFileIcon } from "../lib/utils";
import IconText from "./icon_text";

export default function EntryIconText({
  entry,
  selected,
  onEnter,
  onSelect,
  onHover,
  onLeaveHover,
}: {
  entry: Entry;
  selected: boolean;
  onSelect?: (entry: Entry) => void;
  onEnter?: (entry: Entry) => void;
  onHover?: (entry: Entry) => void;
  onLeaveHover: (entry: Entry) => void;
}) {
  const getIconAndText = (currentEntry: Entry): [ReactNode, ReactNode] => {
    if (isFile(currentEntry)) {
      const file = currentEntry as File;
      return [getBigFileIcon(file), file.display_name];
    }

    const folder = currentEntry as Folder;
    return [<FolderRoundedIcon sx={{ fontSize: 40 }} />, folder.name];
  };

  const [icon, text] = getIconAndText(entry);

  return (
    <IconText
      icon={icon}
      text={text}
      selected={selected}
      onClick={() => onSelect?.(entry)}
      onDoubleClick={() => onEnter?.(entry)}
      onHover={() => onHover?.(entry)}
      onLeaveHover={() => onLeaveHover?.(entry)}
    />
  );
}
