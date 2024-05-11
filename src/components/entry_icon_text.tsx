import { ReactNode } from "react";
import { Entry, Folder, File, isFile } from "../lib/model";
import { getBigFileIcon } from "../lib/utils";
import {
    FolderOutlined
} from "@ant-design/icons"
import IconText from "./icon_text";

export default function EntryIconText({ entry, selected, onEnter, onSelect, onHover, onLeaveHover }: {
    entry: Entry,
    selected: boolean,
    onSelect?: (entry: Entry) => void,
    onEnter?: (entry: Entry) => void,
    onHover?: (entry: Entry) => void,
    onLeaveHover: (entry: Entry) => void,
}) {
    const getIconAndText = (entry: Entry): [ReactNode, ReactNode] => {
        if (isFile(entry)) {
            const file = entry as File;
            const icon = getBigFileIcon(file);
            const text = file.display_name;
            return [icon, text];
        } else {
            const folder = entry as Folder;
            const icon = <FolderOutlined style={{ fontSize: '40px' }} />
            const text = folder.name;
            return [icon, text];
        }
    }

    const [icon, text] = getIconAndText(entry);
    return <IconText icon={icon} text={text} selected={selected}
        onClick={() => onSelect?.(entry)}
        onDoubleClick={() => onEnter?.(entry)}
        onHover={() => onHover?.(entry)}
        onLeaveHover={() => onLeaveHover?.(entry)}
    />
}