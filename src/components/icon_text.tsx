import { Button } from "antd";
import { ReactNode } from "react";
import styles from "../css/icon_text.module.css"

export default function IconText({ icon, text, selected, onClick, onDoubleClick, onHover, onLeaveHover }: {
    icon: ReactNode,
    text: ReactNode,
    selected: boolean,
    onClick?: () => void,
    onDoubleClick?: () => void,
    onHover?: () => void,
    onLeaveHover?: () => void,
}) {
    return <Button style={{ height: 100, width: 160 }} onClick={onClick} onDoubleClick={onDoubleClick} type={selected ? "primary" : "default"}
        onMouseEnter={onHover} onMouseLeave={onLeaveHover}>
        <div style={{ width: "100%" }}>
            <div>{icon}</div>
            <div className={styles["text"]}>{text}</div>
        </div>
    </Button >
}