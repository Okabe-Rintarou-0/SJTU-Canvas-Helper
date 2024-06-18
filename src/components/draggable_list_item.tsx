import { Card } from "antd";
import { DraggableItem } from "../lib/model";

export default function DraggableListItem({ item, provided }: { item: DraggableItem, provided: any }) {
    return <div
        ref={provided.innerRef}
        {...provided.draggableProps}
        {...provided.dragHandleProps}
    >
        <Card styles={{ body: { padding: "0px 15px" } }}>
            <p>{item.content}</p>
        </Card>
    </div >
}